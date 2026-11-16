/**
 * FloorPlanEditor — SVG-based 2D floor plan editor
 * Renders walls, dimensions, custom measurements, and text notes.
 * Supports Select, Pan (Hand), Text, Measure, Draw, Erase tools, and Undo/Redo.
 */
import * as d3 from 'd3';
import { distancePointToPoint, formatDistance } from './utils/geometry.js';

function isTypingElement(target) {
  if (!target || typeof target.tagName !== 'string') return false;
  const tag = target.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target.getAttribute?.('type') || target.type || 'text').toLowerCase();
    return !['range', 'button', 'checkbox', 'radio', 'submit', 'reset', 'file'].includes(type);
  }
  return Boolean(target.isContentEditable || target.getAttribute?.('contenteditable') === 'true');
}

export class FloorPlanEditor {
  /**
   * @param {SVGSVGElement} svgElement - The SVG element to render into
   * @param {Object} [settings] - Initial editor settings
   */
  constructor(svgElement, settings = {}) {
    this.svg = d3.select(svgElement);
    this.svgElement = svgElement;

    this.floors = [];
    this.activeFloorIndex = 0;
    this.wallSegments = [];
    this.measurements = [];
    this.textNotes = [];
    this.currentTool = 'select';
    this.selectedItem = null; // { type: 'measurement'|'text'|'wall', data?: Object, index?: number }

    this.settings = {
      units: settings.units || 'imperial',
      snapAngle: typeof settings.snapAngle === 'number' ? settings.snapAngle : 45,
      showGrid: typeof settings.showGrid === 'boolean' ? settings.showGrid : true,
    };

    // Undo/redo
    this.undoStack = [];
    this.redoStack = [];

    // Callbacks
    this.onZoomChanged = null;
    this.onHistoryChanged = null;
    this.onPlanMutated = null;

    this._setupLayers();
    this._setupZoom();
    this._setupInteraction();
  }

  /**
   * Apply updated settings and re-render editor cleanly.
   * @param {Object} settings
   */
  setSettings(settings) {
    if (!settings) return;
    const nextUnits = settings.units === 'metric' ? 'metric' : 'imperial';
    const unitsChanged = nextUnits !== this.settings.units;

    this.settings = {
      units: nextUnits,
      snapAngle: typeof settings.snapAngle === 'number' ? settings.snapAngle : this.settings.snapAngle,
      showGrid: typeof settings.showGrid === 'boolean' ? settings.showGrid : this.settings.showGrid,
    };

    if (unitsChanged) {
      for (const m of this.measurements) {
        const dist = distancePointToPoint(m.p1, m.p2);
        m.text = formatDistance(dist, this.settings.units);
      }
    }

    this.render();
  }

  _setupLayers() {
    this.mainGroup = this.svg.append('g').attr('class', 'main-group');
    this.gridLayer = this.mainGroup.append('g').attr('class', 'grid-layer');
    this.wallLayer = this.mainGroup.append('g').attr('class', 'wall-layer');
    this.dimensionLayer = this.mainGroup.append('g').attr('class', 'dimension-layer');
    this.labelLayer = this.mainGroup.append('g').attr('class', 'label-layer');
    this.interactionLayer = this.mainGroup.append('g').attr('class', 'interaction-layer');
  }

