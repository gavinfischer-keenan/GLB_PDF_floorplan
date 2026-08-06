/**
 * FloorPlanEditor — SVG-based 2D floor plan editor
 * Renders walls, dimensions, and custom measurements as interactive SVG elements.
 * Supports pan, zoom, wall drawing, and interactive distance measuring.
 */
import * as d3 from 'd3';
import { distancePointToPoint } from './utils/geometry.js';

export class FloorPlanEditor {
  /**
   * @param {SVGSVGElement} svgElement - The SVG element to render into
   */
  constructor(svgElement) {
    this.svg = d3.select(svgElement);
    this.svgElement = svgElement;

    /** @type {Array<{segments: Array}>} */
    this.floors = [];
    /** @type {number} */
    this.activeFloorIndex = 0;
    /** @type {Array<Array>} */
    this.wallSegments = [];
    /** @type {Array<Object>} */
    this.measurements = [];
    /** @type {string} */
    this.currentTool = 'select';

    // Undo/redo
    this.undoStack = [];
    this.redoStack = [];

    // Callbacks
    this.onZoomChanged = null;

    // Set up SVG layers & interaction
    this._setupLayers();
    this._setupZoom();
    this._setupInteraction();
  }

  /**
   * Set up SVG layer groups for ordered rendering
   */
  _setupLayers() {
    // Main transform group (for zoom/pan)
    this.mainGroup = this.svg.append('g').attr('class', 'main-group');

    // Layer order: grid → walls → dimensions → interaction
    this.gridLayer = this.mainGroup.append('g').attr('class', 'grid-layer');
    this.wallLayer = this.mainGroup.append('g').attr('class', 'wall-layer');
    this.dimensionLayer = this.mainGroup.append('g').attr('class', 'dimension-layer');
    this.interactionLayer = this.mainGroup.append('g').attr('class', 'interaction-layer');
  }

  /**
   * Set up D3 zoom behavior
   */
  _setupZoom() {
    this.zoom = d3.zoom()
      .scaleExtent([0.01, 1000])
      .filter((event) => {
        // Allow wheel zoom in all modes; restrict click-drag zoom/pan to 'select' mode
        if (this.currentTool === 'measure' || this.currentTool === 'draw') {
          return event.type === 'wheel';
        }
        return !event.button;
      })
      .on('zoom', (event) => {
        this.mainGroup.attr('transform', event.transform);
        this._currentTransform = event.transform;
        if (this.onZoomChanged) {
          this.onZoomChanged(Math.round(event.transform.k * 100));
        }
      });

    this.svg.call(this.zoom);
    this._currentTransform = d3.zoomIdentity;
  }

