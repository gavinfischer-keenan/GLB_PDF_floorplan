/**
 * Main application — orchestrates the GLB → Floor Plan pipeline
 * Manages the 4-step wizard flow, persistent settings, recent items,
 * command palette, shortcuts overlay, and live blueprint export.
 */
import { GLBLoader } from './glb-loader.js';
import { Viewport3D } from './viewport-3d.js';
import { detectUpDirection } from './up-detector.js';
import { detectFloor } from './floor-detector.js';
import { extractCrossSection } from './cross-section.js';
import { detectRooms } from './room-detector.js';
import { FloorPlanEditor } from './floor-plan-editor.js';
import { exportPDF, savePDF } from './pdf-exporter.js';
import { buildPlanData, savePlanData } from './plan-data-exporter.js';
import { formatDistance, formatArea, pointInPolygon } from './utils/geometry.js';
import {
  loadSettings,
  loadRecentItems,
  addRecentItem,
  clearRecentItems,
} from './state/store.js';
import { renderEmptyState } from './ui/empty-states.js';
import { renderBlueprintPreview } from './ui/blueprint-preview.js';
import { initCommandPalette } from './ui/command-palette.js';
import { initShortcutsOverlay } from './ui/shortcuts-overlay.js';
import { initSettingsModal, showSettingsToast } from './ui/settings-modal.js';

// ============================================================
// Application State
// ============================================================
const state = {
  currentStep: 1,
  file: null,
  sourceMeta: null,     // { sourceType: 'sample'|'file'|'template', samplePath?: string }
  modelData: null,      // From GLBLoader
  upAxis: null,         // Detected up direction
  detectedFloor: null,  // Detected primary floor
  floorPlan: null,      // Processed floor plan data
  viewport: null,       // 3D viewport instance
  editor: null,         // Floor plan editor instance
  settings: loadSettings(),
  recentItems: loadRecentItems(),
  roomsPanelOpen: typeof window !== 'undefined' ? window.innerWidth > 900 : true,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const steps = {
  load: $('#step-load'),
  orient: $('#step-orient'),
  edit: $('#step-edit'),
  export: $('#step-export'),
};

let paletteCtrl = null;
let shortcutsCtrl = null;
let settingsCtrl = null;

// ============================================================
// Step Navigation
// ============================================================
function goToStep(stepNum) {
  if (stepNum < 1 || stepNum > 4) return;
  state.currentStep = stepNum;

  Object.values(steps).forEach((s) => s?.classList.remove('active'));
  const stepNames = ['load', 'orient', 'edit', 'export'];
  steps[stepNames[stepNum - 1]]?.classList.add('active');

  $$('.step-indicator').forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.remove('active', 'completed');
    if (s === stepNum) {
      el.classList.add('active');
      el.setAttribute('aria-current', 'step');
    } else {
      el.removeAttribute('aria-current');
      if (s < stepNum) el.classList.add('completed');
    }
  });

  if (stepNum === 1) renderRecentScans();
  if (stepNum === 2) initOrientStep();
  if (stepNum === 3) initEditStep();
  if (stepNum === 4) initExportStep();
}

// ============================================================
// Shared Sample Loader & Recent History
// ============================================================
async function loadSampleScan(samplePath) {
  const uploadZone = $('#upload-zone');
  const loadingOverlay = $('#loading-overlay');
  const progressFill = $('#progress-fill');

  goToStep(1);
  try {
    uploadZone.hidden = true;
    loadingOverlay.hidden = false;
    progressFill.style.width = '30%';

    const response = await fetch(samplePath);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const filename = samplePath.split('/').pop();
    const sampleFile = new File([blob], filename, { type: 'model/gltf-binary' });
    state.sourceMeta = { sourceType: 'sample', samplePath };
    await handleGLBFile(sampleFile, { sourceType: 'sample', samplePath });
  } catch (err) {
    console.error('Failed to load sample scan:', err);
    showError('Sample Load Error', `Could not load sample model: ${err.message}`);
    uploadZone.hidden = false;
    loadingOverlay.hidden = true;
    progressFill.style.width = '0%';
  }
}

async function handleGLBFile(file, sourceMeta = { sourceType: 'file' }) {
  const uploadZone = $('#upload-zone');
  const loadingOverlay = $('#loading-overlay');
  const progressFill = $('#progress-fill');

  if (!file.name.toLowerCase().endsWith('.glb')) {
    showError('Invalid File', 'Please select a .glb file.');
    return;
  }

  state.file = file;
  state.sourceMeta = sourceMeta;
  uploadZone.hidden = true;
  loadingOverlay.hidden = false;
  progressFill.style.width = '15%';

  try {
    const loader = new GLBLoader();
    loader.onProgress = (pct) => {
      progressFill.style.width = `${pct}%`;
    };

    state.modelData = await loader.load(file);

    if (state.modelData.totalTriangles === 0) {
      throw new Error('The GLB file contains no geometry data.');
    }

    // Record scan in recent history right away
    state.recentItems = addRecentItem({
      name: file.name.replace(/\.glb$/i, ''),
      sourceType: sourceMeta.sourceType,
      samplePath: sourceMeta.samplePath || null,
      totalTriangles: state.modelData.totalTriangles,
      wallCount: 0,
      roomCount: 0,
    });

    // Clear stale project name so new file populates it cleanly
    const nameInput = $('#project-name');
    if (nameInput) nameInput.value = file.name.replace(/\.glb$/i, '');

    goToStep(2);
  } catch (err) {
    console.error('Failed to load GLB:', err);
    showError('Failed to Load', `Could not parse the GLB file: ${err.message}`);
    uploadZone.hidden = false;
    loadingOverlay.hidden = true;
    progressFill.style.width = '0%';
  }
}

