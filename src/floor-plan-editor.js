/**
 * FloorPlanEditor — SVG-based 2D floor plan editor
 * Renders walls, dimensions, custom measurements, and text notes.
 * Supports Select, Pan (Hand), Text, Measure, Draw, Erase tools, and Undo/Redo.
 */
import * as d3 from 'd3';
import { distancePointToPoint, formatFeetInches } from './utils/geometry.js';

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
    /** @type {Array<Object>} */
    this.textNotes = [];
    /** @type {string} */
    this.currentTool = 'select';
    /** @type {Object|null} */
    this.selectedItem = null; // { type: 'measurement'|'text', data: Object }

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

    // Layer order: grid → walls → dimensions → labels → interaction
    this.gridLayer = this.mainGroup.append('g').attr('class', 'grid-layer');
    this.wallLayer = this.mainGroup.append('g').attr('class', 'wall-layer');
    this.dimensionLayer = this.mainGroup.append('g').attr('class', 'dimension-layer');
    this.labelLayer = this.mainGroup.append('g').attr('class', 'label-layer');
    this.interactionLayer = this.mainGroup.append('g').attr('class', 'interaction-layer');
  }

  /**
   * Set up D3 zoom behavior
   */
  _setupZoom() {
    this.zoom = d3.zoom()
      .scaleExtent([0.01, 1000])
      .filter((event) => {
        // Pan tool or spacebar or middle-click allows click-drag panning
        if (this.currentTool === 'pan' || event.spaceKey || event.button === 1) {
          return true;
        }
        // In measure, draw, or text modes, only allow wheel zoom
        if (this.currentTool === 'measure' || this.currentTool === 'draw' || this.currentTool === 'text') {
          return event.type === 'wheel';
        }
        // Select tool allows wheel zoom and background click-drag pan
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
   * Set up interactive tools (Select, Pan, Text, Measure, Draw, Erase)
   */
  _setupInteraction() {
    this._startPt = null;
    this._isMeasuring = false;

    // Pointer down handler for tools
    this.svg.on('pointerdown', (event) => {
      if (event.button !== 0) return; // Left click only

      const target = d3.select(event.target);

      // Select Tool
      if (this.currentTool === 'select') {
        const itemType = target.attr('data-type');
        const itemId = target.attr('data-id');

        if (itemType === 'measurement' && itemId) {
          event.stopPropagation();
          const meas = this.measurements.find((m) => m.id === itemId);
          this.selectedItem = meas ? { type: 'measurement', data: meas } : null;
          this.render();
        } else if (itemType === 'text' && itemId) {
          event.stopPropagation();
          const note = this.textNotes.find((n) => n.id === itemId);
          this.selectedItem = note ? { type: 'text', data: note } : null;
          this.render();
        } else {
          // Clicked background — deselect
          this.selectedItem = null;
          this.render();
        }
        return;
      }

      // Erase Tool
      if (this.currentTool === 'erase') {
        const itemType = target.attr('data-type');
        const itemId = target.attr('data-id');

        if (itemType === 'measurement' && itemId) {
          event.stopPropagation();
          this._pushUndo();
          this.measurements = this.measurements.filter((m) => m.id !== itemId);
          this.selectedItem = null;
          this.render();
        } else if (itemType === 'text' && itemId) {
          event.stopPropagation();
          this._pushUndo();
          this.textNotes = this.textNotes.filter((n) => n.id !== itemId);
          this.selectedItem = null;
          this.render();
        }
        return;
      }

      // Text Tool
      if (this.currentTool === 'text') {
        const [wx, wy] = d3.pointer(event, this.mainGroup.node());
        this._showTextInput(event.clientX, event.clientY, [wx, wy]);
        return;
      }

      // Measure or Draw Tools (snapped to 0°, 45°, or 90° axes)
      if (this.currentTool === 'measure' || this.currentTool === 'draw') {
        const [wx, wy] = d3.pointer(event, this.mainGroup.node());

        if (!this._isMeasuring) {
          // Start point
          this._isMeasuring = true;
          this._startPt = [wx, wy];
        } else {
          // End point snapped to nearest horizontal, vertical, or 45° axis
          const endPt = this._snapPoint(this._startPt, [wx, wy]);
          const dist = distancePointToPoint(this._startPt, endPt);

          if (dist >= 0.05) {
            this._pushUndo();
            if (this.currentTool === 'measure') {
              this.measurements.push({
                id: `m_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                p1: this._startPt,
                p2: endPt,
                text: formatFeetInches(dist),
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
      }
    });

    // Pointer move handler (for rubberband preview with axis snapping)
    this.svg.on('pointermove', (event) => {
      if (!this._isMeasuring || !this._startPt) return;

      const rawPt = d3.pointer(event, this.mainGroup.node());
      const endPt = this._snapPoint(this._startPt, rawPt);
      const dist = distancePointToPoint(this._startPt, endPt);

      this.interactionLayer.selectAll('*').remove();

      // Rubberband line (snapped)
      this.interactionLayer.append('line')
        .attr('class', this.currentTool === 'measure' ? 'dimension-line' : 'wall-line')
        .attr('x1', this._startPt[0]).attr('y1', this._startPt[1])
        .attr('x2', endPt[0]).attr('y2', endPt[1])
        .attr('stroke', '#38bdf8')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4 4')
        .attr('vector-effect', 'non-scaling-stroke');

      // Live dimension text
      const midX = (this._startPt[0] + endPt[0]) / 2;
      const midY = (this._startPt[1] + endPt[1]) / 2;
      const bounds = this._getBounds() || { minX: 0, maxX: 10, minY: 0, maxY: 10 };
      const minDim = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 5;
      const fontSize = Math.max(0.12, Math.min(0.35, minDim * 0.06));

      this.interactionLayer.append('text')
        .attr('class', 'dimension-text')
        .attr('x', midX)
        .attr('y', midY - 0.2)
        .attr('font-size', fontSize)
        .attr('fill', '#38bdf8')
        .text(formatFeetInches(dist));
    });

    // Right click cancels active drawing
    this.svg.on('contextmenu', (event) => {
      if (this._isMeasuring) {
        event.preventDefault();
        this._cancelInteraction();
      }
    });

    // Keyboard shortcuts (Delete / Backspace / Escape)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        if (this._isMeasuring) {
          this._cancelInteraction();
        } else if (this.selectedItem) {
          this.selectedItem = null;
          this.render();
        }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedItem) {
        e.preventDefault();
        this.deleteSelectedItem();
      }
    });
  }

  /**
   * Show inline text input on canvas for adding custom text notes
   */
  _showTextInput(screenX, screenY, worldPos) {
    // Remove existing input if any
    d3.select('.canvas-text-input').remove();

    const container = d3.select(this.svgElement.parentNode);
    const rect = this.svgElement.getBoundingClientRect();
    const relativeX = screenX - rect.left;
    const relativeY = screenY - rect.top;

    const input = container.append('input')
      .attr('type', 'text')
      .attr('class', 'canvas-text-input')
      .attr('placeholder', 'Type text note...')
      .style('left', `${relativeX}px`)
      .style('top', `${relativeY}px`);

    const node = input.node();
    node.focus();

    const commitText = () => {
      const val = node.value.trim();
      input.remove();
      if (val) {
        this._pushUndo();
        this.textNotes.push({
          id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          pos: worldPos,
          text: val,
        });
        this.render();
      }
    };

    input.on('keydown', (e) => {
      if (e.key === 'Enter') {
        commitText();
      } else if (e.key === 'Escape') {
        input.remove();
      }
    });

    input.on('blur', () => {
      commitText();
    });
  }

  /**
   * Delete currently selected item (measurement or text note)
   */
  deleteSelectedItem() {
    if (!this.selectedItem) return;

    this._pushUndo();
    const { type, data } = this.selectedItem;

    if (type === 'measurement') {
      this.measurements = this.measurements.filter((m) => m.id !== data.id);
    } else if (type === 'text') {
      this.textNotes = this.textNotes.filter((n) => n.id !== data.id);
    }

    this.selectedItem = null;
    this.render();
  }

  /**
   * Snap point p2 relative to p1 to the nearest 45-degree angle (0°, 45°, 90°, 135°, 180°, etc.)
   * @param {[number, number]} p1 - Start point
   * @param {[number, number]} p2 - Raw target point
   * @returns {[number, number]} Snapped target point
   */
  _snapPoint(p1, p2) {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return p2;

    const angle = Math.atan2(dy, dx);
    const snapInterval = Math.PI / 4; // 45 degrees
    const snappedAngle = Math.round(angle / snapInterval) * snapInterval;

    return [
      p1[0] + dist * Math.cos(snappedAngle),
      p1[1] + dist * Math.sin(snappedAngle),
    ];
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
    this.textNotes = floor.textNotes || [];
    this.selectedItem = null;
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
    this._renderTextNotes();
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
      formatFeetInches(width), fontSize, null
    );

    // Right dimension (total height)
    this._drawDimension(
      [bounds.maxX + offset, bounds.minY], [bounds.maxX + offset, bounds.maxY],
      formatFeetInches(height), fontSize, null
    );

    // Draw custom user measurements
    for (const m of this.measurements) {
      const isSelected = this.selectedItem?.type === 'measurement' && this.selectedItem?.data?.id === m.id;
      this._drawDimension(m.p1, m.p2, m.text, fontSize, m.id, isSelected);
    }
  }

  /**
   * Draw a single dimension line with tick marks and text
   */
  _drawDimension(p1, p2, text, fontSize = 0.18, id = null, isSelected = false) {
    const group = this.dimensionLayer.append('g')
      .attr('class', `dimension-group${isSelected ? ' selected' : ''}`);

    if (id) {
      group.attr('data-type', 'measurement').attr('data-id', id);
    }

    // Main line
    group.append('line')
      .attr('class', 'dimension-line')
      .attr('data-type', id ? 'measurement' : null)
      .attr('data-id', id || null)
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
      .attr('data-type', id ? 'measurement' : null)
      .attr('data-id', id || null)
      .attr('x1', p1[0] - nx).attr('y1', p1[1] - ny)
      .attr('x2', p1[0] + nx).attr('y2', p1[1] + ny);

    // End tick
    group.append('line')
      .attr('class', 'dimension-line')
      .attr('data-type', id ? 'measurement' : null)
      .attr('data-id', id || null)
      .attr('x1', p2[0] - nx).attr('y1', p2[1] - ny)
      .attr('x2', p2[0] + nx).attr('y2', p2[1] + ny);

    // Text
    const midX = (p1[0] + p2[0]) / 2;
    const midY = (p1[1] + p2[1]) / 2;
    group.append('text')
      .attr('class', 'dimension-text')
      .attr('data-type', id ? 'measurement' : null)
      .attr('data-id', id || null)
      .attr('x', midX + nx * 2.2)
      .attr('y', midY + ny * 2.2)
      .attr('font-size', fontSize)
      .attr('fill', isSelected ? '#38bdf8' : '#ffffff')
      .text(text);
  }

  /**
   * Render custom user text notes
   */
  _renderTextNotes() {
    this.labelLayer.selectAll('*').remove();

    const bounds = this._getBounds() || { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    const minDim = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 5;
    const fontSize = Math.max(0.14, Math.min(0.4, minDim * 0.07));

    for (const note of this.textNotes) {
      const isSelected = this.selectedItem?.type === 'text' && this.selectedItem?.data?.id === note.id;

      this.labelLayer.append('text')
        .attr('class', `text-note${isSelected ? ' selected' : ''}`)
        .attr('data-type', 'text')
        .attr('data-id', note.id)
        .attr('x', note.pos[0])
        .attr('y', note.pos[1])
        .attr('font-size', fontSize)
        .attr('fill', isSelected ? '#38bdf8' : '#facc15')
        .text(note.text);
    }
  }

  /**
   * Set the current tool
   * @param {string} tool - 'select' | 'pan' | 'text' | 'draw' | 'measure' | 'erase'
   */
  setTool(tool) {
    this.currentTool = tool;
    this._cancelInteraction();

    // Adjust cursor
    const cursors = {
      select: 'default',
      pan: 'grab',
      text: 'text',
      draw: 'crosshair',
      measure: 'crosshair',
      erase: 'pointer',
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
      textNotes: JSON.parse(JSON.stringify(this.textNotes)),
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
      textNotes: JSON.parse(JSON.stringify(this.textNotes)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    const state = this.undoStack.pop();
    this.measurements = state.measurements || [];
    this.textNotes = state.textNotes || [];
    this.wallSegments = state.wallSegments;
    this.selectedItem = null;
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
      textNotes: JSON.parse(JSON.stringify(this.textNotes)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    const state = this.redoStack.pop();
    this.measurements = state.measurements || [];
    this.textNotes = state.textNotes || [];
    this.wallSegments = state.wallSegments;
    this.selectedItem = null;
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

    for (const n of this.textNotes) {
      minX = Math.min(minX, n.pos[0]);
      minY = Math.min(minY, n.pos[1]);
      maxX = Math.max(maxX, n.pos[0]);
      maxY = Math.max(maxY, n.pos[1]);
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
      textNotes: this.textNotes,
      bounds: this._getBounds(),
    };
  }
}