  /**
   * Set up interactive click-to-measure and click-to-draw
   */
  _setupInteraction() {
    this._startPt = null;
    this._isMeasuring = false;

    this.svg.on('pointerdown', (event) => {
      if (this.currentTool !== 'measure' && this.currentTool !== 'draw') return;
      if (event.button !== 0) return; // left click only

      const [wx, wy] = d3.pointer(event, this.mainGroup.node());

      if (!this._isMeasuring) {
        // First click: start measurement / wall
        this._isMeasuring = true;
        this._startPt = [wx, wy];
      } else {
        // Second click: complete measurement / wall
        const endPt = [wx, wy];
        const dist = distancePointToPoint(this._startPt, endPt);

        if (dist >= 0.05) {
          this._pushUndo();
          if (this.currentTool === 'measure') {
            this.measurements.push({
              p1: this._startPt,
              p2: endPt,
              text: `${dist.toFixed(2)}m`,
            });
          } else if (this.currentTool === 'draw') {
            this.wallSegments.push([this._startPt, endPt]);
          }
          this.render();
        }

        this._isMeasuring = false;
        this._startPt = null;
        this.interactionLayer.selectAll('*').remove();
      }
    });

    this.svg.on('pointermove', (event) => {
      if (!this._isMeasuring || !this._startPt) return;

      const [wx, wy] = d3.pointer(event, this.mainGroup.node());
      const dist = distancePointToPoint(this._startPt, [wx, wy]);

      this.interactionLayer.selectAll('*').remove();

      // Rubberband line
      this.interactionLayer.append('line')
        .attr('class', this.currentTool === 'measure' ? 'dimension-line' : 'wall-line')
        .attr('x1', this._startPt[0]).attr('y1', this._startPt[1])
        .attr('x2', wx).attr('y2', wy)
        .attr('stroke', '#38bdf8')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4 4')
        .attr('vector-effect', 'non-scaling-stroke');

      // Live dimension text
      const midX = (this._startPt[0] + wx) / 2;
      const midY = (this._startPt[1] + wy) / 2;
      const bounds = this._getBounds() || { minX: 0, maxX: 10, minY: 0, maxY: 10 };
      const minDim = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 5;
      const fontSize = Math.max(0.12, Math.min(0.35, minDim * 0.06));

      this.interactionLayer.append('text')
        .attr('class', 'dimension-text')
        .attr('x', midX)
        .attr('y', midY - 0.2)
        .attr('font-size', fontSize)
        .attr('fill', '#38bdf8')
        .text(`${dist.toFixed(2)}m`);
    });

    // Right click cancels active drawing
    this.svg.on('contextmenu', (event) => {
      if (this._isMeasuring) {
        event.preventDefault();
        this._cancelInteraction();
      }
    });

    // Escape key cancels active drawing
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isMeasuring) {
        this._cancelInteraction();
      }
    });
  }

  _cancelInteraction() {
    this._isMeasuring = false;
    this._startPt = null;
    this.interactionLayer.selectAll('*').remove();
  }

  /**
   * Load floor plan data
   * @param {Array<{segments: Array, bounds: Object}>} floors
   */
  setFloorData(floors) {
    this.floors = floors;
    if (floors.length > 0) {
      this.switchFloor(0);
    }
  }

  /**
   * Switch to a floor
   * @param {number} index
   */
  switchFloor(index) {
    if (index < 0 || index >= this.floors.length) return;
    this.activeFloorIndex = index;
    const floor = this.floors[index];
    this.wallSegments = floor.segments || [];
    this.measurements = floor.measurements || [];
    this.render();
    this.fitToView();
  }

  /**
   * Render the entire floor plan
   */
  render() {
    this._renderGrid();
    this._renderWalls();
    this._renderDimensions();
  }

  /**
   * Render subtle background grid
   */
  _renderGrid() {
    this.gridLayer.selectAll('*').remove();

    if (!this.wallSegments.length) return;

    const bounds = this._getBounds();
    if (!bounds) return;

    const gridSize = 1; // 1 meter grid
    const startX = Math.floor(bounds.minX / gridSize) * gridSize - gridSize;
    const startY = Math.floor(bounds.minY / gridSize) * gridSize - gridSize;
    const endX = Math.ceil(bounds.maxX / gridSize) * gridSize + gridSize;
    const endY = Math.ceil(bounds.maxY / gridSize) * gridSize + gridSize;

    // Vertical lines
    for (let x = startX; x <= endX; x += gridSize) {
      this.gridLayer.append('line')
        .attr('x1', x).attr('y1', startY)
        .attr('x2', x).attr('y2', endY)
        .attr('stroke', '#1e293b')
        .attr('stroke-width', 0.02);
    }
    // Horizontal lines
    for (let y = startY; y <= endY; y += gridSize) {
      this.gridLayer.append('line')
        .attr('x1', startX).attr('y1', y)
        .attr('x2', endX).attr('y2', y)
        .attr('stroke', '#1e293b')
        .attr('stroke-width', 0.02);
    }
  }

  /**
   * Render wall segments
   */
  _renderWalls() {
    this.wallLayer.selectAll('*').remove();

    this.wallLayer.selectAll('.wall-line')
      .data(this.wallSegments)
      .enter()
      .append('line')
      .attr('class', 'wall-line')
      .attr('x1', (d) => d[0][0])
      .attr('y1', (d) => d[0][1])
      .attr('x2', (d) => d[1][0])
      .attr('y2', (d) => d[1][1]);
  }

  /**
   * Render overall floor plan dimension lines and user measurements
   */
  _renderDimensions() {
    this.dimensionLayer.selectAll('*').remove();

    const bounds = this._getBounds();
    if (!bounds) return;

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width <= 0 || height <= 0) return;

    // Dynamic offset and font size proportional to room dimensions
    const minDim = Math.min(width, height);
    const offset = Math.max(0.3, Math.min(1.2, minDim * 0.12));
    const fontSize = Math.max(0.12, Math.min(0.35, minDim * 0.06));

    // Bottom dimension (total width)
    this._drawDimension(
      [bounds.minX, bounds.maxY + offset], [bounds.maxX, bounds.maxY + offset],
      `${width.toFixed(2)}m`, fontSize
    );

    // Right dimension (total height)
    this._drawDimension(
      [bounds.maxX + offset, bounds.minY], [bounds.maxX + offset, bounds.maxY],
      `${height.toFixed(2)}m`, fontSize
    );

    // Draw custom user measurements
    for (const m of this.measurements) {
      this._drawDimension(m.p1, m.p2, m.text, fontSize);
    }
  }

  /**
   * Draw a single dimension line with tick marks and text
   */
  _drawDimension(p1, p2, text, fontSize = 0.18) {
    const group = this.dimensionLayer.append('g').attr('class', 'dimension-group');

    // Main line
    group.append('line')
      .attr('class', 'dimension-line')
      .attr('x1', p1[0]).attr('y1', p1[1])
      .attr('x2', p2[0]).attr('y2', p2[1]);

    // Tick marks
    const tickSize = fontSize * 0.6;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const nx = -dy / len * tickSize;
    const ny = dx / len * tickSize;

    // Start tick
    group.append('line')
      .attr('class', 'dimension-line')
      .attr('x1', p1[0] - nx).attr('y1', p1[1] - ny)
      .attr('x2', p1[0] + nx).attr('y2', p1[1] + ny);

    // End tick
    group.append('line')
      .attr('class', 'dimension-line')
      .attr('x1', p2[0] - nx).attr('y1', p2[1] - ny)
      .attr('x2', p2[0] + nx).attr('y2', p2[1] + ny);

    // Text
    const midX = (p1[0] + p2[0]) / 2;
    const midY = (p1[1] + p2[1]) / 2;
    group.append('text')
      .attr('class', 'dimension-text')
      .attr('x', midX + nx * 2.2)
      .attr('y', midY + ny * 2.2)
      .attr('font-size', fontSize)
      .text(text);
  }

  /**
   * Set the current tool
   * @param {string} tool - 'select' | 'draw' | 'erase' | 'measure'
   */
  setTool(tool) {
    this.currentTool = tool;
    this._cancelInteraction();

    // Adjust cursor
    const cursors = {
      select: 'default',
      draw: 'crosshair',
      erase: 'pointer',
      measure: 'crosshair',
    };
    this.svgElement.style.cursor = cursors[tool] || 'default';
  }

  /**
   * Fit the view to show all content
   */
  fitToView() {
    requestAnimationFrame(() => {
      const bounds = this._getBounds();
      if (!bounds) return;

      const rect = this.svgElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dataWidth = bounds.maxX - bounds.minX;
      const dataHeight = bounds.maxY - bounds.minY;
      if (dataWidth <= 0 || dataHeight <= 0) return;

      const padding = Math.max(0.5, Math.min(2.0, Math.max(dataWidth, dataHeight) * 0.15));
      const scaleX = rect.width / (dataWidth + padding * 2);
      const scaleY = rect.height / (dataHeight + padding * 2);
      const scale = Math.min(scaleX, scaleY);

      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;

      const transform = d3.zoomIdentity
        .translate(rect.width / 2, rect.height / 2)
        .scale(scale)
        .translate(-centerX, -centerY);

      this.svg.transition().duration(400).call(this.zoom.transform, transform);
    });
  }

  /**
   * Zoom in
   */
  zoomIn() {
    this.svg.transition().duration(300).call(this.zoom.scaleBy, 1.3);
  }

  /**
   * Zoom out
   */
  zoomOut() {
    this.svg.transition().duration(300).call(this.zoom.scaleBy, 0.7);
  }

  /**
   * Push current state to undo stack
   */
  _pushUndo() {
    this.undoStack.push({
      measurements: JSON.parse(JSON.stringify(this.measurements)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    this.redoStack = [];
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
  }

  /**
   * Undo last action
   */
  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push({
      measurements: JSON.parse(JSON.stringify(this.measurements)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    const state = this.undoStack.pop();
    this.measurements = state.measurements || [];
    this.wallSegments = state.wallSegments;
    this.render();
    return true;
  }

  /**
   * Redo last undone action
   */
  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push({
      measurements: JSON.parse(JSON.stringify(this.measurements)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    const state = this.redoStack.pop();
    this.measurements = state.measurements || [];
    this.wallSegments = state.wallSegments;
    this.render();
    return true;
  }

  /**
   * Get the bounding box of all content
   * @returns {{minX, minY, maxX, maxY}|null}
   */
  _getBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasData = false;

    for (const seg of this.wallSegments) {
      for (const p of seg) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
        hasData = true;
      }
    }

    for (const m of this.measurements) {
      minX = Math.min(minX, m.p1[0], m.p2[0]);
      minY = Math.min(minY, m.p1[1], m.p2[1]);
      maxX = Math.max(maxX, m.p1[0], m.p2[0]);
      maxY = Math.max(maxY, m.p1[1], m.p2[1]);
      hasData = true;
    }

    return hasData ? { minX, minY, maxX, maxY } : null;
  }

  /**
   * Get SVG element
   */
  getSVGElement() {
    return this.svgElement;
  }

  /**
   * Get export data
   */
  getExportData() {
    return {
      walls: this.wallSegments,
      measurements: this.measurements,
      bounds: this._getBounds(),
    };
  }
}