function recordCurrentPlanInRecent() {
  if (!state.floorPlan) return;
  const projectName = ($('#project-name')?.value || '').trim()
    || state.file?.name?.replace(/\.glb$/i, '')
    || 'Floor Plan';

  const walls = state.floorPlan.walls || state.floorPlan.segments || [];
  const rooms = state.floorPlan.rooms || [];

  // Keep snapshot compact if very large (> 3000 segments) so localStorage stays healthy
  const canSnapshot = walls.length <= 3000;
  const floorPlanSnapshot = canSnapshot
    ? {
        name: state.floorPlan.name || 'Floor 1',
        floorHeight: state.floorPlan.floorHeight ?? 0,
        ceilingHeight: state.detectedFloor?.ceilingHeight ?? 3.0,
        sliceHeight: state.floorPlan.sliceHeight ?? 1.0,
        segments: walls,
        measurements: state.floorPlan.measurements || [],
        textNotes: state.floorPlan.textNotes || [],
        bounds: state.floorPlan.bounds || null,
      }
    : null;

  state.recentItems = addRecentItem({
    name: projectName,
    sourceType: state.sourceMeta?.sourceType || 'template',
    samplePath: state.sourceMeta?.samplePath || null,
    totalTriangles: state.modelData?.totalTriangles || 0,
    wallCount: walls.length,
    roomCount: rooms.length,
    floorPlanSnapshot,
  });

  renderRecentScans();
}

function resumeRecentItem(item) {
  if (!item) return;

  if (item.floorPlanSnapshot) {
    const snap = item.floorPlanSnapshot;
    const rooms = detectRooms(snap.segments || [], state.settings.roomMergeTolerance);
    state.detectedFloor = {
      name: snap.name || 'Floor 1',
      floorHeight: snap.floorHeight ?? 0,
      ceilingHeight: snap.ceilingHeight ?? 3.0,
      sliceHeight: snap.sliceHeight ?? 1.0,
    };
    state.floorPlan = {
      name: snap.name || 'Floor 1',
      floorHeight: snap.floorHeight ?? 0,
      sliceHeight: snap.sliceHeight ?? 1.0,
      segments: snap.segments || [],
      walls: snap.segments || [],
      measurements: snap.measurements || [],
      textNotes: snap.textNotes || [],
      rooms,
      bounds: snap.bounds,
      warning: null,
    };
    state.sourceMeta = { sourceType: item.sourceType, samplePath: item.samplePath };
    const nameInput = $('#project-name');
    if (nameInput) nameInput.value = item.name;
    goToStep(3);
    showSettingsToast($('#app-toast'), 'Resumed floor plan', `${item.name} (${rooms.length} rooms, ${(snap.segments || []).length} walls)`);
    return;
  }

  if (item.samplePath) {
    loadSampleScan(item.samplePath);
    return;
  }

  showError('Scan File Required', `"${item.name}" was loaded from a local file without a saved plan snapshot. Please drop the .glb file again to inspect it.`);
}

// ============================================================
// Step 1: Load GLB & Recent Scans
// ============================================================
function renderRecentScans() {
  const container = $('#recent-scans-list');
  const clearBtn = $('#btn-clear-recent');
  if (!container) return;

  const items = state.recentItems || [];
  if (clearBtn) clearBtn.hidden = items.length === 0;

  if (items.length === 0) {
    renderEmptyState(container, {
      compact: true,
      title: 'No Recent Scans Yet',
      description: 'Opened 3D scans and edited floor plans appear here so you can jump back in with one click.',
      actionLabel: 'Load Sample House Scan',
      onAction: () => loadSampleScan('samples/sample_house.glb'),
    });
    return;
  }

  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'recent-items-table';

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'recent-item-row';

    const info = document.createElement('div');
    info.className = 'recent-item-info';

    const title = document.createElement('span');
    title.className = 'recent-item-name';
    title.textContent = item.name;
    info.appendChild(title);

    const metaParts = [];
    if (item.roomCount > 0 || item.wallCount > 0) {
      metaParts.push(`${item.roomCount} ${item.roomCount === 1 ? 'room' : 'rooms'}`);
      metaParts.push(`${item.wallCount} walls`);
    } else if (item.totalTriangles > 0) {
      metaParts.push(`${item.totalTriangles.toLocaleString()} tris`);
    }
    if (item.sourceType === 'sample') metaParts.push('Built-in sample');
    else if (item.sourceType === 'template') metaParts.push('Room template');
    if (item.timestamp) metaParts.push(new Date(item.timestamp).toLocaleDateString());

    const meta = document.createElement('span');
    meta.className = 'recent-item-meta';
    meta.textContent = metaParts.join(' · ');
    info.appendChild(meta);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = item.floorPlanSnapshot || item.samplePath ? 'Resume' : 'Reload';
    btn.addEventListener('click', () => resumeRecentItem(item));

    row.appendChild(info);
    row.appendChild(btn);
    list.appendChild(row);
  }

  container.appendChild(list);
}

function initLoadStep() {
  const uploadZone = $('#upload-zone');
  const fileInput = $('#file-input');
  const btnBrowse = $('#btn-browse');

  btnBrowse.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleGLBFile(e.dataTransfer.files[0], { sourceType: 'file' });
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleGLBFile(fileInput.files[0], { sourceType: 'file' });
      fileInput.value = '';
    }
  });

  $$('.btn-sample-model').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadSampleScan(btn.dataset.sample);
    });
  });

  $('#btn-clear-recent')?.addEventListener('click', () => {
    state.recentItems = clearRecentItems();
    renderRecentScans();
  });

  renderRecentScans();
}

