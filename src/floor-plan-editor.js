/**
 * FloorPlanEditor — SVG-based 2D CAD floor plan editor
 * Renders grid, translucent room overlays, non-destructive scan vs. drafted walls,
 * draggable wall endpoint handles, doors/windows, dimensions, and text notes.
 * Supports Select (+ Marquee & Handles), Pan (+ Space+Drag), Continuous Polyline Draw,
 * Door, Window, Measure, Calibrate, Text, Erase (+ Marquee), and per-floor Undo/Redo.
 */
import * as d3 from 'd3';
import {
  distancePointToPoint,
  formatDistance,
  formatArea,
  pointInPolygon,
  computeDominantWallAngle,
  rotatePoint,
  scalePoint,
  flipPoint,
  findNearestSnapPoint,
  projectPointToNearestWall,
  pointInBox,
  segmentIntersectsBox,
} from './utils/geometry.js';

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
    this.floorHistories = [];
    this.activeFloorIndex = 0;

    // Non-destructive split wall layers
    this.scanWalls = [];
    this.draftedWalls = [];
    this.measurements = [];
    this.textNotes = [];
    this.symbols = [];
    this.rooms = [];

    this.layers = {
      scan: true,
      drafted: true,
      rooms: typeof settings.showRooms === 'boolean' ? settings.showRooms : true,
      symbols: true,
      measurements: true,
      notes: true,
      grid: typeof settings.showGrid === 'boolean' ? settings.showGrid : true,
    };

    this.currentTool = 'select';
    this.selectedItem = null;
    this.selectedItems = [];

    this.settings = {
      units: settings.units || 'imperial',
      snapAngle: typeof settings.snapAngle === 'number' ? settings.snapAngle : 45,
      showGrid: typeof settings.showGrid === 'boolean' ? settings.showGrid : true,
      showRooms: typeof settings.showRooms === 'boolean' ? settings.showRooms : true,
      snapToGeometry: typeof settings.snapToGeometry === 'boolean' ? settings.snapToGeometry : true,
    };

    // Undo/redo for active floor
    this.undoStack = [];
    this.redoStack = [];

    // Space-pan & polyline state
    this._spacePressed = false;
    this._spacePanned = false;
    this._chainOriginPt = null;

    // Callbacks
    this.onZoomChanged = null;
    this.onHistoryChanged = null;
    this.onPlanMutated = null;
    this.onSelectionChanged = null;
    this.onCalibrationMeasured = null;

    this._setupLayers();
    this._setupZoom();
    this._setupInteraction();
  }

  /**
   * Combined visible walls across scan and drafted layers.
   */
  get wallSegments() {
    return this.getVisibleWalls();
  }

  getVisibleWalls() {
    const out = [];
    if (this.layers.scan) {
      for (const s of this.scanWalls) out.push(s);
    }
    if (this.layers.drafted) {
      for (const s of this.draftedWalls) out.push(s);
    }
    return out;
  }

  /**
   * Apply updated settings and re-render editor cleanly.
   * @param {Object} settings
   */
  setSettings(settings) {
    if (!settings) return;
    const nextUnits = settings.units === 'metric' ? 'metric' : 'imperial';
    const unitsChanged = nextUnits !== this.settings.units;

    const nextShowGrid = typeof settings.showGrid === 'boolean' ? settings.showGrid : this.settings.showGrid;
    const nextShowRooms = typeof settings.showRooms === 'boolean' ? settings.showRooms : this.settings.showRooms;
    if (nextShowGrid !== this.settings.showGrid) this.layers.grid = nextShowGrid;
    if (nextShowRooms !== this.settings.showRooms) this.layers.rooms = nextShowRooms;

    this.settings = {
      units: nextUnits,
      snapAngle: typeof settings.snapAngle === 'number' ? settings.snapAngle : this.settings.snapAngle,
      showGrid: nextShowGrid,
      showRooms: nextShowRooms,
      snapToGeometry: typeof settings.snapToGeometry === 'boolean' ? settings.snapToGeometry : this.settings.snapToGeometry,
    };

    if (unitsChanged) {
      for (const m of this.measurements) {
        const dist = distancePointToPoint(m.p1, m.p2);
        m.text = formatDistance(dist, this.settings.units);
      }
    }

    this.render();
    this._emitSelection();
  }

  /**
   * Toggle visibility of a specific editor layer.
   * @param {'scan'|'drafted'|'rooms'|'symbols'|'measurements'|'notes'|'grid'} layerKey
   * @param {boolean} visible
   */
  setLayerVisibility(layerKey, visible) {
    if (!(layerKey in this.layers)) return;
    this.layers[layerKey] = Boolean(visible);

    if (!this.layers[layerKey]) {
      this.selectedItems = this.selectedItems.filter((item) => {
        if (item.type === 'wall') return item.layer !== layerKey;
        if (layerKey === 'symbols') return item.type !== 'symbol';
        if (layerKey === 'measurements') return item.type !== 'measurement';
        if (layerKey === 'notes') return item.type !== 'text';
        return true;
      });
      this.selectedItem = this.selectedItems[0] || null;
    }

    this.render();
    this._emitSelection();
    if (layerKey === 'scan' || layerKey === 'drafted') {
      this._emitMutated();
    }
  }

  /**
   * Update detected rooms for canvas overlay rendering.
   * @param {Array<Object>} rooms
   */
  setRooms(rooms = []) {
    this.rooms = Array.isArray(rooms) ? rooms : [];
    this._renderRooms();
  }

  _setupLayers() {
    this.mainGroup = this.svg.append('g').attr('class', 'main-group');
    this.gridLayer = this.mainGroup.append('g').attr('class', 'grid-layer');
    this.roomLayer = this.mainGroup.append('g').attr('class', 'room-layer');
    this.wallLayer = this.mainGroup.append('g').attr('class', 'wall-layer');
    this.symbolLayer = this.mainGroup.append('g').attr('class', 'symbol-layer');
    this.dimensionLayer = this.mainGroup.append('g').attr('class', 'dimension-layer');
    this.labelLayer = this.mainGroup.append('g').attr('class', 'label-layer');
    this.handleLayer = this.mainGroup.append('g').attr('class', 'handle-layer');
    this.interactionLayer = this.mainGroup.append('g').attr('class', 'interaction-layer');
  }

  _setupZoom() {
    this.zoom = d3.zoom()
      .scaleExtent([0.01, 1000])
      .filter((event) => {
        if (event.type === 'wheel') return true;
        const isInteractive = event.target && (
          event.target.classList.contains('text-note') ||
          event.target.classList.contains('dimension-text') ||
          event.target.classList.contains('dimension-line') ||
          event.target.classList.contains('wall-handle') ||
          event.target.closest?.('.symbol-group')
        );
        if (isInteractive && !this._spacePressed) {
          return false;
        }
        return this.currentTool === 'pan' || this._spacePressed || event.button === 1;
      })
      .on('zoom', (event) => {
        if (this._spacePressed && event.sourceEvent && event.sourceEvent.type !== 'wheel') {
          this._spacePanned = true;
        }
        this.mainGroup.attr('transform', event.transform);
        this._currentTransform = event.transform;
        if (this.onZoomChanged) {
          this.onZoomChanged(Math.round(event.transform.k * 100));
        }
      });

    this.svg.call(this.zoom);
    this._currentTransform = d3.zoomIdentity;
  }

  _worldSnapRadius() {
    const k = this._currentTransform?.k || 40;
    return Math.max(0.08, Math.min(0.6, 14 / k));
  }

  _resolveSnapAgainst(rawPt, anchorPt = null, altKey = false, snapSegments = this.getVisibleWalls()) {
    if (altKey) {
      return { point: anchorPt ? this._snapPoint(anchorPt, rawPt) : rawPt, kind: null };
    }

    if (this.settings.snapToGeometry) {
      const snap = findNearestSnapPoint(rawPt, snapSegments, {
        snapRadius: this._worldSnapRadius(),
        snapToEndpoints: true,
        snapToMidpoints: true,
        snapToGrid: this.layers.grid,
        gridSize: 0.5,
      });

      if (snap && (snap.kind === 'endpoint' || snap.kind === 'midpoint')) {
        return { point: snap.point, kind: snap.kind };
      }

      if (anchorPt) {
        const anglePt = this._snapPoint(anchorPt, rawPt);
        if (snap && snap.kind === 'grid' && (!this.settings.snapAngle || this.settings.snapAngle <= 0)) {
          return { point: snap.point, kind: 'grid' };
        }
        return { point: anglePt, kind: null };
      }

      if (snap) {
        return { point: snap.point, kind: snap.kind };
      }
    }

    return { point: anchorPt ? this._snapPoint(anchorPt, rawPt) : rawPt, kind: null };
  }

  _resolveSnap(rawPt, anchorPt = null, altKey = false) {
    return this._resolveSnapAgainst(rawPt, anchorPt, altKey, this.getVisibleWalls());
  }

  _drawSnapIndicator(pt, kind) {
    if (!pt || !kind) return;
    const r = Math.max(0.06, Math.min(0.22, 6 / (this._currentTransform?.k || 40)));
    const color = kind === 'endpoint' ? '#10b981' : kind === 'midpoint' ? '#f59e0b' : '#38bdf8';
    this.interactionLayer.append('circle')
      .attr('class', 'snap-indicator')
      .attr('cx', pt[0])
      .attr('cy', pt[1])
      .attr('r', r)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('vector-effect', 'non-scaling-stroke');
  }

  _isItemSelected(type, idOrIdx, layer = null) {
    return this.selectedItems.some((item) => {
      if (item.type !== type) return false;
      if (type === 'wall') {
        return item.index === idOrIdx && item.layer === layer;
      }
      return item.data?.id === idOrIdx;
    });
  }

  _emitSelection() {
    if (this.onSelectionChanged) {
      this.onSelectionChanged(this.getSelectionSummary());
    }
  }

  _setSingleSelection(item) {
    this.selectedItem = item;
    this.selectedItems = item ? [item] : [];
    this._emitSelection();
  }

  /**
   * Returns structured metadata for the currently selected item(s) for the Properties Bar.
   */
  getSelectionSummary() {
    if (this.selectedItems.length === 0) return null;
    if (this.selectedItems.length > 1) {
      return { kind: 'multi', count: this.selectedItems.length };
    }
    const item = this.selectedItems[0];
    if (item.type === 'wall') {
      const list = item.layer === 'scan' ? this.scanWalls : this.draftedWalls;
      const seg = list[item.index];
      if (!seg) return null;
      return {
        kind: 'wall',
        layer: item.layer,
        index: item.index,
        length: distancePointToPoint(seg[0], seg[1]),
      };
    }
    if (item.type === 'symbol' && item.data) {
      const defaultW = item.data.kind === 'door' ? 0.9 : item.data.kind === 'stairs' ? 1.0 : 1.2;
      return {
        kind: 'symbol',
        id: item.data.id,
        symbolKind: item.data.kind,
        width: item.data.width || defaultW,
        length: item.data.kind === 'stairs' ? (item.data.length || 2.8) : undefined,
        swing: item.data.swing === -1 ? -1 : 1,
      };
    }
    if (item.type === 'measurement' && item.data) {
      return { kind: 'measurement', id: item.data.id, text: item.data.text };
    }
    if (item.type === 'text' && item.data) {
      return { kind: 'text', id: item.data.id, text: item.data.text };
    }
    return null;
  }

  /**
   * Resizes the currently selected wall from its start point to exact length in meters.
   * @param {number} newLengthMeters
   */
  setSelectedWallLength(newLengthMeters) {
    if (this.selectedItems.length !== 1 || this.selectedItem?.type !== 'wall') return false;
    if (!(newLengthMeters > 0.05)) return false;

    const { layer, index } = this.selectedItem;
    const list = layer === 'scan' ? this.scanWalls : this.draftedWalls;
    const seg = list[index];
    if (!seg) return false;

    const dx = seg[1][0] - seg[0][0];
    const dy = seg[1][1] - seg[0][1];
    const curLen = Math.hypot(dx, dy);
    if (curLen < 1e-6) return false;

    this._pushUndo();
    const ux = dx / curLen;
    const uy = dy / curLen;
    seg[1] = [seg[0][0] + ux * newLengthMeters, seg[0][1] + uy * newLengthMeters];
    this.render();
    this._emitMutated();
    this._emitSelection();
    return true;
  }

  /**
   * Promotes a selected 3D-scan wall into the Drafted layer so it is preserved across re-slicing.
   */
  promoteSelectedScanWall() {
    if (this.selectedItems.length !== 1 || this.selectedItem?.type !== 'wall') return false;
    if (this.selectedItem.layer !== 'scan') return false;

    const idx = this.selectedItem.index;
    const seg = this.scanWalls[idx];
    if (!seg) return false;

    this._pushUndo();
    this.scanWalls.splice(idx, 1);
    const newIndex = this.draftedWalls.length;
    this.draftedWalls.push([[seg[0][0], seg[0][1]], [seg[1][0], seg[1][1]]]);
    this.layers.drafted = true;
    this._setSingleSelection({ type: 'wall', layer: 'drafted', index: newIndex });
    this.render();
    this._emitMutated();
    return true;
  }

  /**
   * Updates width/length of the currently selected symbol.
   * @param {{ width?: number, length?: number }} updates
   */
  updateSelectedSymbol(updates = {}) {
    if (this.selectedItems.length !== 1 || this.selectedItem?.type !== 'symbol' || !this.selectedItem.data) {
      return false;
    }
    const sym = this.selectedItem.data;
    const hasW = updates.width !== undefined;
    const hasL = updates.length !== undefined && sym.kind === 'stairs';
    if (!hasW && !hasL) return false;

    const width = hasW ? Number(updates.width) : sym.width;
    const length = hasL ? Number(updates.length) : sym.length;
    if (hasW && !(width >= 0.3 && width <= 5.0)) return false;
    if (hasL && !(length >= 0.6 && length <= 12.0)) return false;

    this._pushUndo();
    if (hasW) sym.width = width;
    if (hasL) sym.length = length;
    this.render();
    this._emitMutated();
    this._emitSelection();
    return true;
  }

  _startMarquee(mode, startWorld, startClient) {
    const startPt = startWorld;
    let lastClient = startClient;
    let currentWorld = startWorld;
    let hasMoved = false;

    const drawBox = () => {
      const minX = Math.min(startPt[0], currentWorld[0]);
      const maxX = Math.max(startPt[0], currentWorld[0]);
      const minY = Math.min(startPt[1], currentWorld[1]);
      const maxY = Math.max(startPt[1], currentWorld[1]);

      this.interactionLayer.selectAll('*').remove();
      this.interactionLayer.append('rect')
        .attr('class', `marquee-box marquee-${mode}`)
        .attr('x', minX)
        .attr('y', minY)
        .attr('width', Math.max(0, maxX - minX))
        .attr('height', Math.max(0, maxY - minY));
    };

    const onMove = (moveEv) => {
      lastClient = [moveEv.clientX, moveEv.clientY];
      if (Math.hypot(lastClient[0] - startClient[0], lastClient[1] - startClient[1]) > 4) {
        hasMoved = true;
      }
      currentWorld = d3.pointer(moveEv, this.mainGroup.node());
      if (hasMoved) drawBox();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.interactionLayer.selectAll('*').remove();

      if (!hasMoved) {
        if (mode === 'select') {
          this._setSingleSelection(null);
          this.render();
        }
        return;
      }

      const box = {
        minX: Math.min(startPt[0], currentWorld[0]),
        minY: Math.min(startPt[1], currentWorld[1]),
        maxX: Math.max(startPt[0], currentWorld[0]),
        maxY: Math.max(startPt[1], currentWorld[1]),
      };

      const matchedScanIndices = [];
      if (this.layers.scan) {
        for (let i = 0; i < this.scanWalls.length; i++) {
          if (segmentIntersectsBox(this.scanWalls[i], box)) matchedScanIndices.push(i);
        }
      }
      const matchedDraftedIndices = [];
      if (this.layers.drafted) {
        for (let i = 0; i < this.draftedWalls.length; i++) {
          if (segmentIntersectsBox(this.draftedWalls[i], box)) matchedDraftedIndices.push(i);
        }
      }
      const matchedMeasIds = new Set(
        this.layers.measurements
          ? this.measurements.filter((m) => segmentIntersectsBox([m.p1, m.p2], box)).map((m) => m.id)
          : []
      );
      const matchedTextIds = new Set(
        this.layers.notes
          ? this.textNotes.filter((n) => pointInBox(n.pos, box)).map((n) => n.id)
          : []
      );
      const matchedSymbolIds = new Set(
        this.layers.symbols
          ? this.symbols.filter((s) => pointInBox(s.pos, box)).map((s) => s.id)
          : []
      );

      if (mode === 'select') {
        const list = [];
        for (const idx of matchedScanIndices) list.push({ type: 'wall', layer: 'scan', index: idx });
        for (const idx of matchedDraftedIndices) list.push({ type: 'wall', layer: 'drafted', index: idx });
        for (const m of this.measurements) if (matchedMeasIds.has(m.id)) list.push({ type: 'measurement', data: m });
        for (const n of this.textNotes) if (matchedTextIds.has(n.id)) list.push({ type: 'text', data: n });
        for (const s of this.symbols) if (matchedSymbolIds.has(s.id)) list.push({ type: 'symbol', data: s });
        this.selectedItems = list;
        this.selectedItem = list[0] || null;
        this.render();
        this._emitSelection();
      } else if (mode === 'erase') {
        const total =
          matchedScanIndices.length +
          matchedDraftedIndices.length +
          matchedMeasIds.size +
          matchedTextIds.size +
          matchedSymbolIds.size;
        if (total > 0) {
          this._pushUndo();
          const scanSet = new Set(matchedScanIndices);
          const draftedSet = new Set(matchedDraftedIndices);
          this.scanWalls = this.scanWalls.filter((_, idx) => !scanSet.has(idx));
          this.draftedWalls = this.draftedWalls.filter((_, idx) => !draftedSet.has(idx));
          this.measurements = this.measurements.filter((m) => !matchedMeasIds.has(m.id));
          this.textNotes = this.textNotes.filter((n) => !matchedTextIds.has(n.id));
          this.symbols = this.symbols.filter((s) => !matchedSymbolIds.has(s.id));
          this._setSingleSelection(null);
          this.render();
          this._emitMutated();
        }
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  _setupInteraction() {
    this._startPt = null;
    this._isMeasuring = false;

    this.svg.on('pointerdown', (event) => {
      if (event.button !== 0 || this._spacePressed) return;

      const targetEl = event.target.closest?.('[data-type]') || event.target;
      const target = d3.select(targetEl);
      const itemType = target.attr('data-type');
      const itemId = target.attr('data-id');
      const itemIdxAttr = target.attr('data-index');
      const itemLayerAttr = target.attr('data-layer') || 'drafted';

      // Select Tool
      if (this.currentTool === 'select') {
        if (itemType === 'measurement' && itemId) {
          event.stopPropagation();
          const meas = this.measurements.find((m) => m.id === itemId);
          this._setSingleSelection(meas ? { type: 'measurement', data: meas } : null);
          this.render();
        } else if (itemType === 'text' && itemId) {
          event.stopPropagation();
          const note = this.textNotes.find((n) => n.id === itemId);
          this._setSingleSelection(note ? { type: 'text', data: note } : null);
          this.render();
        } else if (itemType === 'symbol' && itemId) {
          event.stopPropagation();
          const sym = this.symbols.find((s) => s.id === itemId);
          this._setSingleSelection(sym ? { type: 'symbol', data: sym } : null);
          this.render();
        } else if (itemType === 'wall' && itemIdxAttr !== null) {
          event.stopPropagation();
          const idx = parseInt(itemIdxAttr, 10);
          const list = itemLayerAttr === 'scan' ? this.scanWalls : this.draftedWalls;
          if (!Number.isNaN(idx) && list[idx]) {
            this._setSingleSelection({ type: 'wall', layer: itemLayerAttr, index: idx });
            this.render();
          }
        } else {
          const worldPt = d3.pointer(event, this.mainGroup.node());
          this._startMarquee('select', worldPt, [event.clientX, event.clientY]);
        }
        return;
      }

      // Erase Tool
      if (this.currentTool === 'erase') {
        if (itemType === 'measurement' && itemId) {
          event.stopPropagation();
          this._pushUndo();
          this.measurements = this.measurements.filter((m) => m.id !== itemId);
          this._setSingleSelection(null);
          this.render();
          this._emitMutated();
        } else if (itemType === 'text' && itemId) {
          event.stopPropagation();
          this._pushUndo();
          this.textNotes = this.textNotes.filter((n) => n.id !== itemId);
          this._setSingleSelection(null);
          this.render();
          this._emitMutated();
        } else if (itemType === 'symbol' && itemId) {
          event.stopPropagation();
          this._pushUndo();
          this.symbols = this.symbols.filter((s) => s.id !== itemId);
          this._setSingleSelection(null);
          this.render();
          this._emitMutated();
        } else if (itemType === 'wall' && itemIdxAttr !== null) {
          event.stopPropagation();
          const idx = parseInt(itemIdxAttr, 10);
          const list = itemLayerAttr === 'scan' ? this.scanWalls : this.draftedWalls;
          if (!Number.isNaN(idx) && idx >= 0 && idx < list.length) {
            this._pushUndo();
            list.splice(idx, 1);
            this._setSingleSelection(null);
            this.render();
            this._emitMutated();
          }
        } else {
          const worldPt = d3.pointer(event, this.mainGroup.node());
          this._startMarquee('erase', worldPt, [event.clientX, event.clientY]);
        }
        return;
      }

      // Text Tool
      if (this.currentTool === 'text') {
        const [wx, wy] = d3.pointer(event, this.mainGroup.node());
        this.layers.notes = true;
        this._showTextInput(event.clientX, event.clientY, [wx, wy]);
        return;
      }

      // Door / Window / Archway / Stairs Symbol Placement Tools
      if (
        this.currentTool === 'door' ||
        this.currentTool === 'window' ||
        this.currentTool === 'archway' ||
        this.currentTool === 'stairs'
      ) {
        const rawPt = d3.pointer(event, this.mainGroup.node());
        const hit = projectPointToNearestWall(rawPt, this.getVisibleWalls(), 0.55);
        const isStairs = this.currentTool === 'stairs';
        const pos = (!isStairs && hit) ? hit.point : rawPt;
        const angle = hit ? hit.angle : 0;

        this._pushUndo();
        this.layers.symbols = true;
        const defaultW = this.currentTool === 'door' ? 0.9 : isStairs ? 1.0 : 1.2;
        const sym = {
          id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: this.currentTool,
          pos,
          angle,
          width: defaultW,
          swing: 1,
        };
        if (isStairs) {
          sym.length = 2.8;
        }
        this.symbols.push(sym);
        this._setSingleSelection({ type: 'symbol', data: sym });
        this.render();
        this._emitMutated();
        return;
      }

      // Measure, Continuous Polyline Draw, or Calibrate Tools
      if (this.currentTool === 'measure' || this.currentTool === 'draw' || this.currentTool === 'calibrate') {
        const rawPt = d3.pointer(event, this.mainGroup.node());

        if (!this._isMeasuring) {
          const snapped = this._resolveSnap(rawPt, null, event.altKey);
          this._isMeasuring = true;
          this._startPt = snapped.point;
          if (this.currentTool === 'draw') {
            this._chainOriginPt = snapped.point;
          }
        } else {
          const snapped = this._resolveSnap(rawPt, this._startPt, event.altKey);
          const endPt = snapped.point;
          const dist = distancePointToPoint(this._startPt, endPt);

          if (dist < 0.05) {
            // Double-click at same spot ends continuous wall chain cleanly
            this._cancelInteraction();
            return;
          }

          if (this.currentTool === 'calibrate') {
            this._cancelInteraction();
            this.onCalibrationMeasured?.(dist);
            return;
          }

          this._pushUndo();
          if (this.currentTool === 'measure') {
            this.layers.measurements = true;
            this.measurements.push({
              id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              p1: this._startPt,
              p2: endPt,
              text: formatDistance(dist, this.settings.units),
            });
            this._cancelInteraction();
          } else if (this.currentTool === 'draw') {
            this.layers.drafted = true;
            this.draftedWalls.push([this._startPt, endPt]);
            // Close loop or continue polyline chain
            if (this._chainOriginPt && distancePointToPoint(endPt, this._chainOriginPt) < 0.05) {
              this._cancelInteraction();
            } else {
              this._startPt = endPt;
              this._isMeasuring = true;
              this.interactionLayer.selectAll('*').remove();
            }
          }
          this.render();
          this._emitMutated();
        }
      }
    });

    // Hover snap / ghost symbol / rubberband preview
    this.svg.on('pointermove', (event) => {
      if (this._spacePressed) return;
      const rawPt = d3.pointer(event, this.mainGroup.node());

      if (
        this.currentTool === 'door' ||
        this.currentTool === 'window' ||
        this.currentTool === 'archway' ||
        this.currentTool === 'stairs'
      ) {
        this.interactionLayer.selectAll('*').remove();
        const hit = projectPointToNearestWall(rawPt, this.getVisibleWalls(), 0.55);
        const isStairs = this.currentTool === 'stairs';
        const pos = (!isStairs && hit) ? hit.point : rawPt;
        const angle = hit ? hit.angle : 0;
        const defaultW = this.currentTool === 'door' ? 0.9 : isStairs ? 1.0 : 1.2;
        this._drawSymbolShape(
          this.interactionLayer,
          { kind: this.currentTool, pos, angle, width: defaultW, length: isStairs ? 2.8 : undefined, swing: 1 },
          true
        );
        return;
      }

      if (this.currentTool === 'measure' || this.currentTool === 'draw' || this.currentTool === 'calibrate') {
        this.interactionLayer.selectAll('*').remove();

        if (!this._isMeasuring || !this._startPt) {
          const hoverSnap = this._resolveSnap(rawPt, null, event.altKey);
          if (hoverSnap.kind) {
            this._drawSnapIndicator(hoverSnap.point, hoverSnap.kind);
          }
          return;
        }

        const snapped = this._resolveSnap(rawPt, this._startPt, event.altKey);
        const endPt = snapped.point;
        const dist = distancePointToPoint(this._startPt, endPt);
        const previewColor = this.currentTool === 'calibrate' ? '#f59e0b' : '#38bdf8';

        this.interactionLayer.append('line')
          .attr('class', this.currentTool === 'draw' ? 'wall-line' : 'dimension-line')
          .attr('x1', this._startPt[0]).attr('y1', this._startPt[1])
          .attr('x2', endPt[0]).attr('y2', endPt[1])
          .attr('stroke', previewColor)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '4 4')
          .attr('vector-effect', 'non-scaling-stroke');

        if (snapped.kind) {
          this._drawSnapIndicator(endPt, snapped.kind);
        }

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
          .attr('fill', previewColor)
          .text(formatDistance(dist, this.settings.units));
      }
    });

    // Right click finishes/cancels active drawing chain
    this.svg.on('contextmenu', (event) => {
      if (this._isMeasuring) {
        event.preventDefault();
        this._cancelInteraction();
      }
    });

    // Keyboard shortcuts (Delete / Backspace / Escape / Space pan & symbol flip)
    window.addEventListener('keydown', (e) => {
      if (isTypingElement(e.target)) return;

      if (e.code === 'Space') {
        if (!this._spacePressed) {
          this._spacePressed = true;
          this._spacePanned = false;
          this.svgElement.style.cursor = 'grab';
        }
        e.preventDefault();
      }

      if (e.key === 'Escape') {
        if (this._isMeasuring) {
          this._cancelInteraction();
        } else if (this.selectedItems.length > 0) {
          this._setSingleSelection(null);
          this.render();
        }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedItems.length > 0) {
        e.preventDefault();
        this.deleteSelectedItem();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        const wasPanned = this._spacePanned;
        this._spacePressed = false;
        this._spacePanned = false;
        this.setToolCursor(this.currentTool);

        if (!wasPanned && !isTypingElement(e.target) && this.selectedItem?.type === 'symbol') {
          this.flipSelectedSymbol();
        }
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
          this._setSingleSelection(null);
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
   * Flip the swing of a selected door symbol, or rotate a selected window/archway/stairs symbol 90 degrees.
   */
  flipSelectedSymbol() {
    if (this.selectedItem?.type !== 'symbol' || !this.selectedItem.data) return false;
    this._pushUndo();
    const sym = this.selectedItem.data;
    if (sym.kind === 'door') {
      sym.swing = sym.swing === -1 ? 1 : -1;
    } else {
      sym.angle = (sym.angle || 0) + Math.PI / 2;
    }
    this.render();
    this._emitMutated();
    this._emitSelection();
    return true;
  }

  /**
   * Reverse UP/DOWN direction of a selected stairs symbol.
   */
  flipSelectedStairsDirection() {
    if (this.selectedItem?.type !== 'symbol' || this.selectedItem.data?.kind !== 'stairs') return false;
    this._pushUndo();
    this.selectedItem.data.swing = this.selectedItem.data.swing === -1 ? 1 : -1;
    this.render();
    this._emitMutated();
    this._emitSelection();
    return true;
  }

  /**
   * Delete currently selected items (supports single or marquee multi-selection).
   */
  deleteSelectedItem() {
    if (this.selectedItems.length === 0) return false;

    this._pushUndo();
    const scanIndices = new Set();
    const draftedIndices = new Set();
    const measIds = new Set();
    const textIds = new Set();
    const symbolIds = new Set();

    for (const item of this.selectedItems) {
      if (item.type === 'wall' && typeof item.index === 'number') {
        if (item.layer === 'scan') scanIndices.add(item.index);
        else draftedIndices.add(item.index);
      } else if (item.type === 'measurement' && item.data?.id) measIds.add(item.data.id);
      else if (item.type === 'text' && item.data?.id) textIds.add(item.data.id);
      else if (item.type === 'symbol' && item.data?.id) symbolIds.add(item.data.id);
    }

    if (scanIndices.size > 0) {
      this.scanWalls = this.scanWalls.filter((_, idx) => !scanSetHas(scanIndices, idx));
    }
    if (draftedIndices.size > 0) {
      this.draftedWalls = this.draftedWalls.filter((_, idx) => !draftedIndices.has(idx));
    }
    if (measIds.size > 0) {
      this.measurements = this.measurements.filter((m) => !measIds.has(m.id));
    }
    if (textIds.size > 0) {
      this.textNotes = this.textNotes.filter((n) => !textIds.has(n.id));
    }
    if (symbolIds.size > 0) {
      this.symbols = this.symbols.filter((s) => !symbolIds.has(s.id));
    }

    this._setSingleSelection(null);
    this.render();
    this._emitMutated();
    return true;
  }

  /**
   * Replaces ONLY the 3D-scan wall layer while leaving user-drafted walls untouched (undoable).
   * @param {Array<[[number, number], [number, number]]>} newSegments
   * @param {{ pushUndo?: boolean }} [options]
   */
  replaceScanWalls(newSegments, options = {}) {
    const { pushUndo = true } = options;
    if (pushUndo) {
      this._pushUndo();
    }
    this.scanWalls = (newSegments || []).map((s) => [[s[0][0], s[0][1]], [s[1][0], s[1][1]]]);
    if (this.selectedItems.some((i) => i.type === 'wall' && i.layer === 'scan')) {
      this._setSingleSelection(null);
    }
    this.render();
    this._emitMutated();
  }

  replaceWalls(newSegments, options = {}) {
    this.replaceScanWalls(newSegments, options);
  }

  /**
   * Rotate the entire active floor plan around its bounds center.
   * @param {number} angleRad
   */
  rotatePlan(angleRad) {
    const bounds = this._getBounds();
    if (!bounds || !angleRad) return false;
    const center = [(bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5];

    this._pushUndo();
    this.scanWalls = this.scanWalls.map(([a, b]) => [
      rotatePoint(a, center, angleRad),
      rotatePoint(b, center, angleRad),
    ]);
    this.draftedWalls = this.draftedWalls.map(([a, b]) => [
      rotatePoint(a, center, angleRad),
      rotatePoint(b, center, angleRad),
    ]);
    this.measurements = this.measurements.map((m) => ({
      ...m,
      p1: rotatePoint(m.p1, center, angleRad),
      p2: rotatePoint(m.p2, center, angleRad),
    }));
    this.textNotes = this.textNotes.map((n) => ({
      ...n,
      pos: rotatePoint(n.pos, center, angleRad),
    }));
    this.symbols = this.symbols.map((s) => ({
      ...s,
      pos: rotatePoint(s.pos, center, angleRad),
      angle: (s.angle || 0) + angleRad,
    }));

    this._setSingleSelection(null);
    this.render();
    this.fitToView();
    this._emitMutated();
    return true;
  }

  /**
   * Auto-straighten walls to horizontal/vertical axes using dominant wall angle estimation.
   * @returns {number} Applied rotation angle in radians (0 if already aligned or empty)
   */
  autoStraighten() {
    const angle = computeDominantWallAngle(this.getVisibleWalls());
    if (Math.abs(angle) < 1e-4) return 0;
    this.rotatePlan(angle);
    return angle;
  }

  /**
   * Flip the active floor plan horizontally ('x') or vertically ('y').
   * @param {'x'|'y'} axis
   */
  flipPlan(axis) {
    const bounds = this._getBounds();
    if (!bounds) return false;
    const center = [(bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5];

    this._pushUndo();
    this.scanWalls = this.scanWalls.map(([a, b]) => [
      flipPoint(a, center, axis),
      flipPoint(b, center, axis),
    ]);
    this.draftedWalls = this.draftedWalls.map(([a, b]) => [
      flipPoint(a, center, axis),
      flipPoint(b, center, axis),
    ]);
    this.measurements = this.measurements.map((m) => ({
      ...m,
      p1: flipPoint(m.p1, center, axis),
      p2: flipPoint(m.p2, center, axis),
    }));
    this.textNotes = this.textNotes.map((n) => ({
      ...n,
      pos: flipPoint(n.pos, center, axis),
    }));
    this.symbols = this.symbols.map((s) => {
      const flippedAngle = axis === 'x' ? Math.PI - (s.angle || 0) : -(s.angle || 0);
      return {
        ...s,
        pos: flipPoint(s.pos, center, axis),
        angle: flippedAngle,
        swing: (s.swing || 1) * -1,
      };
    });

    this._setSingleSelection(null);
    this.render();
    this.fitToView();
    this._emitMutated();
    return true;
  }

  /**
   * Scale the active floor plan uniformly around its center (for scale calibration).
   * @param {number} factor
   */
  scalePlan(factor) {
    const bounds = this._getBounds();
    if (!bounds || !(factor > 0)) return false;
    const center = [(bounds.minX + bounds.maxX) * 0.5, (bounds.minY + bounds.maxY) * 0.5];

    this._pushUndo();
    this.scanWalls = this.scanWalls.map(([a, b]) => [
      scalePoint(a, center, factor),
      scalePoint(b, center, factor),
    ]);
    this.draftedWalls = this.draftedWalls.map(([a, b]) => [
      scalePoint(a, center, factor),
      scalePoint(b, center, factor),
    ]);
    this.measurements = this.measurements.map((m) => {
      const p1 = scalePoint(m.p1, center, factor);
      const p2 = scalePoint(m.p2, center, factor);
      return {
        ...m,
        p1,
        p2,
        text: formatDistance(distancePointToPoint(p1, p2), this.settings.units),
      };
    });
    this.textNotes = this.textNotes.map((n) => ({
      ...n,
      pos: scalePoint(n.pos, center, factor),
    }));
    this.symbols = this.symbols.map((s) => {
      const defaultW = s.kind === 'door' ? 0.9 : s.kind === 'stairs' ? 1.0 : 1.2;
      const scaled = {
        ...s,
        pos: scalePoint(s.pos, center, factor),
        width: (s.width || defaultW) * factor,
      };
      if (s.kind === 'stairs') {
        scaled.length = (s.length || 2.8) * factor;
      }
      return scaled;
    });

    this._setSingleSelection(null);
    this.render();
    this.fitToView();
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
   * Insert a sample closed rectangular room template into the drafted layer.
   * @param {number} [width=4]
   * @param {number} [height=3]
   */
  insertRoomTemplate(width = 4, height = 3) {
    this._pushUndo();
    const bounds = this._getBounds();
    const offsetX = bounds ? bounds.maxX + 1.5 : 0;
    const offsetY = bounds ? bounds.minY : 0;

    const x0 = offsetX;
    const y0 = offsetY;
    const x1 = offsetX + width;
    const y1 = offsetY + height;

    this.layers.drafted = true;
    this.draftedWalls.push(
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

    this._setSingleSelection(null);
    this.render();
    this.fitToView();
    this._emitMutated();
  }

  /**
   * Clear all floor plan geometry, symbols, and annotations on the active floor (undoable).
   */
  clearPlan() {
    this._pushUndo();
    this.scanWalls = [];
    this.draftedWalls = [];
    this.measurements = [];
    this.textNotes = [];
    this.symbols = [];
    this.rooms = [];
    this._setSingleSelection(null);
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
    this._chainOriginPt = null;
    this.interactionLayer.selectAll('*').remove();
  }

  _saveActiveFloorIntoArray() {
    const current = this.floors[this.activeFloorIndex];
    if (!current) return;
    current.scanWalls = this.scanWalls.map((s) => [[s[0][0], s[0][1]], [s[1][0], s[1][1]]]);
    current.draftedWalls = this.draftedWalls.map((s) => [[s[0][0], s[0][1]], [s[1][0], s[1][1]]]);
    const visible = this.getVisibleWalls();
    current.segments = visible;
    current.walls = visible;
    current.measurements = this.measurements.map((m) => ({ ...m, p1: [...m.p1], p2: [...m.p2] }));
    current.textNotes = this.textNotes.map((n) => ({ ...n, pos: [...n.pos] }));
    current.symbols = this.symbols.map((s) => ({ ...s, pos: [...s.pos] }));
    current.bounds = this._getBounds() || current.bounds;
    this.floorHistories[this.activeFloorIndex] = {
      undoStack: this.undoStack,
      redoStack: this.redoStack,
    };
  }

  /**
   * Load floor plan data across one or more floors.
   * @param {Array<Object>} floors
   * @param {{ resetHistory?: boolean, activeIndex?: number }} [options]
   */
  setFloorData(floors, options = {}) {
    const { resetHistory = true, activeIndex = 0 } = options;
    this.floors = floors || [];
    if (resetHistory) {
      this.floorHistories = this.floors.map(() => ({ undoStack: [], redoStack: [] }));
      this.undoStack = [];
      this.redoStack = [];
      this._emitHistory();
    } else {
      while (this.floorHistories.length < this.floors.length) {
        this.floorHistories.push({ undoStack: [], redoStack: [] });
      }
    }

    if (this.floors.length > 0) {
      const targetIdx = Math.max(0, Math.min(activeIndex, this.floors.length - 1));
      this.activeFloorIndex = -1;
      this.switchFloor(targetIdx);
    } else {
      this.activeFloorIndex = 0;
      this.scanWalls = [];
      this.draftedWalls = [];
      this.measurements = [];
      this.textNotes = [];
      this.symbols = [];
      this.rooms = [];
      this._setSingleSelection(null);
      this.render();
      this._emitMutated();
    }
  }

  /**
   * Switch to a floor, persisting current floor's geometry and per-floor undo/redo history.
   * @param {number} index
   */
  switchFloor(index) {
    if (index < 0 || index >= this.floors.length) return;
    if (this.activeFloorIndex >= 0 && this.activeFloorIndex < this.floors.length && this.activeFloorIndex !== index) {
      this._saveActiveFloorIntoArray();
    }

    this.activeFloorIndex = index;
    const floor = this.floors[index];
    const hasSplit = Array.isArray(floor.scanWalls) || Array.isArray(floor.draftedWalls);
    const cloneList = (arr) => (arr || []).map((s) => [[s[0][0], s[0][1]], [s[1][0], s[1][1]]]);

    if (hasSplit) {
      this.scanWalls = cloneList(floor.scanWalls);
      this.draftedWalls = cloneList(floor.draftedWalls);
    } else {
      this.scanWalls = cloneList(floor.segments || floor.walls);
      this.draftedWalls = [];
    }

    this.measurements = (floor.measurements || []).map((m) => ({
      ...m,
      p1: [m.p1[0], m.p1[1]],
      p2: [m.p2[0], m.p2[1]],
    }));
    this.textNotes = (floor.textNotes || []).map((n) => ({
      ...n,
      pos: [n.pos[0], n.pos[1]],
    }));
    this.symbols = (floor.symbols || []).map((s) => ({
      ...s,
      pos: [s.pos[0], s.pos[1]],
    }));
    this.rooms = floor.rooms || [];

    const hist = this.floorHistories[index] || { undoStack: [], redoStack: [] };
    this.floorHistories[index] = hist;
    this.undoStack = hist.undoStack;
    this.redoStack = hist.redoStack;

    this._setSingleSelection(null);
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
    this._renderRooms();
    this._renderWalls();
    this._renderSymbols();
    this._renderDimensions();
    this._renderTextNotes();
    this._renderSelectionHandles();
  }

  _renderGrid() {
    this.gridLayer.selectAll('*').remove();

    if (!this.layers.grid) return;

    const bounds = this._getBounds();
    if (!bounds) return;

    const gridSize = 1;
    const startX = Math.floor(bounds.minX / gridSize) * gridSize - gridSize;
    const startY = Math.floor(bounds.minY / gridSize) * gridSize - gridSize;
    const endX = Math.ceil(bounds.maxX / gridSize) * gridSize + gridSize;
    const endY = Math.ceil(bounds.maxY / gridSize) * gridSize + gridSize;

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

  _renderRooms() {
    this.roomLayer.selectAll('*').remove();
    if (!this.layers.rooms || !this.rooms || this.rooms.length === 0) return;

    const fills = [
      'rgba(56, 189, 248, 0.08)',
      'rgba(16, 185, 129, 0.08)',
      'rgba(139, 92, 246, 0.08)',
      'rgba(245, 158, 11, 0.08)',
    ];

    const bounds = this._getBounds() || { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    const minDim = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 5;
    const fontSize = Math.max(0.12, Math.min(0.32, minDim * 0.055));

    this.rooms.forEach((room, idx) => {
      if (!room.polygon || room.polygon.length < 3) return;
      const pts = room.polygon.map(([x, y]) => `${x},${y}`).join(' ');
      this.roomLayer.append('polygon')
        .attr('class', 'room-polygon')
        .attr('points', pts)
        .attr('fill', fills[idx % fills.length]);

      if (!room.centroid) return;
      const hasManualNote = this.textNotes.some(
        (n) => Array.isArray(n.pos) && n.text && n.text.trim() && pointInPolygon(n.pos, room.polygon)
      );

      if (!hasManualNote) {
        this.roomLayer.append('text')
          .attr('class', 'room-overlay-label')
          .attr('x', room.centroid[0])
          .attr('y', room.centroid[1] - fontSize * 0.35)
          .attr('font-size', fontSize)
          .text(room.displayName || room.name);
      }

      this.roomLayer.append('text')
        .attr('class', 'room-overlay-area')
        .attr('x', room.centroid[0])
        .attr('y', room.centroid[1] + (hasManualNote ? fontSize * 1.35 : fontSize * 0.9))
        .attr('font-size', fontSize * 0.82)
        .text(formatArea(room.area, this.settings.units));
    });
  }

  _renderWalls() {
    this.wallLayer.selectAll('*').remove();

    if (this.layers.scan) {
      this.wallLayer.selectAll('.wall-scan')
        .data(this.scanWalls)
        .enter()
        .append('line')
        .attr('class', (_, i) => `wall-line wall-scan${this._isItemSelected('wall', i, 'scan') ? ' selected' : ''}`)
        .attr('data-type', 'wall')
        .attr('data-layer', 'scan')
        .attr('data-index', (_, i) => i)
        .attr('x1', (d) => d[0][0])
        .attr('y1', (d) => d[0][1])
        .attr('x2', (d) => d[1][0])
        .attr('y2', (d) => d[1][1]);
    }

    if (this.layers.drafted) {
      this.wallLayer.selectAll('.wall-drafted')
        .data(this.draftedWalls)
        .enter()
        .append('line')
        .attr('class', (_, i) => `wall-line wall-drafted${this._isItemSelected('wall', i, 'drafted') ? ' selected' : ''}`)
        .attr('data-type', 'wall')
        .attr('data-layer', 'drafted')
        .attr('data-index', (_, i) => i)
        .attr('x1', (d) => d[0][0])
        .attr('y1', (d) => d[0][1])
        .attr('x2', (d) => d[1][0])
        .attr('y2', (d) => d[1][1]);
    }
  }

  _renderSelectionHandles() {
    this.handleLayer.selectAll('*').remove();
    if (this.currentTool !== 'select' || this.selectedItems.length !== 1 || this.selectedItem?.type !== 'wall') {
      return;
    }

    const { layer, index } = this.selectedItem;
    const list = layer === 'scan' ? this.scanWalls : this.draftedWalls;
    const seg = list[index];
    if (!seg) return;

    const self = this;
    const r = Math.max(0.06, Math.min(0.24, 6 / (this._currentTransform?.k || 40)));

    [0, 1].forEach((endIdx) => {
      const pt = seg[endIdx];
      const handle = this.handleLayer.append('circle')
        .attr('class', 'wall-handle')
        .attr('cx', pt[0])
        .attr('cy', pt[1])
        .attr('r', r);

      handle.on('pointerdown', (event) => {
        if (event.button !== 0 || self._spacePressed) return;
        event.stopPropagation();
        event.preventDefault();

        const preDragSnapshot = self._snapshotState();
        const otherPt = seg[1 - endIdx];
        const otherWalls = self.getVisibleWalls().filter((w) => w !== seg);
        let hasMoved = false;

        const bounds = self._getBounds() || { minX: 0, maxX: 10, minY: 0, maxY: 10 };
        const minDim = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 5;
        const fontSize = Math.max(0.12, Math.min(0.35, minDim * 0.06));

        const onMove = (moveEv) => {
          hasMoved = true;
          const rawPt = d3.pointer(moveEv, self.mainGroup.node());
          const snapped = self._resolveSnapAgainst(rawPt, otherPt, moveEv.altKey, otherWalls);
          seg[endIdx] = [snapped.point[0], snapped.point[1]];

          self._renderWalls();
          handle.attr('cx', seg[endIdx][0]).attr('cy', seg[endIdx][1]);

          self.interactionLayer.selectAll('*').remove();
          if (snapped.kind) {
            self._drawSnapIndicator(snapped.point, snapped.kind);
          }

          const dist = distancePointToPoint(seg[0], seg[1]);
          const midX = (seg[0][0] + seg[1][0]) * 0.5;
          const midY = (seg[0][1] + seg[1][1]) * 0.5;
          self.interactionLayer.append('text')
            .attr('class', 'dimension-text')
            .attr('x', midX)
            .attr('y', midY - 0.2)
            .attr('font-size', fontSize)
            .attr('fill', '#f59e0b')
            .text(formatDistance(dist, self.settings.units));
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          self.interactionLayer.selectAll('*').remove();
          if (hasMoved) {
            self.undoStack.push(preDragSnapshot);
            self.redoStack = [];
            if (self.undoStack.length > 50) self.undoStack.shift();
            self._emitHistory();
            self.render();
            self._emitMutated();
            self._emitSelection();
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  _drawSymbolShape(parentLayer, sym, isPreview = false, isSelected = false) {
    const angle = sym.angle || 0;
    const swing = sym.swing === -1 ? -1 : 1;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    const g = parentLayer.append('g')
      .attr('class', `symbol-group symbol-${sym.kind}${isSelected ? ' selected' : ''}${isPreview ? ' preview' : ''}`)
      .attr('data-type', isPreview ? null : 'symbol')
      .attr('data-id', isPreview ? null : sym.id);

    if (sym.kind === 'stairs') {
      const width = sym.width || 1.0;
      const length = sym.length || 2.8;
      const hw = width * 0.5;
      const hl = length * 0.5;
      const vx = -uy;
      const vy = ux;
      const pt = (u, v) => [sym.pos[0] + ux * u + vx * v, sym.pos[1] + uy * u + vy * v];
      const corners = [pt(-hl, -hw), pt(hl, -hw), pt(hl, hw), pt(-hl, hw)];

      g.append('polygon')
        .attr('class', 'symbol-stairs-box')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('points', corners.map(([x, y]) => `${x},${y}`).join(' '));

      const numTreads = Math.max(4, Math.min(18, Math.round(length / 0.28)));
      for (let t = 1; t < numTreads; t++) {
        const f = -hl + (t / numTreads) * length;
        const t1 = pt(f, -hw);
        const t2 = pt(f, hw);
        g.append('line')
          .attr('class', 'symbol-tread')
          .attr('data-type', isPreview ? null : 'symbol')
          .attr('data-id', isPreview ? null : sym.id)
          .attr('x1', t1[0]).attr('y1', t1[1])
          .attr('x2', t2[0]).attr('y2', t2[1]);
      }

      const a0 = pt(-swing * hl * 0.72, 0);
      const a1 = pt(swing * hl * 0.72, 0);
      const headLen = Math.min(0.24, width * 0.28);
      const h1 = pt(swing * hl * 0.72 - swing * headLen, headLen * 0.7);
      const h2 = pt(swing * hl * 0.72 - swing * headLen, -headLen * 0.7);

      g.append('line').attr('class', 'symbol-arrow')
        .attr('data-type', isPreview ? null : 'symbol').attr('data-id', isPreview ? null : sym.id)
        .attr('x1', a0[0]).attr('y1', a0[1]).attr('x2', a1[0]).attr('y2', a1[1]);
      g.append('line').attr('class', 'symbol-arrow')
        .attr('data-type', isPreview ? null : 'symbol').attr('data-id', isPreview ? null : sym.id)
        .attr('x1', a1[0]).attr('y1', a1[1]).attr('x2', h1[0]).attr('y2', h1[1]);
      g.append('line').attr('class', 'symbol-arrow')
        .attr('data-type', isPreview ? null : 'symbol').attr('data-id', isPreview ? null : sym.id)
        .attr('x1', a1[0]).attr('y1', a1[1]).attr('x2', h2[0]).attr('y2', h2[1]);

      const lbl = pt(-swing * hl * 0.22, 0);
      g.append('text')
        .attr('class', 'symbol-up-text')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x', lbl[0])
        .attr('y', lbl[1])
        .attr('font-size', Math.max(0.14, Math.min(0.28, width * 0.22)))
        .text('UP');

      return g;
    }

    const width = sym.width || (sym.kind === 'door' ? 0.9 : 1.2);
    const half = width * 0.5;
    const nx = -uy * swing;
    const ny = ux * swing;

    const x1 = sym.pos[0] - ux * half;
    const y1 = sym.pos[1] - uy * half;
    const x2 = sym.pos[0] + ux * half;
    const y2 = sym.pos[1] + uy * half;

    g.append('line')
      .attr('class', 'symbol-mask')
      .attr('data-type', isPreview ? null : 'symbol')
      .attr('data-id', isPreview ? null : sym.id)
      .attr('x1', x1).attr('y1', y1)
      .attr('x2', x2).attr('y2', y2);

    if (sym.kind === 'archway') {
      const jx = -uy * 0.09;
      const jy = ux * 0.09;
      g.append('line')
        .attr('class', 'symbol-jamb')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x1', x1 - jx).attr('y1', y1 - jy)
        .attr('x2', x1 + jx).attr('y2', y1 + jy);
      g.append('line')
        .attr('class', 'symbol-jamb')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x1', x2 - jx).attr('y1', y2 - jy)
        .attr('x2', x2 + jx).attr('y2', y2 + jy);
      g.append('line')
        .attr('class', 'symbol-opening-line')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2).attr('y2', y2);
    } else if (sym.kind === 'window') {
      const px = -uy * 0.06;
      const py = ux * 0.06;
      g.append('line')
        .attr('class', 'symbol-frame')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x1', x1 - px).attr('y1', y1 - py)
        .attr('x2', x2 - px).attr('y2', y2 - py);
      g.append('line')
        .attr('class', 'symbol-frame')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x1', x1 + px).attr('y1', y1 + py)
        .attr('x2', x2 + px).attr('y2', y2 + py);
      g.append('line')
        .attr('class', 'symbol-glass')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', x2).attr('y2', y2);
    } else {
      const tx = x1 + nx * width;
      const ty = y1 + ny * width;
      const sweepFlag = swing === 1 ? 0 : 1;

      g.append('line')
        .attr('class', 'symbol-leaf')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('x1', x1).attr('y1', y1)
        .attr('x2', tx).attr('y2', ty);

      g.append('path')
        .attr('class', 'symbol-arc')
        .attr('data-type', isPreview ? null : 'symbol')
        .attr('data-id', isPreview ? null : sym.id)
        .attr('d', `M ${tx} ${ty} A ${width} ${width} 0 0 ${sweepFlag} ${x2} ${y2}`);
    }

    return g;
  }

  _renderSymbols() {
    this.symbolLayer.selectAll('*').remove();
    if (!this.layers.symbols) return;
    const self = this;

    for (const sym of this.symbols) {
      const isSelected = this._isItemSelected('symbol', sym.id);
      const group = this._drawSymbolShape(this.symbolLayer, sym, false, isSelected);

      group.on('pointerdown', (event) => {
        if (self.currentTool !== 'select' || event.button !== 0 || self._spacePressed) return;
        event.stopPropagation();
        event.preventDefault();

        self._setSingleSelection({ type: 'symbol', data: sym });
        self.symbolLayer.selectAll('.symbol-group').classed('selected', false);
        group.classed('selected', true);

        const preDragSnapshot = self._snapshotState();
        let hasDragged = false;

        const onMove = (moveEv) => {
          hasDragged = true;
          const worldPt = d3.pointer(moveEv, self.mainGroup.node());
          if (sym.kind === 'stairs') {
            sym.pos = worldPt;
          } else {
            const hit = projectPointToNearestWall(worldPt, self.getVisibleWalls(), 0.55);
            if (hit) {
              sym.pos = hit.point;
              sym.angle = hit.angle;
            } else {
              sym.pos = worldPt;
            }
          }
          self._renderSymbols();
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (hasDragged) {
            self.undoStack.push(preDragSnapshot);
            self.redoStack = [];
            if (self.undoStack.length > 50) self.undoStack.shift();
            self._emitHistory();
            self._emitMutated();
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      group.on('dblclick', (event) => {
        if (self.currentTool !== 'select') return;
        event.stopPropagation();
        self._setSingleSelection({ type: 'symbol', data: sym });
        self.flipSelectedSymbol();
      });
    }
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

    if (!this.layers.measurements) return;
    for (const m of this.measurements) {
      const isSelected = this._isItemSelected('measurement', m.id);
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
    if (!this.layers.notes) return;

    const bounds = this._getBounds() || { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    const minDim = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 5;
    const fontSize = Math.max(0.14, Math.min(0.4, minDim * 0.07));

    const self = this;

    for (const note of this.textNotes) {
      const isSelected = this._isItemSelected('text', note.id);

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
        if (self.currentTool !== 'select' || event.button !== 0 || self._spacePressed) return;
        event.stopPropagation();
        event.preventDefault();

        self._setSingleSelection({ type: 'text', data: note });
        self.labelLayer.selectAll('.text-note').classed('selected', false).attr('fill', '#facc15');
        textElem.classed('selected', true).attr('fill', '#38bdf8');

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

  setToolCursor(tool) {
    const cursors = {
      select: 'default',
      pan: 'grab',
      text: 'text',
      draw: 'crosshair',
      door: 'crosshair',
      window: 'crosshair',
      archway: 'crosshair',
      stairs: 'crosshair',
      measure: 'crosshair',
      calibrate: 'crosshair',
      erase: 'pointer',
    };
    this.svgElement.style.cursor = cursors[tool] || 'default';
  }

  /**
   * Set the current tool
   * @param {string} tool - 'select' | 'pan' | 'text' | 'draw' | 'door' | 'window' | 'measure' | 'calibrate' | 'erase'
   */
  setTool(tool) {
    this.currentTool = tool;
    this._cancelInteraction();
    this.setToolCursor(tool);
    this._renderSelectionHandles();
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
      scanWalls: JSON.parse(JSON.stringify(this.scanWalls)),
      draftedWalls: JSON.parse(JSON.stringify(this.draftedWalls)),
      symbols: JSON.parse(JSON.stringify(this.symbols)),
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
      const visible = this.getVisibleWalls();
      this.floors[this.activeFloorIndex].scanWalls = this.scanWalls;
      this.floors[this.activeFloorIndex].draftedWalls = this.draftedWalls;
      this.floors[this.activeFloorIndex].segments = visible;
      this.floors[this.activeFloorIndex].walls = visible;
      this.floors[this.activeFloorIndex].measurements = this.measurements;
      this.floors[this.activeFloorIndex].textNotes = this.textNotes;
      this.floors[this.activeFloorIndex].symbols = this.symbols;
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
    this.scanWalls = prev.scanWalls || [];
    this.draftedWalls = prev.draftedWalls || [];
    this.symbols = prev.symbols || [];
    this._setSingleSelection(null);
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
    this.scanWalls = next.scanWalls || [];
    this.draftedWalls = next.draftedWalls || [];
    this.symbols = next.symbols || [];
    this._setSingleSelection(null);
    this.render();
    this._emitHistory();
    this._emitMutated();
    return true;
  }

  _getBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasData = false;

    for (const seg of this.getVisibleWalls()) {
      for (const p of seg) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
        hasData = true;
      }
    }

    if (this.layers.measurements) {
      for (const m of this.measurements) {
        minX = Math.min(minX, m.p1[0], m.p2[0]);
        minY = Math.min(minY, m.p1[1], m.p2[1]);
        maxX = Math.max(maxX, m.p1[0], m.p2[0]);
        maxY = Math.max(maxY, m.p1[1], m.p2[1]);
        hasData = true;
      }
    }

    if (this.layers.notes) {
      for (const n of this.textNotes) {
        minX = Math.min(minX, n.pos[0]);
        minY = Math.min(minY, n.pos[1]);
        maxX = Math.max(maxX, n.pos[0]);
        maxY = Math.max(maxY, n.pos[1]);
        hasData = true;
      }
    }

    if (this.layers.symbols) {
      for (const s of this.symbols) {
        minX = Math.min(minX, s.pos[0]);
        minY = Math.min(minY, s.pos[1]);
        maxX = Math.max(maxX, s.pos[0]);
        maxY = Math.max(maxY, s.pos[1]);
        hasData = true;
      }
    }

    return hasData ? { minX, minY, maxX, maxY } : null;
  }

  getSVGElement() {
    return this.svgElement;
  }

  getExportData() {
    return {
      walls: this.getVisibleWalls(),
      scanWalls: this.scanWalls,
      draftedWalls: this.draftedWalls,
      measurements: this.layers.measurements ? this.measurements : [],
      textNotes: this.layers.notes ? this.textNotes : [],
      symbols: this.layers.symbols ? this.symbols : [],
      bounds: this._getBounds(),
    };
  }
}

function scanSetHas(set, idx) {
  return set.has(idx);
}
