/**
 * FloorPlanEditor — SVG-based 2D floor plan editor
 * Renders walls, rooms, labels, and dimensions as interactive SVG elements.
 * Supports pan, zoom, room selection, labeling, and wall editing.
 */
import * as d3 from 'd3';
import { polygonArea, polygonCentroid, distancePointToPoint } from './utils/geometry.js';

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
    /** @type {Array<Object>} */
    this.rooms = [];
    /** @type {Array<Array>} */
    this.wallSegments = [];
    /** @type {string} */
    this.currentTool = 'select';
    /** @type {Object|null} */
    this.selectedRoom = null;

    // Undo/redo
    this.undoStack = [];
    this.redoStack = [];

    // Callbacks
    this.onRoomSelected = null;
    this.onRoomUpdated = null;
    this.onZoomChanged = null;

    // Set up SVG layers
    this._setupLayers();
    this._setupZoom();

    // Drawing state
    this._drawingPoints = [];
    this._isDrawing = false;
  }

  /**
   * Set up SVG layer groups for ordered rendering
   */
  _setupLayers() {
    // Main transform group (for zoom/pan)
    this.mainGroup = this.svg.append('g').attr('class', 'main-group');

    // Layer order: grid → rooms → walls → dimensions → labels → interaction
    this.gridLayer = this.mainGroup.append('g').attr('class', 'grid-layer');
    this.roomLayer = this.mainGroup.append('g').attr('class', 'room-layer');
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
      .scaleExtent([0.1, 50])
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
   * Load floor plan data for multiple floors
   * @param {Array<{segments: Array, rooms: Array, bounds: Object}>} floors
   */
  setFloorData(floors) {
    this.floors = floors;
    if (floors.length > 0) {
      this.switchFloor(0);
    }
  }

  /**
   * Switch to a different floor
   * @param {number} index
   */
  switchFloor(index) {
    if (index < 0 || index >= this.floors.length) return;
    this.activeFloorIndex = index;
    const floor = this.floors[index];
    this.wallSegments = floor.segments || [];
    this.rooms = floor.rooms || [];
    this.selectedRoom = null;
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
   * Render room polygons
   */
  _renderRooms() {
    this.roomLayer.selectAll('*').remove();

    const roomElements = this.roomLayer.selectAll('.room-group')
      .data(this.rooms)
      .enter()
      .append('g')
      .attr('class', 'room-group');

    roomElements.append('polygon')
      .attr('class', (d) => `room-fill${d === this.selectedRoom ? ' selected' : ''}`)
      .attr('points', (d) => d.polygon.map((p) => `${p[0]},${p[1]}`).join(' '))
      .on('click', (event, d) => {
        event.stopPropagation();
        if (this.currentTool === 'select' || this.currentTool === 'label') {
          this._selectRoom(d);
        }
      });

    // Click on background to deselect
    this.svg.on('click', () => {
      if (this.currentTool === 'select') {
        this._selectRoom(null);
      }
    });
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
      .attr('y2', (d) => d[1][1])
      .attr('stroke-width', 0.08);
  }

  /**
   * Render overall floor plan dimension lines
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
   * Render room labels
   */
  _renderLabels() {
    this.labelLayer.selectAll('*').remove();

    for (const room of this.rooms) {
      if (!room.centroid) continue;

      // Room name
      this.labelLayer.append('text')
        .attr('class', 'room-label')
        .attr('x', room.centroid[0])
        .attr('y', room.centroid[1] - 0.15)
        .attr('font-size', 0.2)
        .text(room.name || 'Room');

      // Room area
      this.labelLayer.append('text')
        .attr('class', 'room-area-label')
        .attr('x', room.centroid[0])
        .attr('y', room.centroid[1] + 0.2)
        .attr('font-size', 0.15)
        .text(`${Math.abs(room.area).toFixed(1)} m²`);
    }
  }

  /**
   * Select a room
   * @param {Object|null} room
   */
  _selectRoom(room) {
    this.selectedRoom = room;
    this.render();
    if (this.onRoomSelected) {
      this.onRoomSelected(room);
    }
  }

  /**
   * Update a room's properties
   * @param {Object} room
   * @param {Object} updates - { name?, type? }
   */
  updateRoom(room, updates) {
    // Save undo state
    this._pushUndo();

    Object.assign(room, updates);
    this.render();
    if (this.onRoomUpdated) {
      this.onRoomUpdated(room);
    }
  }

  /**
   * Delete a room
   * @param {Object} room
   */
  deleteRoom(room) {
    this._pushUndo();
    const idx = this.rooms.indexOf(room);
    if (idx >= 0) {
      this.rooms.splice(idx, 1);
      if (this.selectedRoom === room) {
        this.selectedRoom = null;
      }
      this.render();
    }
  }

  /**
   * Add a wall segment
   * @param {Array} segment [[x1,y1],[x2,y2]]
   */
  addWallSegment(segment) {
    this._pushUndo();
    this.wallSegments.push(segment);
    this.render();
  }

  /**
   * Set the current tool
   * @param {string} tool - 'select' | 'label' | 'draw' | 'erase' | 'measure'
   */
  setTool(tool) {
    this.currentTool = tool;
    this._isDrawing = false;
    this._drawingPoints = [];

    // Adjust cursor
    const cursors = {
      select: 'default',
      label: 'pointer',
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
      rooms: JSON.parse(JSON.stringify(this.rooms)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    this.redoStack = [];
    // Limit undo stack size
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
      rooms: JSON.parse(JSON.stringify(this.rooms)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    const state = this.undoStack.pop();
    this.rooms = state.rooms;
    this.wallSegments = state.wallSegments;
    this.selectedRoom = null;
    this.render();
    return true;
  }

  /**
   * Redo last undone action
   */
  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push({
      rooms: JSON.parse(JSON.stringify(this.rooms)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    });
    const state = this.redoStack.pop();
    this.rooms = state.rooms;
    this.wallSegments = state.wallSegments;
    this.selectedRoom = null;
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

    for (const room of this.rooms) {
      for (const p of room.polygon) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
        hasData = true;
      }
    }

    return hasData ? { minX, minY, maxX, maxY } : null;
  }

  /**
   * Get the SVG element for PDF export
   * @returns {SVGSVGElement}
   */
  getSVGElement() {
    return this.svgElement;
  }

  /**
   * Get the current floor plan data for export
   */
  getExportData() {
    return {
      walls: this.wallSegments,
      rooms: this.rooms,
      bounds: this._getBounds(),
    };
  }
}