// ============================================================
// Step 2: Confirm Orientation (Event handlers bound once!)
// ============================================================
function bindOrientStepEvents() {
  $$('.btn-axis').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.upAxis = btn.dataset.axis;
      $$('.btn-axis').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewport?.showUpArrow(state.upAxis);
    });
  });

  $('#btn-confirm-orient').addEventListener('click', () => {
    if (!state.modelData) {
      goToStep(1);
      return;
    }

    state.detectedFloor = detectFloor(state.modelData.meshes, state.upAxis, {
      sliceOffset: state.settings.defaultSliceOffset,
    });

    if (!state.detectedFloor) {
      const b = state.modelData.bounds;
      const axisChar = state.upAxis.slice(-1).toLowerCase();
      const sign = state.upAxis[0] === '-' ? -1 : 1;
      const floorH = sign > 0 ? b.min[axisChar] : b.max[axisChar];
      state.detectedFloor = {
        name: 'Floor 1',
        floorHeight: floorH,
        ceilingHeight: floorH + sign * 3.0,
        sliceHeight: floorH + sign * state.settings.defaultSliceOffset,
      };
    }

    processFloorPlan();
    recordCurrentPlanInRecent();
    goToStep(3);
  });

  $('#btn-back-to-load').addEventListener('click', () => {
    const uploadZone = $('#upload-zone');
    const loadingOverlay = $('#loading-overlay');
    uploadZone.hidden = false;
    loadingOverlay.hidden = true;
    $('#progress-fill').style.width = '0%';
    goToStep(1);
  });
}

function updateOrientStatsDisplay() {
  if (!state.modelData) return;
  const b = state.modelData.bounds;
  const u = state.settings.units;
  const sizeX = formatDistance(b.max.x - b.min.x, u);
  const sizeY = formatDistance(b.max.y - b.min.y, u);
  const sizeZ = formatDistance(b.max.z - b.min.z, u);
  $('#stat-bounds').textContent = `${sizeX} × ${sizeY} × ${sizeZ}`;
}

function initOrientStep() {
  const splitView = $('#orient-split-view');
  const emptyView = $('#orient-empty-view');

  if (!state.modelData) {
    splitView.hidden = true;
    emptyView.hidden = false;
    renderEmptyState(emptyView, {
      title: 'No 3D Scan Loaded Yet',
      description: 'Upload a .glb 3D scan or open a built-in sample to preview the 3D geometry and verify which axis points up.',
      actionLabel: 'Load Sample Room (245 KB)',
      onAction: () => loadSampleScan('samples/sample_room.glb'),
      secondaryLabel: 'Go to Load Step',
      onSecondary: () => goToStep(1),
    });
    return;
  }

  splitView.hidden = false;
  emptyView.hidden = true;

  const container = $('#viewport-3d');
  if (!state.viewport) {
    state.viewport = new Viewport3D(container);
  }

  state.viewport.setModel(state.modelData.scene.clone(), state.modelData.bounds);
  state.viewport.resize();

  const detection = detectUpDirection(state.modelData.meshes, state.modelData.bounds);
  state.upAxis = detection.axis;

  $('#detected-axis').textContent = detection.axis.toUpperCase();
  $('#detected-confidence').textContent = `${Math.round(detection.confidence * 100)}%`;
  $('#stat-triangles').textContent = state.modelData.totalTriangles.toLocaleString();
  $('#stat-meshes').textContent = state.modelData.meshCount.toString();
  updateOrientStatsDisplay();

  state.viewport.showUpArrow(state.upAxis);

  $$('.btn-axis').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.axis === state.upAxis);
  });
}

function processFloorPlan() {
  const floor = state.detectedFloor;
  const crossSection = extractCrossSection(
    state.modelData.meshes,
    floor.sliceHeight,
    state.upAxis
  );

  const rooms = detectRooms(crossSection.segments, state.settings.roomMergeTolerance);

  const bounds = crossSection.bounds;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;

  let warning = null;
  if (crossSection.segments.length === 0) {
    warning = 'No wall segments detected at this height. Try adjusting the Slice Height slider in the editor or checking orientation.';
  } else if (spanX > 200 || spanY > 200) {
    warning = 'Model spans over 200m. This appears to be a large outdoor area rather than a building.';
  }

  state.floorPlan = {
    name: floor.name,
    floorHeight: floor.floorHeight,
    sliceHeight: floor.sliceHeight,
    segments: crossSection.segments,
    rooms,
    bounds: crossSection.bounds,
    warning,
    walls: crossSection.segments,
    measurements: [],
    textNotes: [],
  };
}

// ============================================================
// Step 3: Edit Floor Plan (Event handlers bound once!)
// ============================================================
function ensureEditor() {
  if (state.editor) return state.editor;
  const svgElement = $('#floor-plan-svg');
  state.editor = new FloorPlanEditor(svgElement, state.settings);

  state.editor.onZoomChanged = (pct) => {
    $('#zoom-level').textContent = `${pct}%`;
  };

  state.editor.onHistoryChanged = ({ canUndo, canRedo }) => {
    $('#btn-undo').disabled = !canUndo;
    $('#btn-redo').disabled = !canRedo;
  };

  state.editor.onPlanMutated = (exportData) => {
    syncFloorPlanFromEditor(exportData);
  };

  return state.editor;
}

function syncFloorPlanFromEditor(exportData) {
  const walls = exportData?.walls || [];
  const measurements = exportData?.measurements || [];
  const textNotes = exportData?.textNotes || [];
  const rooms = detectRooms(walls, state.settings.roomMergeTolerance);

  // Match any placed text note inside a detected room so schedule displays custom room names
  const labeledRooms = rooms.map((room) => {
    const labelNote = textNotes.find(
      (n) => Array.isArray(n.pos) && n.text && n.text.trim() && pointInPolygon(n.pos, room.polygon)
    );
    return {
      ...room,
      displayName: labelNote ? labelNote.text.trim() : room.name,
      labelNoteId: labelNote ? labelNote.id : null,
    };
  });

  if (!state.floorPlan) {
    state.floorPlan = {
      name: 'Floor 1',
      floorHeight: 0,
      sliceHeight: 1.0,
      segments: walls,
      walls,
      measurements,
      textNotes,
      rooms: labeledRooms,
      bounds: exportData?.bounds || null,
    };
  } else {
    state.floorPlan.segments = walls;
    state.floorPlan.walls = walls;
    state.floorPlan.measurements = measurements;
    state.floorPlan.textNotes = textNotes;
    state.floorPlan.rooms = labeledRooms;
    state.floorPlan.bounds = exportData?.bounds || state.floorPlan.bounds;
  }

  updateEditorEmptyOverlay(walls, measurements, textNotes);
  renderRoomsSchedule(labeledRooms, walls.length);
  if (state.currentStep === 4) {
    renderExportPreviewAndRooms();
  }
}