  _setupZoom() {
    this.zoom = d3.zoom()
      .scaleExtent([0.01, 1000])
      .filter((event) => {
        const isInteractive = event.target && (
          event.target.classList.contains('text-note') ||
          event.target.classList.contains('dimension-text') ||
          event.target.classList.contains('dimension-line') ||
          event.target.getAttribute('data-type') === 'text' ||
          event.target.getAttribute('data-type') === 'measurement'
        );
        if (isInteractive) {
          return event.type === 'wheel';
        }

        if (this.currentTool === 'pan' || event.spaceKey || event.button === 1) {
          return true;
        }
        if (this.currentTool === 'measure' || this.currentTool === 'draw' || this.currentTool === 'text') {
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

  _setupInteraction() {
    this._startPt = null;
    this._isMeasuring = false;

    this.svg.on('pointerdown', (event) => {
      if (event.button !== 0) return;

      const target = d3.select(event.target);

      // Select Tool
      if (this.currentTool === 'select') {
        const itemType = target.attr('data-type');
        const itemId = target.attr('data-id');
        const itemIdxAttr = target.attr('data-index');

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
        } else if (itemType === 'wall' && itemIdxAttr !== null) {
          event.stopPropagation();
          const idx = parseInt(itemIdxAttr, 10);
          if (!Number.isNaN(idx) && this.wallSegments[idx]) {
            this.selectedItem = { type: 'wall', index: idx };
            this.render();
          }
        } else {
          this.selectedItem = null;
          this.render();
        }
        return;
      }

      // Erase Tool
      if (this.currentTool === 'erase') {
        const itemType = target.attr('data-type');
        const itemId = target.attr('data-id');
        const itemIdxAttr = target.attr('data-index');

        if (itemType === 'measurement' && itemId) {
          event.stopPropagation();
          this._pushUndo();
          this.measurements = this.measurements.filter((m) => m.id !== itemId);
          this.selectedItem = null;
          this.render();
          this._emitMutated();
        } else if (itemType === 'text' && itemId) {
          event.stopPropagation();
          this._pushUndo();
          this.textNotes = this.textNotes.filter((n) => n.id !== itemId);
          this.selectedItem = null;
          this.render();
          this._emitMutated();
        } else if (itemType === 'wall' && itemIdxAttr !== null) {
          event.stopPropagation();
          const idx = parseInt(itemIdxAttr, 10);
          if (!Number.isNaN(idx) && idx >= 0 && idx < this.wallSegments.length) {
            this._pushUndo();
            this.wallSegments.splice(idx, 1);
            this.selectedItem = null;
            this.render();
            this._emitMutated();
          }
        }
        return;
      }

      // Text Tool
      if (this.currentTool === 'text') {
        const [wx, wy] = d3.pointer(event, this.mainGroup.node());
        this._showTextInput(event.clientX, event.clientY, [wx, wy]);
        return;
      }

      // Measure or Draw Tools
      if (this.currentTool === 'measure' || this.currentTool === 'draw') {
        const [wx, wy] = d3.pointer(event, this.mainGroup.node());

        if (!this._isMeasuring) {
          this._isMeasuring = true;
          this._startPt = [wx, wy];
        } else {
          const endPt = this._snapPoint(this._startPt, [wx, wy]);
          const dist = distancePointToPoint(this._startPt, endPt);

          if (dist >= 0.05) {
            this._pushUndo();
            if (this.currentTool === 'measure') {
              this.measurements.push({
                id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                p1: this._startPt,
                p2: endPt,
                text: formatDistance(dist, this.settings.units),
              });
            } else if (this.currentTool === 'draw') {
              this.wallSegments.push([this._startPt, endPt]);
            }
            this.render();
            this._emitMutated();
          }

          this._isMeasuring = false;
          this._startPt = null;
          this.interactionLayer.selectAll('*').remove();
        }
      }
    });

    // Rubberband preview
    this.svg.on('pointermove', (event) => {
      if (!this._isMeasuring || !this._startPt) return;

      const rawPt = d3.pointer(event, this.mainGroup.node());
      const endPt = this._snapPoint(this._startPt, rawPt);
      const dist = distancePointToPoint(this._startPt, endPt);

      this.interactionLayer.selectAll('*').remove();

      this.interactionLayer.append('line')
        .attr('class', this.currentTool === 'measure' ? 'dimension-line' : 'wall-line')
        .attr('x1', this._startPt[0]).attr('y1', this._startPt[1])
        .attr('x2', endPt[0]).attr('y2', endPt[1])
        .attr('stroke', '#38bdf8')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4 4')
        .attr('vector-effect', 'non-scaling-stroke');

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
        .text(formatDistance(dist, this.settings.units));
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
      if (isTypingElement(e.target)) return;

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

  _showTextInput(screenX, screenY, worldPos, existingNote = null) {
    d3.select('.canvas-text-input').remove();

    const container = d3.select(this.svgElement.parentNode);
    const rect = this.svgElement.getBoundingClientRect();
    const relativeX = Math.max(8, Math.min(rect.width - 180, screenX - rect.left));
    const relativeY = Math.max(8, Math.min(rect.height - 40, screenY - rect.top));

    const input = container.append('input')
      .attr('type', 'text')
      .attr('class', 'canvas-text-input')
      .attr('placeholder', 'Type label & press Enter...')
      .style('left', `${relativeX}px`)
      .style('top', `${relativeY}px`);

    const node = input.node();
    if (existingNote) {
      node.value = existingNote.text;
    }

    setTimeout(() => {
      node.focus();
      node.select();
    }, 50);

    let isCommitted = false;
    const commitText = () => {
      if (isCommitted) return;
      isCommitted = true;
      const val = node.value.trim();
      input.remove();

      if (existingNote) {
        if (val === existingNote.text) return;
        this._pushUndo();
        if (val) {
          existingNote.text = val;
        } else {
          this.textNotes = this.textNotes.filter((n) => n.id !== existingNote.id);
          this.selectedItem = null;
        }
        this.render();
        this._emitMutated();
      } else if (val) {
        this._pushUndo();
        this.textNotes.push({
          id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          pos: worldPos,
          text: val,
        });
        this.render();
        this._emitMutated();
      }
    };

    input.on('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        commitText();
      } else if (e.key === 'Escape') {
        isCommitted = true;
        input.remove();
      }
    });

    setTimeout(() => {
      input.on('blur', () => {
        commitText();
      });
    }, 300);
  }

  /**
   * Delete currently selected item (wall, measurement, or text note)
   */
  deleteSelectedItem() {
    if (!this.selectedItem) return false;

    this._pushUndo();
    const { type, data, index } = this.selectedItem;

    if (type === 'measurement') {
      this.measurements = this.measurements.filter((m) => m.id !== data.id);
    } else if (type === 'text') {
      this.textNotes = this.textNotes.filter((n) => n.id !== data.id);
    } else if (type === 'wall' && typeof index === 'number') {
      this.wallSegments.splice(index, 1);
    }

    this.selectedItem = null;
    this.render();
    this._emitMutated();
    return true;
  }

  /**
   * Add or update a text label inside a specific point (e.g. renaming a detected room).
   * @param {[number, number]} pos
   * @param {string} labelText
   * @param {string|null} [existingId]
   */
  setRoomLabel(pos, labelText, existingId = null) {
    const trimmed = (labelText || '').trim();
    if (!trimmed) return;

    this._pushUndo();
    if (existingId) {
      const existing = this.textNotes.find((n) => n.id === existingId);
      if (existing) {
        existing.text = trimmed;
      }
    } else {
      this.textNotes.push({
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        pos: [pos[0], pos[1]],
        text: trimmed,
      });
    }
    this.render();
    this._emitMutated();
  }

  /**
   * Insert a sample closed rectangular room template (helpful from empty states).
   * @param {number} [width=4]
   * @param {number} [height=3]
   */
  insertRoomTemplate(width = 4, height = 3) {
    this._pushUndo();
    const bounds = this._getBounds();
    const offsetX = bounds ? bounds.maxX + 1.5 : 0;
    const offsetY = bounds ? bounds.minY : 0;

    // Outer shell + inner room wall loop so detectRooms detects the enclosed room cleanly
    const pad = 0.2;
    const x0 = offsetX;
    const y0 = offsetY;
    const x1 = offsetX + width;
    const y1 = offsetY + height;

    // If canvas was empty, include an outer perimeter shell 0.2m outside the room walls
    // (because room-detector filters out the outermost polygon)
    if (this.wallSegments.length === 0) {
      this.wallSegments.push(
        [[x0 - pad, y0 - pad], [x1 + pad, y0 - pad]],
        [[x1 + pad, y0 - pad], [x1 + pad, y1 + pad]],
        [[x1 + pad, y1 + pad], [x0 - pad, y1 + pad]],
        [[x0 - pad, y1 + pad], [x0 - pad, y0 - pad]]
      );
    }

    this.wallSegments.push(
      [[x0, y0], [x1, y0]],
      [[x1, y0], [x1, y1]],
      [[x1, y1], [x0, y1]],
      [[x0, y1], [x0, y0]]
    );

    this.textNotes.push({
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      pos: [(x0 + x1) / 2, (y0 + y1) / 2],
      text: 'Sample Room',
    });

    this.selectedItem = null;
    this.render();
    this.fitToView();
    this._emitMutated();
  }

  /**
   * Clear all floor plan geometry and annotations.
   */
  clearPlan() {
    this._pushUndo();
    this.wallSegments = [];
    this.measurements = [];
    this.textNotes = [];
    this.selectedItem = null;
    this.render();
    this._emitMutated();
  }

  /**
   * Pan/center the viewport on a 2D world coordinate.
   * @param {[number, number]} pt
   */
  focusPoint(pt) {
    if (!pt) return;
    const rect = this.svgElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const k = Math.max(this._currentTransform?.k || 40, 40);
    const transform = d3.zoomIdentity
      .translate(rect.width / 2, rect.height / 2)
      .scale(k)
      .translate(-pt[0], -pt[1]);
    this.svg.transition().duration(350).call(this.zoom.transform, transform);
  }

  _snapPoint(p1, p2) {
    const snapDeg = this.settings.snapAngle;
    if (!snapDeg || snapDeg <= 0) return p2;

    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return p2;

    const angle = Math.atan2(dy, dx);
    const snapInterval = (snapDeg * Math.PI) / 180;
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
   * @param {Array<{segments: Array, bounds?: Object}>} floors
   * @param {{ resetHistory?: boolean }} [options]
   */
  setFloorData(floors, options = {}) {
    const { resetHistory = true } = options;
    this.floors = floors;
    if (resetHistory) {
      this.undoStack = [];
      this.redoStack = [];
      this._emitHistory();
    }
    if (floors.length > 0) {
      this.switchFloor(0);
    } else {
      this.wallSegments = [];
      this.measurements = [];
      this.textNotes = [];
      this.selectedItem = null;
      this.render();
      this._emitMutated();
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
    this.wallSegments = (floor.segments || []).map((s) => [[s[0][0], s[0][1]], [s[1][0], s[1][1]]]);
    this.measurements = (floor.measurements || []).map((m) => ({
      ...m,
      p1: [m.p1[0], m.p1[1]],
      p2: [m.p2[0], m.p2[1]],
    }));
    this.textNotes = (floor.textNotes || []).map((n) => ({
      ...n,
      pos: [n.pos[0], n.pos[1]],
    }));
    this.selectedItem = null;
    this.render();
    this.fitToView();
    this._emitHistory();
    this._emitMutated();
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

  _renderGrid() {
    this.gridLayer.selectAll('*').remove();

    if (!this.settings.showGrid || !this.wallSegments.length) return;

    const bounds = this._getBounds();
    if (!bounds) return;

    const gridSize = 1;
    const startX = Math.floor(bounds.minX / gridSize) * gridSize - gridSize;
    const startY = Math.floor(bounds.minY / gridSize) * gridSize - gridSize;
    const endX = Math.ceil(bounds.maxX / gridSize) * gridSize + gridSize;
    const endY = Math.ceil(bounds.maxY / gridSize) * gridSize + gridSize;

    // Cap grid density if span is huge
    if (endX - startX > 300 || endY - startY > 300) return;

    for (let x = startX; x <= endX; x += gridSize) {
      this.gridLayer.append('line')
        .attr('x1', x).attr('y1', startY)
        .attr('x2', x).attr('y2', endY)
        .attr('stroke', '#1e293b')
        .attr('stroke-width', 0.02);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      this.gridLayer.append('line')
        .attr('x1', startX).attr('y1', y)
        .attr('x2', endX).attr('y2', y)
        .attr('stroke', '#1e293b')
        .attr('stroke-width', 0.02);
    }
  }

  _renderWalls() {
    this.wallLayer.selectAll('*').remove();

    const selectedWallIdx = this.selectedItem?.type === 'wall' ? this.selectedItem.index : -1;

    this.wallLayer.selectAll('.wall-line')
      .data(this.wallSegments)
      .enter()
      .append('line')
      .attr('class', (_, i) => `wall-line${i === selectedWallIdx ? ' selected' : ''}`)
      .attr('data-type', 'wall')
      .attr('data-index', (_, i) => i)
      .attr('x1', (d) => d[0][0])
      .attr('y1', (d) => d[0][1])
      .attr('x2', (d) => d[1][0])
      .attr('y2', (d) => d[1][1]);
  }

  _renderDimensions() {
    this.dimensionLayer.selectAll('*').remove();

    const bounds = this._getBounds();
    if (!bounds) return;

    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width <= 0 || height <= 0) return;

    const minDim = Math.min(width, height);
    const offset = Math.max(0.3, Math.min(1.2, minDim * 0.12));
    const fontSize = Math.max(0.12, Math.min(0.35, minDim * 0.06));

    this._drawDimension(
      [bounds.minX, bounds.maxY + offset], [bounds.maxX, bounds.maxY + offset],
      formatDistance(width, this.settings.units), fontSize, null
    );

    this._drawDimension(
      [bounds.maxX + offset, bounds.minY], [bounds.maxX + offset, bounds.maxY],
      formatDistance(height, this.settings.units), fontSize, null
    );

    for (const m of this.measurements) {
      const isSelected = this.selectedItem?.type === 'measurement' && this.selectedItem?.data?.id === m.id;
      this._drawDimension(m.p1, m.p2, m.text, fontSize, m.id, isSelected);
    }
  }

  _drawDimension(p1, p2, text, fontSize = 0.18, id = null, isSelected = false) {
    const group = this.dimensionLayer.append('g')
      .attr('class', `dimension-group${isSelected ? ' selected' : ''}`);

    if (id) {
      group.attr('data-type', 'measurement').attr('data-id', id);
    }

    group.append('line')
      .attr('class', 'dimension-line')
      .attr('data-type', id ? 'measurement' : null)
      .attr('data-id', id || null)
      .attr('x1', p1[0]).attr('y1', p1[1])
      .attr('x2', p2[0]).attr('y2', p2[1]);

    const tickSize = fontSize * 0.6;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const nx = (-dy / len) * tickSize;
    const ny = (dx / len) * tickSize;

    group.append('line')
      .attr('class', 'dimension-line')
      .attr('data-type', id ? 'measurement' : null)
      .attr('data-id', id || null)
      .attr('x1', p1[0] - nx).attr('y1', p1[1] - ny)
      .attr('x2', p1[0] + nx).attr('y2', p1[1] + ny);

    group.append('line')
      .attr('class', 'dimension-line')
      .attr('data-type', id ? 'measurement' : null)
      .attr('data-id', id || null)
      .attr('x1', p2[0] - nx).attr('y1', p2[1] - ny)
      .attr('x2', p2[0] + nx).attr('y2', p2[1] + ny);

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

  _renderTextNotes() {
    this.labelLayer.selectAll('*').remove();

    const bounds = this._getBounds() || { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    const minDim = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 5;
    const fontSize = Math.max(0.14, Math.min(0.4, minDim * 0.07));

    const self = this;

    for (const note of this.textNotes) {
      const isSelected = this.selectedItem?.type === 'text' && this.selectedItem?.data?.id === note.id;

      const textElem = this.labelLayer.append('text')
        .attr('class', `text-note${isSelected ? ' selected' : ''}`)
        .attr('data-type', 'text')
        .attr('data-id', note.id)
        .attr('x', note.pos[0])
        .attr('y', note.pos[1])
        .attr('font-size', fontSize)
        .attr('fill', isSelected ? '#38bdf8' : '#facc15')
        .text(note.text);

      textElem.on('pointerdown', (event) => {
        if (self.currentTool !== 'select' || event.button !== 0) return;
        event.stopPropagation();
        event.preventDefault();

        self.selectedItem = { type: 'text', data: note };
        self.labelLayer.selectAll('.text-note').classed('selected', false).attr('fill', '#facc15');
        textElem.classed('selected', true).attr('fill', '#38bdf8');

        // Snapshot before drag mutates note.pos so Undo restores the pre-drag coordinates
        const preDragSnapshot = self._snapshotState();
        const startMouseX = event.clientX;
        const startMouseY = event.clientY;
        const startPosX = note.pos[0];
        const startPosY = note.pos[1];
        const scale = self._currentTransform ? self._currentTransform.k : 1;

        let hasDragged = false;

        const onPointerMove = (moveEv) => {
          const dx = (moveEv.clientX - startMouseX) / scale;
          const dy = (moveEv.clientY - startMouseY) / scale;
          if (Math.abs(moveEv.clientX - startMouseX) > 2 || Math.abs(moveEv.clientY - startMouseY) > 2) {
            hasDragged = true;
          }
          note.pos = [startPosX + dx, startPosY + dy];
          textElem.attr('x', note.pos[0]).attr('y', note.pos[1]);
        };

        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          if (hasDragged) {
            self.undoStack.push(preDragSnapshot);
            self.redoStack = [];
            if (self.undoStack.length > 50) {
              self.undoStack.shift();
            }
            self._emitHistory();
            self._emitMutated();
          }
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });

      textElem.on('dblclick', (event) => {
        event.stopPropagation();
        self._showTextInput(event.clientX, event.clientY, note.pos, note);
      });
    }
  }

  /**
   * Set the current tool
   * @param {string} tool - 'select' | 'pan' | 'text' | 'draw' | 'measure' | 'erase'
   */
  setTool(tool) {
    this.currentTool = tool;
    this._cancelInteraction();

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

  zoomIn() {
    this.svg.transition().duration(250).call(this.zoom.scaleBy, 1.3);
  }

  zoomOut() {
    this.svg.transition().duration(250).call(this.zoom.scaleBy, 0.7);
  }

  _snapshotState() {
    return {
      measurements: JSON.parse(JSON.stringify(this.measurements)),
      textNotes: JSON.parse(JSON.stringify(this.textNotes)),
      wallSegments: JSON.parse(JSON.stringify(this.wallSegments)),
    };
  }

  _emitHistory() {
    if (this.onHistoryChanged) {
      this.onHistoryChanged({
        canUndo: this.undoStack.length > 0,
        canRedo: this.redoStack.length > 0,
      });
    }
  }

  _emitMutated() {
    if (this.floors[this.activeFloorIndex]) {
      this.floors[this.activeFloorIndex].segments = this.wallSegments;
      this.floors[this.activeFloorIndex].walls = this.wallSegments;
      this.floors[this.activeFloorIndex].measurements = this.measurements;
      this.floors[this.activeFloorIndex].textNotes = this.textNotes;
      this.floors[this.activeFloorIndex].bounds = this._getBounds() || this.floors[this.activeFloorIndex].bounds;
    }
    if (this.onPlanMutated) {
      this.onPlanMutated(this.getExportData());
    }
  }

  _pushUndo() {
    this.undoStack.push(this._snapshotState());
    this.redoStack = [];
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
    this._emitHistory();
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this._snapshotState());
    const prev = this.undoStack.pop();
    this.measurements = prev.measurements || [];
    this.textNotes = prev.textNotes || [];
    this.wallSegments = prev.wallSegments || [];
    this.selectedItem = null;
    this.render();
    this._emitHistory();
    this._emitMutated();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this._snapshotState());
    const next = this.redoStack.pop();
    this.measurements = next.measurements || [];
    this.textNotes = next.textNotes || [];
    this.wallSegments = next.wallSegments || [];
    this.selectedItem = null;
    this.render();
    this._emitHistory();
    this._emitMutated();
    return true;
  }

  _getBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasData = false;

    for (const seg of this.wallSegments) {
      for (const p of seg) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
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

  getSVGElement() {
    return this.svgElement;
  }

  getExportData() {
    return {
      walls: this.wallSegments,
      measurements: this.measurements,
      textNotes: this.textNotes,
      bounds: this._getBounds(),
    };
  }
}