function updateEditorEmptyOverlay(walls, measurements, textNotes) {
  const emptyOverlay = $('#editor-empty-state');
  if (!emptyOverlay) return;

  const isEmpty = walls.length === 0 && measurements.length === 0 && textNotes.length === 0;
  emptyOverlay.hidden = !isEmpty;

  if (!isEmpty) return;

  const hasModel = Boolean(state.modelData && state.detectedFloor);
  renderEmptyState(emptyOverlay, {
    title: hasModel ? 'No Walls Found at This Slice Height' : 'Floor Plan Canvas Is Empty',
    description: hasModel
      ? 'Adjust the Slice Height slider above, reset to the default slice height, or insert a starter room template to draw from scratch.'
      : 'Draw walls with the Draw tool (D), load a 3D sample scan, or drop in a ready-made 4m × 3m room template.',
    actionLabel: hasModel ? 'Reset Slice Height' : 'Load Sample Room',
    onAction: () => {
      if (hasModel) {
        resetSliceHeightToDefault();
      } else {
        loadSampleScan('samples/sample_room.glb');
      }
    },
    secondaryLabel: 'Insert 4m × 3m Room Template',
    onSecondary: () => {
      ensureEditor().insertRoomTemplate(4, 3);
      recordCurrentPlanInRecent();
    },
  });
}

function renderRoomsSchedule(rooms, wallCount) {
  const toggleBtn = $('#btn-toggle-rooms');
  const summaryEl = $('#rooms-summary-counts');
  const listEl = $('#rooms-list-container');
  const panelEl = $('#editor-rooms-panel');

  if (toggleBtn) {
    toggleBtn.textContent = `Rooms (${rooms.length})`;
    toggleBtn.setAttribute('aria-expanded', state.roomsPanelOpen ? 'true' : 'false');
  }
  if (panelEl) {
    panelEl.classList.toggle('is-open', state.roomsPanelOpen);
  }
  if (summaryEl) {
    summaryEl.textContent = `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} · ${wallCount} walls`;
  }
  if (!listEl) return;

  if (rooms.length === 0) {
    renderEmptyState(listEl, {
      compact: true,
      title: 'No Closed Rooms Detected',
      description: 'Closed wall loops are automatically measured here as named rooms for PDF and JSON export.',
      actionLabel: 'Insert Room Template',
      onAction: () => {
        ensureEditor().insertRoomTemplate(4, 3);
        recordCurrentPlanInRecent();
      },
    });
    return;
  }

  listEl.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'room-list';

  for (const room of rooms) {
    const li = document.createElement('li');
    li.className = 'room-list-item';

    const mainRow = document.createElement('div');
    mainRow.className = 'room-list-main';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'room-list-title-wrap';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'room-focus-btn';
    nameBtn.title = 'Center canvas on room';
    nameBtn.textContent = room.displayName || room.name;
    nameBtn.addEventListener('click', () => {
      ensureEditor().focusPoint(room.centroid);
    });

    const dims = document.createElement('span');
    dims.className = 'room-dims-meta';
    const wStr = formatDistance(room.dimensions.width, state.settings.units);
    const hStr = formatDistance(room.dimensions.height, state.settings.units);
    dims.textContent = `${wStr} × ${hStr}`;

    titleWrap.appendChild(nameBtn);
    titleWrap.appendChild(dims);

    const rightWrap = document.createElement('div');
    rightWrap.className = 'room-list-actions';

    const badge = document.createElement('span');
    badge.className = 'room-area-badge';
    badge.textContent = formatArea(room.area, state.settings.units);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn btn-secondary btn-xs';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineRoomRename(li, room);
    });

    rightWrap.appendChild(badge);
    rightWrap.appendChild(renameBtn);

    mainRow.appendChild(titleWrap);
    mainRow.appendChild(rightWrap);
    li.appendChild(mainRow);
    list.appendChild(li);
  }

  listEl.appendChild(list);
}

function startInlineRoomRename(rowEl, room) {
  const existingForm = rowEl.querySelector('.room-rename-form');
  if (existingForm) return;

  const form = document.createElement('div');
  form.className = 'room-rename-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input form-input-sm';
  input.value = room.displayName || room.name;
  input.placeholder = 'Enter room name...';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary btn-xs';
  saveBtn.textContent = 'Save';

  const commit = () => {
    const val = input.value.trim();
    form.remove();
    if (val) {
      ensureEditor().setRoomLabel(room.centroid, val, room.labelNoteId);
    }
  };

  saveBtn.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      form.remove();
    }
  });

  form.appendChild(input);
  form.appendChild(saveBtn);
  rowEl.appendChild(form);
  input.focus();
  input.select();
}

function resetSliceHeightToDefault() {
  if (!state.modelData || !state.detectedFloor || !state.floorPlan) return;
  const slider = $('#slice-height-slider');
  const defaultH = state.detectedFloor.floorHeight + state.settings.defaultSliceOffset;
  slider.value = String(Math.round(defaultH * 100));
  applySliceHeight(defaultH);
}

function applySliceHeight(height) {
  if (!state.modelData || !state.floorPlan) return;
  const sliderValue = $('#slice-height-value');
  sliderValue.textContent = formatDistance(height, state.settings.units);

  const editor = ensureEditor();
  const prevMeasurements = editor.measurements || [];
  const prevTextNotes = editor.textNotes || [];

  const crossSection = extractCrossSection(
    state.modelData.meshes,
    height,
    state.upAxis
  );
  const rooms = detectRooms(crossSection.segments, state.settings.roomMergeTolerance);

  state.floorPlan.sliceHeight = height;
  state.floorPlan.segments = crossSection.segments;
  state.floorPlan.walls = crossSection.segments;
  state.floorPlan.rooms = rooms;
  state.floorPlan.bounds = crossSection.bounds;
  state.floorPlan.measurements = prevMeasurements;
  state.floorPlan.textNotes = prevTextNotes;

  editor.setFloorData([state.floorPlan], { resetHistory: false });
}

function bindEditStepEvents() {
  $$('.btn-tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectTool(btn.dataset.tool);
    });
  });

  $('#btn-undo').addEventListener('click', () => ensureEditor().undo());
  $('#btn-redo').addEventListener('click', () => ensureEditor().redo());
  $('#btn-zoom-in').addEventListener('click', () => ensureEditor().zoomIn());
  $('#btn-zoom-out').addEventListener('click', () => ensureEditor().zoomOut());
  $('#btn-zoom-fit').addEventListener('click', () => ensureEditor().fitToView());

  $('#btn-insert-room').addEventListener('click', () => {
    ensureEditor().insertRoomTemplate(4, 3);
    recordCurrentPlanInRecent();
  });

  $('#btn-toggle-rooms').addEventListener('click', () => {
    state.roomsPanelOpen = !state.roomsPanelOpen;
    $('#editor-rooms-panel')?.classList.toggle('is-open', state.roomsPanelOpen);
    $('#btn-toggle-rooms')?.setAttribute('aria-expanded', state.roomsPanelOpen ? 'true' : 'false');
  });

  $('#btn-close-rooms').addEventListener('click', () => {
    state.roomsPanelOpen = false;
    $('#editor-rooms-panel')?.classList.remove('is-open');
    $('#btn-toggle-rooms')?.setAttribute('aria-expanded', 'false');
  });

  const slider = $('#slice-height-slider');
  const sliderValue = $('#slice-height-value');

  slider.addEventListener('input', () => {
    const height = parseInt(slider.value, 10) / 100;
    sliderValue.textContent = formatDistance(height, state.settings.units);
  });

  slider.addEventListener('change', () => {
    const height = parseInt(slider.value, 10) / 100;
    applySliceHeight(height);
  });

  $('#btn-back-to-orient').addEventListener('click', () => goToStep(2));
  $('#btn-export').addEventListener('click', () => {
    recordCurrentPlanInRecent();
    goToStep(4);
  });
}

function initEditStep() {
  if (typeof window !== 'undefined' && window.innerWidth <= 900) {
    state.roomsPanelOpen = false;
    $('#editor-rooms-panel')?.classList.remove('is-open');
    $('#btn-toggle-rooms')?.setAttribute('aria-expanded', 'false');
  }
  const editor = ensureEditor();
  editor.setSettings(state.settings);

  if (state.floorPlan?.warning) {
    showError('Warning', state.floorPlan.warning);
    state.floorPlan.warning = null;
  }

  const floorData = state.floorPlan ? [state.floorPlan] : [];
  editor.setFloorData(floorData, { resetHistory: false });

  const slider = $('#slice-height-slider');
  const sliderValue = $('#slice-height-value');
  const hasModel = Boolean(state.modelData && state.floorPlan);
  slider.disabled = !hasModel;

  if (state.floorPlan) {
    const minH = Math.min(state.floorPlan.floorHeight ?? 0, state.floorPlan.sliceHeight ?? 1);
    const maxH = Math.max(minH + 3, (state.floorPlan.sliceHeight ?? 1) + 2);
    slider.min = String(Math.round(minH * 100));
    slider.max = String(Math.round(maxH * 100));
    slider.value = String(Math.round((state.floorPlan.sliceHeight ?? 1) * 100));
    sliderValue.textContent = formatDistance(state.floorPlan.sliceHeight ?? 1, state.settings.units);
  } else {
    sliderValue.textContent = formatDistance(0, state.settings.units);
  }
}

function selectTool(tool) {
  $$('.btn-tool[data-tool]').forEach((b) => b.classList.remove('active'));
  $(`.btn-tool[data-tool="${tool}"]`)?.classList.add('active');
  ensureEditor().setTool(tool);
}

// ============================================================
// Step 4: Export PDF & Blueprint Preview (Event handlers bound once!)
// ============================================================
function getExportFloorSnapshot() {
  const edited = state.editor ? state.editor.getExportData() : null;
  const base = state.floorPlan;
  if (!edited && !base) return null;

  const walls = edited ? edited.walls : (base?.walls || base?.segments || []);
  const measurements = edited ? edited.measurements : (base?.measurements || []);
  const textNotes = edited ? edited.textNotes : (base?.textNotes || []);
  const bounds = edited?.bounds || base?.bounds || null;

  return {
    name: base?.name || 'Floor 1',
    floorHeight: state.detectedFloor?.floorHeight ?? base?.floorHeight ?? null,
    ceilingHeight: state.detectedFloor?.ceilingHeight ?? null,
    walls,
    segments: walls,
    measurements,
    textNotes,
    bounds,
  };
}

function renderExportPreviewAndRooms() {
  const previewEl = $('#export-preview');
  const metaEl = $('#export-preview-meta');
  const roomsSummaryEl = $('#export-rooms-summary');

  const projectName = ($('#project-name')?.value || '').trim() || 'Floor Plan';
  const paperSize = $('#paper-size')?.value || state.settings.defaultPaperSize;
  const scaleVal = $('#export-scale')?.value || state.settings.defaultScale;

  const floor = getExportFloorSnapshot();

  if (metaEl) {
    metaEl.textContent = `${paperSize.toUpperCase()} · ${scaleVal === 'auto' ? 'Auto-fit' : `1:${scaleVal}`}`;
  }

  renderBlueprintPreview(previewEl, {
    floor,
    projectName,
    paperSize,
    scale: scaleVal,
    units: state.settings.units,
    onLoadSample: () => loadSampleScan('samples/sample_house.glb'),
    onGoToEditor: () => goToStep(3),
  });

  if (!roomsSummaryEl) return;

  const walls = floor?.walls || [];
  const textNotes = floor?.textNotes || [];
  const rawRooms = detectRooms(walls, state.settings.roomMergeTolerance);

  if (rawRooms.length === 0) {
    renderEmptyState(roomsSummaryEl, {
      compact: true,
      title: 'No Closed Rooms in Export',
      description: walls.length > 0
        ? 'Wall geometry is ready for PDF export, though no closed loops formed rooms for the JSON room schedule.'
        : 'Load a sample scan or insert a room template in the editor to populate room areas and dimensions.',
      actionLabel: walls.length > 0 ? 'Edit Walls' : 'Load Sample House',
      onAction: () => {
        if (walls.length > 0) goToStep(3);
        else loadSampleScan('samples/sample_house.glb');
      },
    });
    return;
  }

  roomsSummaryEl.innerHTML = '';
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'table-scroll-container';

  const table = document.createElement('table');
  table.className = 'rooms-summary-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Room</th>
        <th>Dimensions</th>
        <th>Perimeter</th>
        <th>Area</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  rawRooms.forEach((room, i) => {
    const labelNote = textNotes.find(
      (n) => Array.isArray(n.pos) && n.text && n.text.trim() && pointInPolygon(n.pos, room.polygon)
    );
    const name = labelNote ? labelNote.text.trim() : `${room.name} ${i + 1}`;

    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = name;
    const tdDims = document.createElement('td');
    tdDims.className = 'mono-cell';
    tdDims.textContent = `${formatDistance(room.dimensions.width, state.settings.units)} × ${formatDistance(room.dimensions.height, state.settings.units)}`;
    const tdPerim = document.createElement('td');
    tdPerim.className = 'mono-cell';
    tdPerim.textContent = formatDistance(room.perimeter, state.settings.units);
    const tdArea = document.createElement('td');
    tdArea.className = 'mono-cell';
    tdArea.textContent = formatArea(room.area, state.settings.units);

    tr.append(tdName, tdDims, tdPerim, tdArea);
    tbody.appendChild(tr);
  });

  scrollWrap.appendChild(table);
  roomsSummaryEl.appendChild(scrollWrap);
}

function bindExportStepEvents() {
  const nameInput = $('#project-name');
  const paperSelect = $('#paper-size');
  const scaleSelect = $('#export-scale');

  nameInput.addEventListener('input', renderExportPreviewAndRooms);
  paperSelect.addEventListener('change', renderExportPreviewAndRooms);
  scaleSelect.addEventListener('change', renderExportPreviewAndRooms);

  $('#btn-back-to-edit').addEventListener('click', () => goToStep(3));

  $('#btn-save-plan-data').addEventListener('click', async () => {
    const floor = getExportFloorSnapshot();
    if (!floor || (floor.walls.length === 0 && floor.measurements.length === 0)) {
      showError('Nothing to Export', 'Load a 3D scan or draw walls in the editor before saving plan data.');
      return;
    }

    const projectName = nameInput.value.trim() || 'Floor Plan';
    try {
      const data = buildPlanData({
        projectName,
        floor: {
          name: floor.name,
          floorHeight: floor.floorHeight,
          ceilingHeight: floor.ceilingHeight,
        },
        walls: floor.walls,
        textNotes: floor.textNotes,
        tolerance: state.settings.roomMergeTolerance,
      });
      const roomCount = data.floors[0].rooms.length;
      const result = await savePlanData(data, `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_plan.json`);
      if (result.success) {
        recordCurrentPlanInRecent();
        const roomsMsg = roomCount
          ? `${roomCount} room${roomCount === 1 ? '' : 's'} and the walls saved.`
          : 'Walls saved. No closed rooms were found, so the walls will show as a guide to draw rooms over.';
        showSuccess('Plan Data Saved', `${roomsMsg} In PaintingBusinessManager, open the quote's House plan step and choose "Import plan data".`);
      }
    } catch (err) {
      console.error('Plan data export failed:', err);
      showError('Export Failed', `Could not save plan data: ${err.message}`);
    }
  });

  $('#btn-save-pdf').addEventListener('click', async () => {
    const floor = getExportFloorSnapshot();
    if (!floor || !floor.bounds || (floor.walls.length === 0 && floor.measurements.length === 0)) {
      showError('Nothing to Export', 'Load a 3D scan or draw walls in the editor before exporting a PDF.');
      return;
    }

    const projectName = nameInput.value.trim() || 'Floor Plan';
    const paperSize = paperSelect.value;
    const scaleVal = scaleSelect.value;
    const scale = scaleVal === 'auto' ? 'auto' : parseInt(scaleVal, 10);

    try {
      const safeName = `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_floorplan.pdf`;
      const { doc } = exportPDF({
        projectName,
        paperSize,
        scale,
        units: state.settings.units,
        floors: [floor],
        fileName: safeName,
      });

      const result = await savePDF(doc, safeName);
      if (result.success) {
        recordCurrentPlanInRecent();
        showSuccess(
          'PDF Saved',
          result.method === 'filesystem'
            ? 'Floor plan PDF has been saved to your chosen location.'
            : 'Floor plan PDF has been downloaded.'
        );
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      showError('Export Failed', `Could not generate PDF: ${err.message}`);
    }
  });
}

function initExportStep() {
  const nameInput = $('#project-name');
  if (!nameInput.value && state.file) {
    nameInput.value = state.file.name.replace(/\.glb$/i, '');
  }
  renderExportPreviewAndRooms();
}

// ============================================================
// Global Header Stepper, Command Palette, Shortcuts & Settings
// ============================================================
function applySettingsToApp(nextSettings, changes = []) {
  state.settings = nextSettings;

  // Apply defaults to Export dropdowns if user explicitly changed defaultPaperSize / defaultScale
  const changedKeys = new Set(changes.map((c) => c.key));
  if (changedKeys.has('defaultPaperSize')) {
    $('#paper-size').value = nextSettings.defaultPaperSize;
  }
  if (changedKeys.has('defaultScale')) {
    $('#export-scale').value = nextSettings.defaultScale;
  }

  if (state.editor) {
    state.editor.setSettings(nextSettings);
  }
  if (state.modelData) {
    updateOrientStatsDisplay();
  }
  if (state.floorPlan) {
    const rooms = detectRooms(state.floorPlan.walls || [], nextSettings.roomMergeTolerance);
    const notes = state.floorPlan.textNotes || [];
    const labeledRooms = rooms.map((room) => {
      const labelNote = notes.find(
        (n) => Array.isArray(n.pos) && n.text && n.text.trim() && pointInPolygon(n.pos, room.polygon)
      );
      return {
        ...room,
        displayName: labelNote ? labelNote.text.trim() : room.name,
        labelNoteId: labelNote ? labelNote.id : null,
      };
    });
    state.floorPlan.rooms = labeledRooms;
    renderRoomsSchedule(labeledRooms, (state.floorPlan.walls || []).length);
    const sliderValue = $('#slice-height-value');
    if (sliderValue && typeof state.floorPlan.sliceHeight === 'number') {
      sliderValue.textContent = formatDistance(state.floorPlan.sliceHeight, nextSettings.units);
    }
  }
  if (state.currentStep === 4) {
    renderExportPreviewAndRooms();
  }
}

function buildCommandPaletteItems() {
  const pages = [
    {
      group: 'Pages',
      title: 'Step 1: Load 3D Scan',
      subtitle: 'Upload a .glb file or resume a recent scan',
      shortcut: '1',
      keywords: 'upload glb import home start',
      run: () => goToStep(1),
    },
    {
      group: 'Pages',
      title: 'Step 2: Confirm Orientation',
      subtitle: 'Verify the upward axis in the 3D viewport',
      shortcut: '2',
      keywords: '3d axis orient rotate up',
      run: () => goToStep(2),
    },
    {
      group: 'Pages',
      title: 'Step 3: Edit Floor Plan',
      subtitle: 'Draw walls, measure distances, and label rooms',
      shortcut: '3',
      keywords: '2d canvas editor svg slice',
      run: () => goToStep(3),
    },
    {
      group: 'Pages',
      title: 'Step 4: Export Blueprint',
      subtitle: 'Preview PDF sheet and export JSON plan data',
      shortcut: '4',
      keywords: 'pdf json blueprint save download',
      run: () => goToStep(4),
    },
  ];

  const actions = [
    {
      group: 'Actions',
      title: 'Choose GLB File...',
      subtitle: 'Open local file picker for a 3D scan',
      shortcut: 'O',
      keywords: 'browse open load file',
      run: () => {
        goToStep(1);
        $('#file-input')?.click();
      },
    },
    {
      group: 'Actions',
      title: 'Load Sample Room Scan (245 KB)',
      subtitle: 'Try the pipeline immediately with a single room scan',
      keywords: 'demo sample test room',
      run: () => loadSampleScan('samples/sample_room.glb'),
    },
    {
      group: 'Actions',
      title: 'Load Sample House Scan (560 KB)',
      subtitle: 'Try multi-room floor and room detection',
      keywords: 'demo sample test house',
      run: () => loadSampleScan('samples/sample_house.glb'),
    },
    {
      group: 'Actions',
      title: 'Open Application Settings',
      subtitle: 'Configure units, angle snapping, slice defaults & paper size',
      shortcut: ',',
      keywords: 'preferences units metric imperial config',
      run: () => settingsCtrl?.open(),
    },
    {
      group: 'Actions',
      title: 'Keyboard Shortcuts Reference',
      subtitle: 'View all keyboard shortcuts',
      shortcut: '?',
      keywords: 'help hotkeys keys overlay',
      run: () => shortcutsCtrl?.open(),
    },
    {
      group: 'Actions',
      title: 'Tool: Select',
      subtitle: 'Select and drag text labels or delete walls',
      shortcut: 'V',
      keywords: 'pointer cursor editor',
      run: () => {
        goToStep(3);
        selectTool('select');
      },
    },
    {
      group: 'Actions',
      title: 'Tool: Pan Canvas',
      subtitle: 'Move around the 2D blueprint canvas',
      shortcut: 'H',
      keywords: 'hand drag move editor',
      run: () => {
        goToStep(3);
        selectTool('pan');
      },
    },
    {
      group: 'Actions',
      title: 'Tool: Draw Wall',
      subtitle: 'Draw snapped wall segments on the floor plan',
      shortcut: 'D',
      keywords: 'wall line sketch editor',
      run: () => {
        goToStep(3);
        selectTool('draw');
      },
    },
    {
      group: 'Actions',
      title: 'Tool: Measure Distance',
      subtitle: 'Add snapped dimension annotations',
      shortcut: 'M',
      keywords: 'ruler dimension length editor',
      run: () => {
        goToStep(3);
        selectTool('measure');
      },
    },
    {
      group: 'Actions',
      title: 'Tool: Add Text Note',
      subtitle: 'Place room labels or architectural notes',
      shortcut: 'T',
      keywords: 'label room name text editor',
      run: () => {
        goToStep(3);
        selectTool('text');
      },
    },
    {
      group: 'Actions',
      title: 'Tool: Erase',
      subtitle: 'Remove walls, measurements, or labels',
      shortcut: 'E',
      keywords: 'delete remove editor',
      run: () => {
        goToStep(3);
        selectTool('erase');
      },
    },
    {
      group: 'Actions',
      title: 'Fit Floor Plan to View',
      subtitle: 'Center and zoom the 2D plan cleanly',
      shortcut: 'F',
      keywords: 'zoom reset center view',
      run: () => {
        goToStep(3);
        ensureEditor().fitToView();
      },
    },
    {
      group: 'Actions',
      title: 'Insert 4m × 3m Room Template',
      subtitle: 'Add a sample closed room to the 2D canvas',
      keywords: 'template starter room empty',
      run: () => {
        goToStep(3);
        ensureEditor().insertRoomTemplate(4, 3);
        recordCurrentPlanInRecent();
      },
    },
    {
      group: 'Actions',
      title: 'Undo Last Edit',
      subtitle: 'Revert the previous change in the 2D editor',
      shortcut: 'Ctrl+Z',
      keywords: 'history revert',
      run: () => {
        goToStep(3);
        ensureEditor().undo();
      },
    },
    {
      group: 'Actions',
      title: 'Redo Edit',
      subtitle: 'Re-apply the last undone change',
      shortcut: 'Ctrl+Y',
      keywords: 'history forward',
      run: () => {
        goToStep(3);
        ensureEditor().redo();
      },
    },
  ];

  const recents = (state.recentItems || []).map((item) => ({
    group: 'Recent Items',
    title: item.name,
    subtitle: item.roomCount > 0
      ? `${item.roomCount} ${item.roomCount === 1 ? 'room' : 'rooms'} · ${item.wallCount} walls`
      : item.sourceType === 'sample'
        ? 'Built-in sample scan'
        : 'Recent GLB scan',
    timestamp: item.timestamp,
    keywords: 'recent history resume',
    run: () => resumeRecentItem(item),
  }));

  return [...pages, ...actions, ...recents];
}

// ============================================================
// Error & Success Modals
// ============================================================
function showError(title, message) {
  const modal = $('#error-modal');
  const icon = modal.querySelector('.modal-icon');
  icon.classList.add('error');
  icon.style.color = '';
  $('#error-title').textContent = title;
  $('#error-message').textContent = message;
  modal.hidden = false;

  $('#btn-error-dismiss').onclick = () => {
    modal.hidden = true;
  };
}

function showSuccess(title, message) {
  const modal = $('#error-modal');
  const icon = modal.querySelector('.modal-icon');
  icon.classList.remove('error');
  icon.style.color = 'var(--accent-green)';
  $('#error-title').textContent = title;
  $('#error-message').textContent = message;
  modal.hidden = false;

  $('#btn-error-dismiss').onclick = () => {
    modal.hidden = true;
    icon.classList.add('error');
    icon.style.color = '';
  };
}

// ============================================================
// Initialize App
// ============================================================
function initApp() {
  // Apply saved defaults to Export controls immediately
  $('#paper-size').value = state.settings.defaultPaperSize;
  $('#export-scale').value = state.settings.defaultScale;

  // Wire header step indicators
  $$('.step-indicator').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetStep = parseInt(btn.dataset.step, 10);
      goToStep(targetStep);
    });
  });

  // Wire step listeners once
  initLoadStep();
  bindOrientStepEvents();
  bindEditStepEvents();
  bindExportStepEvents();

  // Close error modal on backdrop click
  $('#error-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#error-modal')) {
      $('#error-modal').hidden = true;
    }
  });

  // Initialize Command Palette
  paletteCtrl = initCommandPalette({
    modalEl: $('#command-palette-modal'),
    inputEl: $('#command-palette-input'),
    resultsEl: $('#command-palette-results'),
    triggerBtnEl: $('#btn-command-palette'),
    closeBtnEl: $('#btn-close-palette'),
    getItems: buildCommandPaletteItems,
  });

  // Initialize Settings Modal
  settingsCtrl = initSettingsModal({
    modalEl: $('#settings-modal'),
    bodyEl: $('#settings-modal-body'),
    diffStatusEl: $('#settings-diff-status'),
    openBtnEl: $('#btn-settings'),
    closeBtnEl: $('#btn-close-settings'),
    cancelBtnEl: $('#btn-cancel-settings'),
    resetBtnEl: $('#btn-reset-settings'),
    saveBtnEl: $('#btn-save-settings'),
    toastEl: $('#app-toast'),
    getCurrentSettings: () => state.settings,
    onSettingsApplied: applySettingsToApp,
  });

  // Initialize Keyboard Shortcuts & "?" Overlay
  shortcutsCtrl = initShortcutsOverlay({
    modalEl: $('#shortcuts-modal'),
    bodyEl: $('#shortcuts-modal-body'),
    closeBtnEl: $('#btn-close-shortcuts'),
    openBtnEl: $('#btn-shortcuts-help'),
    getCurrentStep: () => state.currentStep,
    isAnyOtherModalOpen: () => {
      const errorOpen = !$('#error-modal').hidden;
      return Boolean(paletteCtrl?.isOpen() || settingsCtrl?.isOpen() || errorOpen);
    },
    handlers: {
      toggleCommandPalette: () => paletteCtrl?.toggle(),
      openSettings: () => settingsCtrl?.open(),
      openFile: () => {
        goToStep(1);
        $('#file-input')?.click();
      },
      goToStep,
      selectTool,
      fitView: () => ensureEditor().fitToView(),
      zoomIn: () => ensureEditor().zoomIn(),
      zoomOut: () => ensureEditor().zoomOut(),
      undo: () => ensureEditor().undo(),
      redo: () => ensureEditor().redo(),
      closeTopModal: () => {
        if (paletteCtrl?.isOpen()) {
          paletteCtrl.close();
          return true;
        }
        if (settingsCtrl?.isOpen()) {
          settingsCtrl.close();
          return true;
        }
        if (!$('#error-modal').hidden) {
          $('#error-modal').hidden = true;
          return true;
        }
        return false;
      },
    },
  });

  // Collapse the rooms drawer automatically when resizing below 900px so the 2D canvas stays unobstructed
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mobileMq = window.matchMedia('(max-width: 900px)');
    const syncDrawerForViewport = (mq) => {
      state.roomsPanelOpen = !mq.matches;
      $('#editor-rooms-panel')?.classList.toggle('is-open', state.roomsPanelOpen);
      $('#btn-toggle-rooms')?.setAttribute('aria-expanded', state.roomsPanelOpen ? 'true' : 'false');
    };
    mobileMq.addEventListener?.('change', syncDrawerForViewport);
  }

  goToStep(1);
}

initApp();
