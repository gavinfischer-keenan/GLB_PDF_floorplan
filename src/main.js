/**
 * Main application — orchestrates the GLB/JSON -> Multi-Floor Plan pipeline
 * Manages the 4-step wizard flow, persistent settings, recent items,
 * command palette, help/shortcuts overlay, layer manager, properties bar,
 * scale calibration, and multi-format export.
 */
import { isSupported3DFile, SUPPORTED_3D_EXTENSIONS } from './utils/model-formats.js';
import { detectUpDirection } from './up-detector.js';
import { detectFloors } from './floor-detector.js';
import { detectRooms } from './room-detector.js';
import { FloorPlanEditor } from './floor-plan-editor.js';
import { buildPlanData, parsePlanData, savePlanData } from './plan-data-exporter.js';

// Cached lazy dynamic loaders for heavy dependencies (Three.js, BVH slicer, jsPDF)
let glbLoaderModulePromise = null;
function loadModelLoaderModule() {
  return (glbLoaderModulePromise ||= import('./glb-loader.js'));
}

let viewportModulePromise = null;
function loadViewportModule() {
  return (viewportModulePromise ||= import('./viewport-3d.js'));
}

let crossSectionModulePromise = null;
function loadCrossSectionModule() {
  return (crossSectionModulePromise ||= import('./cross-section.js'));
}

let pdfExporterModulePromise = null;
function loadPdfExporterModule() {
  return (pdfExporterModulePromise ||= import('./pdf-exporter.js'));
}
import { buildSVG, buildDXF, saveTextFile, exportSVGElementToPNG } from './vector-exporter.js';
import { formatDistance, formatArea, pointInPolygon, scalePoint } from './utils/geometry.js';
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
const initialSettings = loadSettings();

const state = {
  currentStep: 1,
  file: null,
  sourceMeta: null,     // { sourceType: 'sample'|'file'|'template'|'json', samplePath?: string }
  modelData: null,      // From GLBLoader
  upAxis: null,         // Detected up direction
  detectedFloors: [],   // Array from detectFloors()
  floorPlans: [],       // Array of editable floor plan objects
  activeFloorIndex: 0,
  exportPreviewIndex: 0,
  show3DFloorPlanes: true,
  exportShowRooms: initialSettings.showRooms,
  exportMeta: {
    client: '',
    address: '',
    author: '',
    sheetNumber: '',
    orientation: 'landscape',
    showNorth: true,
    northAngle: 0,
    includeRoomSchedule: true,
  },
  viewport: null,
  editor: null,
  settings: initialSettings,
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

function getActiveFloor() {
  return state.floorPlans[state.activeFloorIndex] || null;
}

function labelRooms(rooms, textNotes = []) {
  return (rooms || []).map((room) => {
    const labelNote = textNotes.find(
      (n) => Array.isArray(n.pos) && n.text && n.text.trim() && pointInPolygon(n.pos, room.polygon)
    );
    return {
      ...room,
      displayName: labelNote ? labelNote.text.trim() : room.name,
      labelNoteId: labelNote ? labelNote.id : null,
    };
  });
}

function parseLengthInputMeters(rawInput, units = 'imperial') {
  const s = String(rawInput || '').trim().toLowerCase();
  if (!s) return null;

  const ftInMatch = s.match(/^(\d+(?:\.\d+)?)\s*['′ft]+\s*(?:(\d+(?:\.\d+)?)\s*["″in]*)?$/);
  if (ftInMatch) {
    const ft = parseFloat(ftInMatch[1]) || 0;
    const inches = parseFloat(ftInMatch[2] || '0') || 0;
    return (ft + inches / 12) * 0.3048;
  }

  const inOnlyMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|″|in)$/);
  if (inOnlyMatch) {
    return parseFloat(inOnlyMatch[1]) * 0.0254;
  }

  const cmMatch = s.match(/^(\d+(?:\.\d+)?)\s*cm$/);
  if (cmMatch) {
    return parseFloat(cmMatch[1]) * 0.01;
  }

  const mMatch = s.match(/^(\d+(?:\.\d+)?)\s*m$/);
  if (mMatch) {
    return parseFloat(mMatch[1]);
  }

  const numeric = parseFloat(s);
  if (!(numeric > 0)) return null;
  return units === 'metric' ? numeric : numeric * 0.3048;
}

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
// Shared File / Sample Loader & Recent History
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
    await handleInputFile(sampleFile, { sourceType: 'sample', samplePath });
  } catch (err) {
    console.error('Failed to load sample scan:', err);
    showError('Sample Load Error', `Could not load sample model: ${err.message}`);
    uploadZone.hidden = false;
    loadingOverlay.hidden = true;
    progressFill.style.width = '0%';
  }
}

function applyImportedMetadata(meta = {}) {
  state.exportMeta = {
    client: meta.client || '',
    address: meta.address || '',
    author: meta.author || '',
    sheetNumber: meta.sheetNumber || '',
    orientation: meta.orientation === 'portrait' ? 'portrait' : 'landscape',
    showNorth: typeof meta.showNorth === 'boolean' ? meta.showNorth : true,
    northAngle: typeof meta.northAngle === 'number' ? meta.northAngle : 0,
    includeRoomSchedule: typeof meta.includeRoomSchedule === 'boolean' ? meta.includeRoomSchedule : true,
  };
  syncExportMetaInputs();
}

async function handleJSONPlanFile(file) {
  try {
    const text = await file.text();
    const { projectName, metadata, floors } = parsePlanData(text, state.settings.roomMergeTolerance);

    state.file = file;
    state.modelData = null;
    state.detectedFloors = [];
    state.upAxis = '+y';
    state.sourceMeta = { sourceType: 'json' };
    state.floorPlans = floors;
    state.activeFloorIndex = 0;
    state.exportPreviewIndex = 0;
    applyImportedMetadata(metadata);

    const nameInput = $('#project-name');
    if (nameInput) nameInput.value = projectName || file.name.replace(/\.json$/i, '');

    if (state.editor) {
      state.editor.setFloorData(state.floorPlans, { resetHistory: true, activeIndex: 0 });
    }

    recordCurrentPlanInRecent();
    goToStep(3);

    const totalRooms = floors.reduce((s, f) => s + (f.rooms?.length || 0), 0);
    const totalWalls = floors.reduce((s, f) => s + (f.walls?.length || 0), 0);
    showSettingsToast(
      $('#app-toast'),
      'Imported plan data',
      `${projectName} (${floors.length} ${floors.length === 1 ? 'floor' : 'floors'}, ${totalRooms} rooms, ${totalWalls} walls)`
    );
  } catch (err) {
    console.error('Failed to import JSON plan:', err);
    showError('Invalid Plan File', `Could not import JSON plan: ${err.message}`);
  }
}

async function handleInputFile(file, sourceMeta = { sourceType: 'file' }) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.json')) {
    await handleJSONPlanFile(file);
    return;
  }

  const uploadZone = $('#upload-zone');
  const loadingOverlay = $('#loading-overlay');
  const progressFill = $('#progress-fill');

  if (!isSupported3DFile(file.name)) {
    showError(
      'Invalid File',
      `Please select a 3D scan (${SUPPORTED_3D_EXTENSIONS.join(', ')}) or .json floor plan file.`
    );
    return;
  }

  state.file = file;
  state.sourceMeta = sourceMeta;
  uploadZone.hidden = true;
  loadingOverlay.hidden = false;
  progressFill.style.width = '15%';

  const baseName = file.name.replace(/\.(glb|gltf|obj|stl|ply)$/i, '');

  try {
    const { GLBLoader } = await loadModelLoaderModule();
    const loader = new GLBLoader();
    loader.onProgress = (pct) => {
      progressFill.style.width = `${pct}%`;
    };

    state.modelData = await loader.load(file);

    if (state.modelData.totalTriangles === 0) {
      throw new Error('The 3D model contains no triangle geometry data.');
    }

    state.recentItems = addRecentItem({
      name: baseName,
      sourceType: sourceMeta.sourceType,
      samplePath: sourceMeta.samplePath || null,
      totalTriangles: state.modelData.totalTriangles,
      wallCount: 0,
      roomCount: 0,
      floorCount: 0,
    });

    const nameInput = $('#project-name');
    if (nameInput) nameInput.value = baseName;

    goToStep(2);
  } catch (err) {
    console.error('Failed to load 3D scan:', err);
    showError('Failed to Load', `Could not parse the 3D scan file: ${err.message}`);
    uploadZone.hidden = false;
    loadingOverlay.hidden = true;
    progressFill.style.width = '0%';
  }
}

function recordCurrentPlanInRecent() {
  if (!state.floorPlans || state.floorPlans.length === 0) return;

  const projectName = ($('#project-name')?.value || '').trim()
    || state.file?.name?.replace(/\.(glb|gltf|obj|stl|ply|json)$/i, '')
    || 'Floor Plan';

  const totalWalls = state.floorPlans.reduce((sum, f) => sum + ((f.walls || f.segments || []).length), 0);
  const totalRooms = state.floorPlans.reduce((sum, f) => sum + ((f.rooms || []).length), 0);

  const canSnapshot = totalWalls <= 3000;
  const floorsSnapshot = canSnapshot
    ? state.floorPlans.map((f, idx) => ({
        name: f.name || `Floor ${idx + 1}`,
        floorHeight: f.floorHeight ?? 0,
        ceilingHeight: f.ceilingHeight ?? (f.floorHeight ?? 0) + 3.0,
        sliceHeight: f.sliceHeight ?? 1.0,
        sliceOffset: f.sliceOffset ?? 1.0,
        segments: f.walls || f.segments || [],
        scanWalls: f.scanWalls || [],
        draftedWalls: f.draftedWalls || [],
        measurements: f.measurements || [],
        textNotes: f.textNotes || [],
        symbols: f.symbols || [],
        bounds: f.bounds || null,
      }))
    : null;

  state.recentItems = addRecentItem({
    name: projectName,
    sourceType: state.sourceMeta?.sourceType || 'template',
    samplePath: state.sourceMeta?.samplePath || null,
    totalTriangles: state.modelData?.totalTriangles || 0,
    wallCount: totalWalls,
    roomCount: totalRooms,
    floorCount: state.floorPlans.length,
    metadata: { ...state.exportMeta },
    floorPlanSnapshot: floorsSnapshot ? floorsSnapshot[0] : null,
    floorsSnapshot,
  });

  renderRecentScans();
}

function resumeRecentItem(item) {
  if (!item) return;

  const snaps = Array.isArray(item.floorsSnapshot) && item.floorsSnapshot.length > 0
    ? item.floorsSnapshot
    : item.floorPlanSnapshot
      ? [item.floorPlanSnapshot]
      : null;

  if (snaps) {
    state.modelData = null;
    state.detectedFloors = snaps.map((s, idx) => ({
      name: s.name || `Floor ${idx + 1}`,
      floorHeight: s.floorHeight ?? 0,
      ceilingHeight: s.ceilingHeight ?? 3.0,
      sliceHeight: s.sliceHeight ?? 1.0,
      sliceOffset: s.sliceOffset ?? 1.0,
    }));

    state.floorPlans = snaps.map((snap, idx) => {
      const hasSplit = Array.isArray(snap.scanWalls) || Array.isArray(snap.draftedWalls);
      const scanWalls = hasSplit ? (snap.scanWalls || []) : (snap.segments || []);
      const draftedWalls = hasSplit ? (snap.draftedWalls || []) : [];
      const segs = hasSplit ? [...scanWalls, ...draftedWalls] : scanWalls;
      const notes = snap.textNotes || [];
      const rooms = labelRooms(detectRooms(segs, state.settings.roomMergeTolerance), notes);
      return {
        name: snap.name || `Floor ${idx + 1}`,
        floorHeight: snap.floorHeight ?? 0,
        ceilingHeight: snap.ceilingHeight ?? 3.0,
        sliceHeight: snap.sliceHeight ?? 1.0,
        sliceOffset: snap.sliceOffset ?? Math.max(0.1, Math.abs((snap.sliceHeight ?? 1.0) - (snap.floorHeight ?? 0))),
        segments: segs,
        walls: segs,
        scanWalls,
        draftedWalls,
        measurements: snap.measurements || [],
        textNotes: notes,
        symbols: snap.symbols || [],
        rooms,
        bounds: snap.bounds || null,
        warning: null,
      };
    });

    if (item.metadata) applyImportedMetadata(item.metadata);

    state.activeFloorIndex = 0;
    state.exportPreviewIndex = 0;
    state.sourceMeta = { sourceType: item.sourceType, samplePath: item.samplePath };

    if (state.editor) {
      state.editor.setFloorData(state.floorPlans, { resetHistory: true, activeIndex: 0 });
    }

    const nameInput = $('#project-name');
    if (nameInput) nameInput.value = item.name;
    goToStep(3);
    const totalRooms = state.floorPlans.reduce((s, f) => s + f.rooms.length, 0);
    const totalWalls = state.floorPlans.reduce((s, f) => s + f.walls.length, 0);
    showSettingsToast($('#app-toast'), 'Resumed floor plan', `${item.name} (${state.floorPlans.length} floors, ${totalRooms} rooms, ${totalWalls} walls)`);
    return;
  }

  if (item.samplePath) {
    loadSampleScan(item.samplePath);
    return;
  }

  showError('Scan File Required', `"${item.name}" was loaded from a local file without a saved plan snapshot. Please drop the .glb file again to inspect it.`);
}

// ============================================================
// Step 1: Load GLB/JSON & Recent Scans
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
    if (item.floorCount > 1) metaParts.push(`${item.floorCount} floors`);
    if (item.roomCount > 0 || item.wallCount > 0) {
      metaParts.push(`${item.roomCount} ${item.roomCount === 1 ? 'room' : 'rooms'}`);
      metaParts.push(`${item.wallCount} walls`);
    } else if (item.totalTriangles > 0) {
      metaParts.push(`${item.totalTriangles.toLocaleString()} tris`);
    }
    if (item.sourceType === 'sample') metaParts.push('Built-in sample');
    else if (item.sourceType === 'template') metaParts.push('Room template');
    else if (item.sourceType === 'json') metaParts.push('Imported JSON');
    if (item.timestamp) metaParts.push(new Date(item.timestamp).toLocaleDateString());

    const meta = document.createElement('span');
    meta.className = 'recent-item-meta';
    meta.textContent = metaParts.join(' · ');
    info.appendChild(meta);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = (item.floorsSnapshot || item.floorPlanSnapshot || item.samplePath) ? 'Resume' : 'Reload';
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
      handleInputFile(e.dataTransfer.files[0], { sourceType: 'file' });
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleInputFile(fileInput.files[0], { sourceType: 'file' });
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
// Step 2: Confirm Orientation & Multi-Floor 3D Preview
// ============================================================
function computeFallbackFloor() {
  const b = state.modelData.bounds;
  const axisChar = state.upAxis.slice(-1).toLowerCase();
  const sign = state.upAxis[0] === '-' ? -1 : 1;
  const floorH = sign > 0 ? b.min[axisChar] : b.max[axisChar];
  const offset = state.settings.defaultSliceOffset;
  return {
    name: 'Floor 1',
    floorHeight: floorH,
    ceilingHeight: floorH + sign * 3.0,
    sliceHeight: floorH + sign * offset,
    sliceOffset: offset,
  };
}

function updateOrientFloorPlanes() {
  if (!state.modelData || !state.upAxis) return;
  let floors = detectFloors(state.modelData.meshes, state.upAxis, {
    sliceOffset: state.settings.defaultSliceOffset,
  });
  if (floors.length === 0) {
    floors = [computeFallbackFloor()];
  }
  state.detectedFloors = floors;

  const floorsStat = $('#stat-floors');
  if (floorsStat) {
    floorsStat.textContent = `${floors.length} ${floors.length === 1 ? 'floor' : 'floors'}`;
  }

  state.viewport?.showFloorPlanes(floors, state.upAxis, state.modelData.bounds);
  state.viewport?.setFloorPlanesVisible(state.show3DFloorPlanes);
}

function bindOrientStepEvents() {
  $$('.btn-axis').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.upAxis = btn.dataset.axis;
      $$('.btn-axis').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewport?.showUpArrow(state.upAxis);
      updateOrientFloorPlanes();
    });
  });

  $('#toggle-3d-planes')?.addEventListener('change', (e) => {
    state.show3DFloorPlanes = Boolean(e.target.checked);
    state.viewport?.setFloorPlanesVisible(state.show3DFloorPlanes);
  });

  const confirmBtn = $('#btn-confirm-orient');
  confirmBtn.addEventListener('click', async () => {
    if (!state.modelData) {
      goToStep(1);
      return;
    }

    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    try {
      if (!state.detectedFloors || state.detectedFloors.length === 0) {
        updateOrientFloorPlanes();
      }

      await processAllFloors();
      recordCurrentPlanInRecent();
      goToStep(3);
    } catch (err) {
      console.error('Failed to extract cross-section:', err);
      showError('Cross-Section Failed', `Could not slice the 3D scan: ${err.message}`);
    } finally {
      confirmBtn.disabled = false;
    }
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

async function initOrientStep() {
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

  const crossSectionPreload = loadCrossSectionModule();
  if (!state.viewport) {
    const [{ Viewport3D }] = await Promise.all([
      loadViewportModule(),
      crossSectionPreload,
    ]);
    if (state.currentStep !== 2 || !state.modelData) return;
    const container = $('#viewport-3d');
    if (!state.viewport && container) {
      state.viewport = new Viewport3D(container);
    }
  }

  if (state.currentStep !== 2 || !state.modelData || !state.viewport) return;

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
  updateOrientFloorPlanes();

  $$('.btn-axis').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.axis === state.upAxis);
  });
}

async function processAllFloors() {
  const { extractCrossSection } = await loadCrossSectionModule();
  const floors = state.detectedFloors.length > 0 ? state.detectedFloors : [computeFallbackFloor()];
  const simplifyEpsilon = state.settings.wallSimplification || 0;

  state.floorPlans = floors.map((floor) => {
    const crossSection = extractCrossSection(
      state.modelData.meshes,
      floor.sliceHeight,
      state.upAxis,
      { simplifyEpsilon }
    );
    const rooms = detectRooms(crossSection.segments, state.settings.roomMergeTolerance);
    const bounds = crossSection.bounds;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;

    let warning = null;
    if (crossSection.segments.length === 0) {
      warning = `No wall segments detected on ${floor.name} at this slice offset. Try adjusting the Slice Offset slider in the editor.`;
    } else if (spanX > 200 || spanY > 200) {
      warning = 'Model spans over 200m. This appears to be a large outdoor area rather than a building.';
    }

    return {
      name: floor.name,
      floorHeight: floor.floorHeight,
      ceilingHeight: floor.ceilingHeight,
      sliceHeight: floor.sliceHeight,
      sliceOffset: floor.sliceOffset ?? state.settings.defaultSliceOffset,
      segments: crossSection.segments,
      walls: crossSection.segments,
      scanWalls: crossSection.segments,
      draftedWalls: [],
      rooms,
      bounds,
      warning,
      measurements: [],
      textNotes: [],
      symbols: [],
    };
  });

  state.activeFloorIndex = 0;
  state.exportPreviewIndex = 0;
  if (state.editor) {
    state.editor.setFloorData(state.floorPlans, { resetHistory: true, activeIndex: 0 });
  }
}

// ============================================================
// Step 3: Edit Floor Plan (Layers, Handles, Properties Bar & Calibration)
// ============================================================
let pendingCalibrationMeters = null;
let editingFloorIndex = 0;

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

  state.editor.onSelectionChanged = (summary) => {
    renderPropertiesBar(summary);
  };

  state.editor.onCalibrationMeasured = (measuredMeters) => {
    openCalibrateModal(measuredMeters);
  };

  return state.editor;
}

function updateLayerCounts() {
  const editor = state.editor;
  const scanCountEl = $('#layer-count-scan');
  const draftedCountEl = $('#layer-count-drafted');
  if (scanCountEl) scanCountEl.textContent = String(editor ? editor.scanWalls.length : 0);
  if (draftedCountEl) draftedCountEl.textContent = String(editor ? editor.draftedWalls.length : 0);

  if (editor) {
    $$('[data-layer-toggle]').forEach((cb) => {
      const key = cb.dataset.layerToggle;
      if (key in editor.layers) {
        cb.checked = editor.layers[key];
      }
    });
  }
}

function renderPropertiesBar(summary = null) {
  const bar = $('#editor-properties-bar');
  if (!bar) return;

  if (!summary) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = '';
  bar.hidden = false;
  const units = state.settings.units;

  if (summary.kind === 'wall') {
    const badge = document.createElement('span');
    badge.className = 'prop-badge';
    badge.textContent = summary.layer === 'scan' ? '3D Scan Wall' : 'Drafted Wall';

    const label = document.createElement('span');
    label.textContent = 'Length:';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input prop-input';
    input.value = formatDistance(summary.length, units);
    input.title = units === 'metric' ? 'Enter meters (e.g. 3.5 or 350 cm)' : "Enter feet/inches (e.g. 12' 6\" or 12.5)";

    const applyLen = () => {
      const meters = parseLengthInputMeters(input.value, units);
      if (meters && meters >= 0.05) {
        ensureEditor().setSelectedWallLength(meters);
      } else {
        showError('Invalid Length', 'Enter a positive length (e.g., 10\' 6", 12.5, or 3.2m).');
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyLen();
      }
    });

    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'btn btn-primary btn-xs';
    setBtn.textContent = 'Set';
    setBtn.addEventListener('click', applyLen);

    bar.append(badge, label, input, setBtn);

    if (summary.layer === 'scan') {
      const promoteBtn = document.createElement('button');
      promoteBtn.type = 'button';
      promoteBtn.className = 'btn btn-secondary btn-xs';
      promoteBtn.title = 'Move to Drafted layer so Slice Offset scrubbing preserves this wall';
      promoteBtn.textContent = 'Keep on Draft Layer';
      promoteBtn.addEventListener('click', () => ensureEditor().promoteSelectedScanWall());
      bar.appendChild(promoteBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-secondary btn-xs';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => ensureEditor().deleteSelectedItem());
    bar.appendChild(delBtn);
    return;
  }

  if (summary.kind === 'symbol') {
    const symKind = summary.symbolKind;
    const isDoor = symKind === 'door';
    const isStairs = symKind === 'stairs';
    const isArch = symKind === 'archway';
    const badge = document.createElement('span');
    badge.className = 'prop-badge';
    badge.textContent = isDoor ? 'Door' : isStairs ? 'Stairs' : isArch ? 'Archway' : 'Window';

    if (isStairs) {
      const presetsWrap = document.createElement('div');
      presetsWrap.className = 'prop-presets';
      const presets = units === 'imperial'
        ? [
            { label: "3'×8'", w: 0.9144, l: 2.4384 },
            { label: "3.5'×10'", w: 1.0668, l: 3.048 },
            { label: "4'×12'", w: 1.2192, l: 3.6576 },
          ]
        : [
            { label: '0.9×2.4m', w: 0.9, l: 2.4 },
            { label: '1.0×2.8m', w: 1.0, l: 2.8 },
            { label: '1.2×3.6m', w: 1.2, l: 3.6 },
          ];
      presets.forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary btn-xs';
        b.textContent = p.label;
        b.addEventListener('click', () => ensureEditor().updateSelectedSymbol({ width: p.w, length: p.l }));
        presetsWrap.appendChild(b);
      });

      const wLabel = document.createElement('span');
      wLabel.textContent = 'W:';
      const wInput = document.createElement('input');
      wInput.type = 'text';
      wInput.className = 'form-input prop-input';
      wInput.value = formatDistance(summary.width, units);

      const lLabel = document.createElement('span');
      lLabel.textContent = 'Run:';
      const lInput = document.createElement('input');
      lInput.type = 'text';
      lInput.className = 'form-input prop-input';
      lInput.value = formatDistance(summary.length || 2.8, units);

      const applyStairs = () => {
        const wM = parseLengthInputMeters(wInput.value, units);
        const lM = parseLengthInputMeters(lInput.value, units);
        if (wM && lM && wM >= 0.4 && wM <= 5.0 && lM >= 0.6 && lM <= 12.0) {
          ensureEditor().updateSelectedSymbol({ width: wM, length: lM });
        } else {
          showError('Invalid Stairs Size', 'Stair width must be 0.4–5.0 m and run 0.6–12.0 m.');
        }
      };

      const setBtn = document.createElement('button');
      setBtn.type = 'button';
      setBtn.className = 'btn btn-primary btn-xs';
      setBtn.textContent = 'Set';
      setBtn.addEventListener('click', applyStairs);

      const flipUpBtn = document.createElement('button');
      flipUpBtn.type = 'button';
      flipUpBtn.className = 'btn btn-secondary btn-xs';
      flipUpBtn.textContent = 'Flip UP';
      flipUpBtn.addEventListener('click', () => ensureEditor().flipSelectedStairsDirection());

      const rotBtn = document.createElement('button');
      rotBtn.type = 'button';
      rotBtn.className = 'btn btn-secondary btn-xs';
      rotBtn.textContent = 'Rotate 90° (Space)';
      rotBtn.addEventListener('click', () => ensureEditor().flipSelectedSymbol());

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-secondary btn-xs';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => ensureEditor().deleteSelectedItem());

      bar.append(badge, presetsWrap, wLabel, wInput, lLabel, lInput, setBtn, flipUpBtn, rotBtn, delBtn);
      return;
    }

    const presetsWrap = document.createElement('div');
    presetsWrap.className = 'prop-presets';
    const presets = units === 'imperial'
      ? (isDoor
          ? [{ label: '28"', m: 28 * 0.0254 }, { label: '32"', m: 32 * 0.0254 }, { label: '36"', m: 36 * 0.0254 }]
          : isArch
            ? [{ label: '36"', m: 36 * 0.0254 }, { label: '48"', m: 48 * 0.0254 }, { label: '72"', m: 72 * 0.0254 }]
            : [{ label: '36"', m: 36 * 0.0254 }, { label: '48"', m: 48 * 0.0254 }, { label: '60"', m: 60 * 0.0254 }])
      : (isDoor
          ? [{ label: '80cm', m: 0.8 }, { label: '90cm', m: 0.9 }, { label: '1.0m', m: 1.0 }]
          : isArch
            ? [{ label: '1.0m', m: 1.0 }, { label: '1.2m', m: 1.2 }, { label: '1.8m', m: 1.8 }]
            : [{ label: '1.0m', m: 1.0 }, { label: '1.2m', m: 1.2 }, { label: '1.5m', m: 1.5 }]);

    presets.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-secondary btn-xs';
      b.textContent = p.label;
      b.addEventListener('click', () => ensureEditor().updateSelectedSymbol({ width: p.m }));
      presetsWrap.appendChild(b);
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input prop-input';
    input.value = formatDistance(summary.width, units);

    const applyW = () => {
      const meters = parseLengthInputMeters(input.value, units);
      if (meters && meters >= 0.3 && meters <= 5.0) {
        ensureEditor().updateSelectedSymbol({ width: meters });
      } else {
        showError('Invalid Width', 'Opening width must be between 0.3 m (12") and 5.0 m (16 ft).');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyW();
      }
    });

    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'btn btn-primary btn-xs';
    setBtn.textContent = 'Set';
    setBtn.addEventListener('click', applyW);

    const flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.className = 'btn btn-secondary btn-xs';
    flipBtn.textContent = isDoor ? 'Flip Swing (Space)' : 'Rotate 90° (Space)';
    flipBtn.addEventListener('click', () => ensureEditor().flipSelectedSymbol());

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-secondary btn-xs';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => ensureEditor().deleteSelectedItem());

    bar.append(badge, presetsWrap, input, setBtn, flipBtn, delBtn);
    return;
  }

  if (summary.kind === 'multi') {
    const badge = document.createElement('span');
    badge.className = 'prop-badge';
    badge.textContent = `${summary.count} items selected`;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-primary btn-xs';
    delBtn.textContent = 'Delete Selected';
    delBtn.addEventListener('click', () => ensureEditor().deleteSelectedItem());
    bar.append(badge, delBtn);
    return;
  }

  const badge = document.createElement('span');
  badge.className = 'prop-badge';
  badge.textContent = summary.kind === 'text' ? `Note: "${summary.text}"` : `Dimension: ${summary.text}`;
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-secondary btn-xs';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', () => ensureEditor().deleteSelectedItem());
  bar.append(badge, delBtn);
}

function syncFloorPlanFromEditor(exportData) {
  const walls = exportData?.walls || [];
  const scanWalls = exportData?.scanWalls || [];
  const draftedWalls = exportData?.draftedWalls || [];
  const measurements = exportData?.measurements || [];
  const textNotes = exportData?.textNotes || [];
  const symbols = exportData?.symbols || [];
  const rooms = detectRooms(walls, state.settings.roomMergeTolerance);
  const labeledRooms = labelRooms(rooms, textNotes);

  if (state.floorPlans.length === 0) {
    state.floorPlans.push({
      name: 'Floor 1',
      floorHeight: 0,
      ceilingHeight: 3.0,
      sliceHeight: state.settings.defaultSliceOffset,
      sliceOffset: state.settings.defaultSliceOffset,
      segments: walls,
      walls,
      scanWalls,
      draftedWalls,
      measurements,
      textNotes,
      symbols,
      rooms: labeledRooms,
      bounds: exportData?.bounds || null,
    });
    state.activeFloorIndex = 0;
    if (state.editor) {
      state.editor.floors = state.floorPlans;
      state.editor.activeFloorIndex = 0;
    }
    renderFloorTabs();
  } else {
    const active = getActiveFloor();
    if (active) {
      active.segments = walls;
      active.walls = walls;
      active.scanWalls = scanWalls;
      active.draftedWalls = draftedWalls;
      active.measurements = measurements;
      active.textNotes = textNotes;
      active.symbols = symbols;
      active.rooms = labeledRooms;
      active.bounds = exportData?.bounds || active.bounds;
    }
  }

  state.editor?.setRooms(labeledRooms);
  updateLayerCounts();
  updateEditorEmptyOverlay(walls, measurements, textNotes, symbols);
  renderRoomsSchedule(labeledRooms, walls.length);
  if (state.currentStep === 4) {
    renderExportPreviewAndRooms();
  }
}

function openFloorEditModal(idx) {
  const floor = state.floorPlans[idx];
  if (!floor) return;
  editingFloorIndex = idx;

  const modal = $('#floor-edit-modal');
  const nameInput = $('#floor-edit-name');
  const ceilInput = $('#floor-edit-ceiling');
  const unitSpan = $('#floor-edit-ceiling-unit');

  const isMetric = state.settings.units === 'metric';
  const heightMeters = Math.abs((floor.ceilingHeight ?? (floor.floorHeight ?? 0) + 3.0) - (floor.floorHeight ?? 0));
  if (unitSpan) unitSpan.textContent = isMetric ? 'm' : 'ft';
  if (nameInput) nameInput.value = floor.name || `Floor ${idx + 1}`;
  if (ceilInput) ceilInput.value = isMetric ? heightMeters.toFixed(2) : (heightMeters * 3.28084).toFixed(2);

  modal.hidden = false;
  requestAnimationFrame(() => {
    nameInput?.focus();
    nameInput?.select();
  });
}

function saveFloorEditModal() {
  const floor = state.floorPlans[editingFloorIndex];
  if (!floor) return;
  const nameVal = ($('#floor-edit-name')?.value || '').trim();
  const rawCeil = parseFloat($('#floor-edit-ceiling')?.value || '');

  if (nameVal) {
    floor.name = nameVal;
  }
  if (rawCeil > 0) {
    const heightMeters = state.settings.units === 'metric' ? rawCeil : rawCeil * 0.3048;
    const sign = state.upAxis?.startsWith('-') ? -1 : 1;
    floor.ceilingHeight = (floor.floorHeight ?? 0) + sign * heightMeters;
  }

  $('#floor-edit-modal').hidden = true;
  renderFloorTabs();
  syncSliceSliderToActiveFloor();
  recordCurrentPlanInRecent();
  showSettingsToast($('#app-toast'), 'Floor updated', floor.name);
}

function renderFloorTabs() {
  const listEl = $('#floor-tabs-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const floors = state.floorPlans.length > 0 ? state.floorPlans : [{ name: 'Floor 1' }];

  floors.forEach((floor, idx) => {
    const tab = document.createElement('div');
    tab.className = `floor-tab${idx === state.activeFloorIndex ? ' active' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(idx === state.activeFloorIndex));
    tab.tabIndex = 0;

    const label = document.createElement('span');
    label.textContent = floor.name || `Floor ${idx + 1}`;
    tab.appendChild(label);

    tab.addEventListener('click', () => switchActiveFloor(idx));
    tab.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (state.floorPlans[idx]) openFloorEditModal(idx);
    });
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchActiveFloor(idx);
      }
    });

    if (state.floorPlans[idx]) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'floor-tab-edit';
      editBtn.title = 'Rename floor / set ceiling height';
      editBtn.setAttribute('aria-label', `Edit ${floor.name || `Floor ${idx + 1}`}`);
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openFloorEditModal(idx);
      });
      tab.appendChild(editBtn);
    }

    if (state.floorPlans.length > 1) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'floor-tab-delete';
      delBtn.title = `Remove ${floor.name || `Floor ${idx + 1}`}`;
      delBtn.setAttribute('aria-label', `Remove ${floor.name || `Floor ${idx + 1}`}`);
      delBtn.textContent = '×';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFloorAt(idx);
      });
      tab.appendChild(delBtn);
    }

    listEl.appendChild(tab);
  });
}

function switchActiveFloor(index) {
  if (index < 0 || index >= state.floorPlans.length) return;
  state.activeFloorIndex = index;
  ensureEditor().switchFloor(index);
  renderFloorTabs();
  syncSliceSliderToActiveFloor();
}

function addBlankFloor() {
  const nextNum = state.floorPlans.length + 1;
  const lastFloor = state.floorPlans[state.floorPlans.length - 1];
  const baseHeight = lastFloor ? (lastFloor.floorHeight ?? 0) + 3.0 : 0;
  const newFloor = {
    name: `Floor ${nextNum}`,
    floorHeight: baseHeight,
    ceilingHeight: baseHeight + 3.0,
    sliceHeight: baseHeight + state.settings.defaultSliceOffset,
    sliceOffset: state.settings.defaultSliceOffset,
    segments: [],
    walls: [],
    scanWalls: [],
    draftedWalls: [],
    measurements: [],
    textNotes: [],
    symbols: [],
    rooms: [],
    bounds: null,
    warning: null,
  };

  if (state.floorPlans.length === 0) {
    state.floorPlans.push(newFloor);
    ensureEditor().setFloorData(state.floorPlans, { resetHistory: true, activeIndex: 0 });
  } else {
    ensureEditor()._saveActiveFloorIntoArray?.();
    state.floorPlans.push(newFloor);
    state.activeFloorIndex = state.floorPlans.length - 1;
    ensureEditor().setFloorData(state.floorPlans, { resetHistory: false, activeIndex: state.activeFloorIndex });
  }

  renderFloorTabs();
  syncSliceSliderToActiveFloor();
  showSettingsToast($('#app-toast'), 'Floor added', `Switched to ${newFloor.name}`);
}

function removeFloorAt(index) {
  if (state.floorPlans.length <= 1) return;
  const editor = ensureEditor();
  editor._saveActiveFloorIntoArray?.();
  const removedName = state.floorPlans[index]?.name || `Floor ${index + 1}`;
  state.floorPlans.splice(index, 1);
  if (editor.floorHistories) {
    editor.floorHistories.splice(index, 1);
  }
  state.activeFloorIndex = Math.max(0, Math.min(state.activeFloorIndex, state.floorPlans.length - 1));
  editor.setFloorData(state.floorPlans, { resetHistory: false, activeIndex: state.activeFloorIndex });
  renderFloorTabs();
  syncSliceSliderToActiveFloor();
  showSettingsToast($('#app-toast'), 'Floor removed', removedName);
}

function updateEditorEmptyOverlay(walls, measurements, textNotes, symbols = []) {
  const emptyOverlay = $('#editor-empty-state');
  if (!emptyOverlay) return;

  const isEmpty = walls.length === 0 && measurements.length === 0 && textNotes.length === 0 && symbols.length === 0;
  emptyOverlay.hidden = !isEmpty;

  if (!isEmpty) return;

  const hasModel = Boolean(state.modelData && getActiveFloor());
  renderEmptyState(emptyOverlay, {
    title: hasModel ? 'No Walls Found at This Slice Offset' : 'Floor Plan Canvas Is Empty',
    description: hasModel
      ? 'Adjust the Slice Offset slider above, reset to the default slice height, or insert a starter room template to draw from scratch.'
      : 'Draw walls with the Draw tool (D), load a 3D sample scan, or drop in a ready-made 4m × 3m room template.',
    actionLabel: hasModel ? 'Reset Slice Offset' : 'Load Sample Room',
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
      description: 'Closed wall loops are automatically measured here as named rooms for PDF, PNG, SVG, DXF, and JSON export.',
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

function syncSliceSliderToActiveFloor() {
  const slider = $('#slice-height-slider');
  const sliderValue = $('#slice-height-value');
  const floor = getActiveFloor();
  const hasModel = Boolean(state.modelData && floor);
  slider.disabled = !hasModel;

  if (floor) {
    const offset = typeof floor.sliceOffset === 'number'
      ? floor.sliceOffset
      : state.settings.defaultSliceOffset;
    const storyHeight = Math.abs((floor.ceilingHeight ?? (floor.floorHeight ?? 0) + 3.0) - (floor.floorHeight ?? 0));
    const maxOffsetCm = Math.max(300, Math.round(Math.max(2.5, storyHeight - 0.05) * 100));
    slider.min = '10';
    slider.max = String(maxOffsetCm);
    slider.value = String(Math.min(maxOffsetCm, Math.max(10, Math.round(offset * 100))));
    sliderValue.textContent = formatDistance(offset, state.settings.units);
  } else {
    sliderValue.textContent = formatDistance(0, state.settings.units);
  }
}

function resetSliceHeightToDefault() {
  const floor = getActiveFloor();
  if (!state.modelData || !floor) return;
  const offset = state.settings.defaultSliceOffset;
  const slider = $('#slice-height-slider');
  slider.value = String(Math.round(offset * 100));
  applySliceOffset(offset, { pushUndo: true });
}

let sliceRequestSeq = 0;
let deferredSliceUndo = false;

async function applySliceOffset(offset, { pushUndo = true } = {}) {
  const reqSeq = ++sliceRequestSeq;
  if (pushUndo) deferredSliceUndo = true;
  const { extractCrossSection } = await loadCrossSectionModule();
  if (reqSeq !== sliceRequestSeq) return;

  const effectivePushUndo = deferredSliceUndo;
  deferredSliceUndo = false;

  const floor = getActiveFloor();
  if (!state.modelData || !floor) return;

  const sign = state.upAxis?.startsWith('-') ? -1 : 1;
  const worldSliceHeight = (floor.floorHeight ?? 0) + sign * offset;
  $('#slice-height-value').textContent = formatDistance(offset, state.settings.units);

  const crossSection = extractCrossSection(
    state.modelData.meshes,
    worldSliceHeight,
    state.upAxis,
    { simplifyEpsilon: state.settings.wallSimplification || 0 }
  );

  floor.sliceOffset = offset;
  floor.sliceHeight = worldSliceHeight;
  floor.scanWalls = crossSection.segments;
  floor.bounds = crossSection.bounds;

  ensureEditor().replaceScanWalls(crossSection.segments, { pushUndo: effectivePushUndo });
}

function openCalibrateModal(measuredMeters) {
  pendingCalibrationMeters = measuredMeters;
  const modal = $('#calibrate-modal');
  const measuredEl = $('#calibrate-measured-val');
  const inputEl = $('#calibrate-actual-input');
  const unitSelect = $('#calibrate-unit-select');
  const scopeField = $('#calibrate-scope-field');

  if (measuredEl) {
    measuredEl.textContent = formatDistance(measuredMeters, state.settings.units);
  }
  if (unitSelect) {
    unitSelect.value = state.settings.units === 'metric' ? 'm' : 'ft';
  }
  if (scopeField) {
    scopeField.hidden = state.floorPlans.length <= 1;
  }
  if (inputEl) {
    const suggested = state.settings.units === 'metric'
      ? measuredMeters.toFixed(2)
      : (measuredMeters * 3.28084).toFixed(2);
    inputEl.value = suggested;
  }

  modal.hidden = false;
  requestAnimationFrame(() => {
    inputEl?.focus();
    inputEl?.select();
  });
}

function applyCalibrationFromModal() {
  const inputEl = $('#calibrate-actual-input');
  const unitSelect = $('#calibrate-unit-select');
  const scopeSelect = $('#calibrate-scope-select');
  const rawVal = parseFloat(inputEl?.value || '');
  if (!(rawVal > 0) || !(pendingCalibrationMeters > 0)) {
    showError('Invalid Length', 'Enter a positive real-world length to calibrate the plan scale.');
    return;
  }

  const unit = unitSelect?.value || 'm';
  const actualMeters = unit === 'ft'
    ? rawVal * 0.3048
    : unit === 'in'
      ? rawVal * 0.0254
      : unit === 'cm'
        ? rawVal * 0.01
        : rawVal;

  const factor = actualMeters / pendingCalibrationMeters;
  const applyAll = state.floorPlans.length > 1 && scopeSelect?.value === 'all';

  ensureEditor().scalePlan(factor);

  if (applyAll) {
    state.floorPlans.forEach((f, idx) => {
      if (idx === state.activeFloorIndex || !f.bounds) return;
      const cx = (f.bounds.minX + f.bounds.maxX) * 0.5;
      const cy = (f.bounds.minY + f.bounds.maxY) * 0.5;
      const center = [cx, cy];
      const scaleArr = (arr) => (arr || []).map(([a, b]) => [
        scalePoint(a, center, factor),
        scalePoint(b, center, factor),
      ]);
      f.scanWalls = scaleArr(f.scanWalls);
      f.draftedWalls = scaleArr(f.draftedWalls);
      f.walls = [...f.scanWalls, ...f.draftedWalls];
      f.segments = f.walls;
      f.measurements = (f.measurements || []).map((m) => {
        const p1 = scalePoint(m.p1, center, factor);
        const p2 = scalePoint(m.p2, center, factor);
        return { ...m, p1, p2, text: formatDistance(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), state.settings.units) };
      });
      f.textNotes = (f.textNotes || []).map((n) => ({ ...n, pos: scalePoint(n.pos, center, factor) }));
      f.symbols = (f.symbols || []).map((s) => {
        const defaultW = s.kind === 'door' ? 0.9 : s.kind === 'stairs' ? 1.0 : 1.2;
        const scaled = {
          ...s,
          pos: scalePoint(s.pos, center, factor),
          width: (s.width || defaultW) * factor,
        };
        if (s.kind === 'stairs') scaled.length = (s.length || 2.8) * factor;
        return scaled;
      });
      f.rooms = labelRooms(detectRooms(f.walls, state.settings.roomMergeTolerance), f.textNotes);
    });
  }

  $('#calibrate-modal').hidden = true;
  pendingCalibrationMeters = null;
  recordCurrentPlanInRecent();
  selectTool('select');
  showSettingsToast(
    $('#app-toast'),
    'Scale calibrated',
    `Scaled by ${(factor * 100).toFixed(1)}% (${formatDistance(actualMeters, state.settings.units)})`
  );
}

function handleAutoStraighten() {
  const angle = ensureEditor().autoStraighten();
  if (Math.abs(angle) < 1e-4) {
    showSettingsToast($('#app-toast'), 'Already aligned', 'Walls are already aligned to horizontal/vertical axes.');
  } else {
    const deg = ((angle * 180) / Math.PI).toFixed(1);
    showSettingsToast($('#app-toast'), 'Walls straightened', `Rotated ${deg}° to align with grid axes.`);
    recordCurrentPlanInRecent();
  }
}

function handleRotate90() {
  if (ensureEditor().rotatePlan(Math.PI / 2)) {
    showSettingsToast($('#app-toast'), 'Plan rotated', 'Rotated 90° clockwise.');
    recordCurrentPlanInRecent();
  }
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

  $('#btn-auto-straighten')?.addEventListener('click', handleAutoStraighten);
  $('#btn-rotate-90')?.addEventListener('click', handleRotate90);

  $('#btn-insert-room').addEventListener('click', () => {
    ensureEditor().insertRoomTemplate(4, 3);
    recordCurrentPlanInRecent();
  });

  $('#btn-clear-canvas')?.addEventListener('click', () => {
    ensureEditor().clearPlan();
    showSettingsToast($('#app-toast'), 'Canvas cleared', 'Press Ctrl+Z to undo.');
  });

  $('#btn-add-floor')?.addEventListener('click', addBlankFloor);

  // Layers popover
  const layersBtn = $('#btn-layers');
  const layersPopover = $('#layers-popover');
  layersBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !layersPopover.hidden;
    layersPopover.hidden = isOpen;
    layersBtn.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen) updateLayerCounts();
  });
  document.addEventListener('click', (e) => {
    if (layersPopover && !layersPopover.hidden && !e.target.closest?.('.layers-menu-wrap')) {
      layersPopover.hidden = true;
      layersBtn?.setAttribute('aria-expanded', 'false');
    }
  });
  $$('[data-layer-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => {
      ensureEditor().setLayerVisibility(cb.dataset.layerToggle, cb.checked);
    });
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
  let pendingSliceUndo = true;
  let rafSliceId = null;
  let latestOffset = null;

  slider.addEventListener('input', () => {
    const offset = parseInt(slider.value, 10) / 100;
    latestOffset = offset;
    sliderValue.textContent = formatDistance(offset, state.settings.units);

    if (!rafSliceId) {
      rafSliceId = requestAnimationFrame(() => {
        rafSliceId = null;
        if (latestOffset !== null) {
          const shouldPush = pendingSliceUndo;
          pendingSliceUndo = false;
          applySliceOffset(latestOffset, { pushUndo: shouldPush }).catch(() => {});
        }
      });
    }
  });

  slider.addEventListener('change', async () => {
    if (rafSliceId) {
      cancelAnimationFrame(rafSliceId);
      rafSliceId = null;
    }
    const offset = parseInt(slider.value, 10) / 100;
    const shouldPush = pendingSliceUndo;
    pendingSliceUndo = true;
    latestOffset = null;
    await applySliceOffset(offset, { pushUndo: shouldPush });
    recordCurrentPlanInRecent();
  });

  // Floor Edit Modal
  $('#btn-close-floor-edit')?.addEventListener('click', () => { $('#floor-edit-modal').hidden = true; });
  $('#btn-cancel-floor-edit')?.addEventListener('click', () => { $('#floor-edit-modal').hidden = true; });
  $('#btn-save-floor-edit')?.addEventListener('click', saveFloorEditModal);
  $('#floor-edit-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveFloorEditModal(); }
  });
  $('#floor-edit-ceiling')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveFloorEditModal(); }
  });
  $('#floor-edit-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#floor-edit-modal')) $('#floor-edit-modal').hidden = true;
  });

  // Calibration modal
  $('#btn-close-calibrate')?.addEventListener('click', () => { $('#calibrate-modal').hidden = true; });
  $('#btn-cancel-calibrate')?.addEventListener('click', () => { $('#calibrate-modal').hidden = true; });
  $('#btn-apply-calibrate')?.addEventListener('click', applyCalibrationFromModal);
  $('#calibrate-actual-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCalibrationFromModal();
    }
  });
  $('#calibrate-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#calibrate-modal')) $('#calibrate-modal').hidden = true;
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

  const active = getActiveFloor();
  if (active?.warning) {
    showError('Warning', active.warning);
    active.warning = null;
  }

  editor.setFloorData(state.floorPlans, { resetHistory: false, activeIndex: state.activeFloorIndex });
  renderFloorTabs();
  updateLayerCounts();
  syncSliceSliderToActiveFloor();
}

function selectTool(tool) {
  $$('.btn-tool[data-tool]').forEach((b) => b.classList.remove('active'));
  $(`.btn-tool[data-tool="${tool}"]`)?.classList.add('active');
  ensureEditor().setTool(tool);
}

// ============================================================
// Step 4: Export PDF / PNG / SVG / DXF / JSON & Multi-Page Blueprint Preview
// ============================================================
function syncExportMetaInputs() {
  const m = state.exportMeta;
  if ($('#paper-orientation')) $('#paper-orientation').value = m.orientation || 'landscape';
  if ($('#export-show-north')) $('#export-show-north').checked = Boolean(m.showNorth);
  if ($('#export-north-angle')) $('#export-north-angle').value = String(m.northAngle || 0);
  if ($('#export-room-schedule')) $('#export-room-schedule').checked = Boolean(m.includeRoomSchedule);
  if ($('#meta-client')) $('#meta-client').value = m.client || '';
  if ($('#meta-address')) $('#meta-address').value = m.address || '';
  if ($('#meta-author')) $('#meta-author').value = m.author || '';
  if ($('#meta-sheet')) $('#meta-sheet').value = m.sheetNumber || '';
}

function getExportFloorsSnapshot() {
  if (state.editor && state.floorPlans.length > 0) {
    state.editor._saveActiveFloorIntoArray?.();
  }

  if (state.floorPlans.length === 0) return [];

  return state.floorPlans.map((floor, idx) => {
    const walls = floor.walls || floor.segments || [];
    const textNotes = floor.textNotes || [];
    const rooms = labelRooms(detectRooms(walls, state.settings.roomMergeTolerance), textNotes);
    return {
      name: floor.name || `Floor ${idx + 1}`,
      floorHeight: floor.floorHeight ?? null,
      ceilingHeight: floor.ceilingHeight ?? null,
      sliceHeight: floor.sliceHeight ?? null,
      walls,
      segments: walls,
      scanWalls: floor.scanWalls,
      draftedWalls: floor.draftedWalls,
      measurements: floor.measurements || [],
      textNotes,
      symbols: floor.symbols || [],
      rooms,
      bounds: floor.bounds || null,
    };
  });
}

function renderExportPreviewAndRooms() {
  const previewEl = $('#export-preview');
  const metaEl = $('#export-preview-meta');
  const roomsSummaryEl = $('#export-rooms-summary');
  const pageNavEl = $('#export-page-nav');
  const pageLabelEl = $('#export-page-label');

  const projectName = ($('#project-name')?.value || '').trim() || 'Floor Plan';
  const paperSize = $('#paper-size')?.value || state.settings.defaultPaperSize;
  const orientation = state.exportMeta.orientation || 'landscape';
  const scaleVal = $('#export-scale')?.value || state.settings.defaultScale;

  const floors = getExportFloorsSnapshot();
  const totalPages = Math.max(1, floors.length);
  state.exportPreviewIndex = Math.max(0, Math.min(state.exportPreviewIndex, totalPages - 1));
  const floor = floors[state.exportPreviewIndex] || null;

  if (pageNavEl) {
    pageNavEl.hidden = floors.length <= 1;
  }
  if (pageLabelEl && floor) {
    pageLabelEl.textContent = `${floor.name} (${state.exportPreviewIndex + 1}/${totalPages})`;
  }
  if (metaEl) {
    const scaleLabel = scaleVal === 'auto' ? 'Auto-fit' : scaleVal === '24' ? '1/2"=1\'' : scaleVal === '48' ? '1/4"=1\'' : scaleVal === '96' ? '1/8"=1\'' : `1:${scaleVal}`;
    metaEl.textContent = `${paperSize.toUpperCase()} ${orientation === 'portrait' ? 'Portrait' : 'Landscape'} · ${scaleLabel}`;
  }

  renderBlueprintPreview(previewEl, {
    floor,
    projectName,
    paperSize,
    orientation,
    scale: scaleVal,
    units: state.settings.units,
    showRooms: state.exportShowRooms,
    showNorth: state.exportMeta.showNorth,
    northAngle: state.exportMeta.northAngle,
    includeRoomSchedule: state.exportMeta.includeRoomSchedule,
    metadata: state.exportMeta,
    pageIndex: state.exportPreviewIndex,
    totalPages,
    onLoadSample: () => loadSampleScan('samples/sample_house.glb'),
    onGoToEditor: () => goToStep(3),
  });

  if (!roomsSummaryEl) return;

  const walls = floor?.walls || [];
  const rawRooms = floor?.rooms || [];

  if (rawRooms.length === 0) {
    renderEmptyState(roomsSummaryEl, {
      compact: true,
      title: 'No Closed Rooms in Export',
      description: walls.length > 0
        ? 'Wall geometry is ready for PDF/PNG/SVG/DXF export, though no closed loops formed rooms for the JSON room schedule.'
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
    const name = room.displayName || `${room.name} ${i + 1}`;
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

async function handleSaveSVG() {
  const floors = getExportFloorsSnapshot();
  const floor = floors[state.exportPreviewIndex];
  if (!floor || (floor.walls.length === 0 && floor.measurements.length === 0)) {
    showError('Nothing to Export', 'Load a 3D scan or draw walls before exporting SVG.');
    return;
  }
  const projectName = ($('#project-name')?.value || '').trim() || 'Floor Plan';
  const safeBase = projectName.replace(/[^a-zA-Z0-9]/g, '_');
  const floorSuffix = floors.length > 1 ? `_${floor.name.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  const svgStr = buildSVG({
    projectName,
    floor,
    units: state.settings.units,
    showRooms: state.exportShowRooms,
    showNorth: state.exportMeta.showNorth,
    northAngle: state.exportMeta.northAngle,
  });
  const result = await saveTextFile(svgStr, `${safeBase}${floorSuffix}.svg`, 'image/svg+xml', 'SVG Vector Drawing', '.svg');
  if (result.success) {
    showSuccess('SVG Saved', 'Layered architectural SVG has been saved.');
  }
}

async function handleSavePNG() {
  const previewSvg = $('#export-preview')?.querySelector('svg');
  if (!previewSvg) {
    showError('Nothing to Export', 'Load a 3D scan or draw walls before exporting a PNG image.');
    return;
  }
  const floors = getExportFloorsSnapshot();
  const floor = floors[state.exportPreviewIndex];
  const projectName = ($('#project-name')?.value || '').trim() || 'Floor Plan';
  const safeBase = projectName.replace(/[^a-zA-Z0-9]/g, '_');
  const floorSuffix = floors.length > 1 && floor ? `_${floor.name.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  try {
    const result = await exportSVGElementToPNG(previewSvg, `${safeBase}${floorSuffix}_blueprint.png`);
    if (result.success) {
      showSuccess('PNG Saved', 'High-resolution blueprint PNG image has been saved.');
    }
  } catch (err) {
    console.error('PNG export failed:', err);
    showError('Export Failed', `Could not export PNG: ${err.message}`);
  }
}

async function handleSaveDXF() {
  const floors = getExportFloorsSnapshot();
  const floor = floors[state.exportPreviewIndex];
  if (!floor || (floor.walls.length === 0 && floor.measurements.length === 0)) {
    showError('Nothing to Export', 'Load a 3D scan or draw walls before exporting DXF.');
    return;
  }
  const projectName = ($('#project-name')?.value || '').trim() || 'Floor Plan';
  const safeBase = projectName.replace(/[^a-zA-Z0-9]/g, '_');
  const floorSuffix = floors.length > 1 ? `_${floor.name.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
  const dxfStr = buildDXF({
    floor,
    units: state.settings.units,
  });
  const result = await saveTextFile(dxfStr, `${safeBase}${floorSuffix}.dxf`, 'application/dxf', 'AutoCAD DXF Drawing', '.dxf');
  if (result.success) {
    showSuccess('DXF Saved', `AutoCAD R12 DXF saved (${state.settings.units === 'metric' ? 'Meters' : 'Feet'}).`);
  }
}

function bindExportStepEvents() {
  const nameInput = $('#project-name');
  const paperSelect = $('#paper-size');
  const orientationSelect = $('#paper-orientation');
  const scaleSelect = $('#export-scale');
  const showRoomsCheckbox = $('#export-show-rooms');
  const scheduleCheckbox = $('#export-room-schedule');
  const northCheckbox = $('#export-show-north');
  const northAngleInput = $('#export-north-angle');

  nameInput.addEventListener('input', renderExportPreviewAndRooms);
  paperSelect.addEventListener('change', renderExportPreviewAndRooms);
  scaleSelect.addEventListener('change', renderExportPreviewAndRooms);
  orientationSelect?.addEventListener('change', () => {
    state.exportMeta.orientation = orientationSelect.value === 'portrait' ? 'portrait' : 'landscape';
    renderExportPreviewAndRooms();
  });
  showRoomsCheckbox?.addEventListener('change', () => {
    state.exportShowRooms = Boolean(showRoomsCheckbox.checked);
    renderExportPreviewAndRooms();
  });
  scheduleCheckbox?.addEventListener('change', () => {
    state.exportMeta.includeRoomSchedule = Boolean(scheduleCheckbox.checked);
    renderExportPreviewAndRooms();
  });
  northCheckbox?.addEventListener('change', () => {
    state.exportMeta.showNorth = Boolean(northCheckbox.checked);
    renderExportPreviewAndRooms();
  });
  northAngleInput?.addEventListener('input', () => {
    state.exportMeta.northAngle = Number(northAngleInput.value) || 0;
    renderExportPreviewAndRooms();
  });

  [
    ['#meta-client', 'client'],
    ['#meta-address', 'address'],
    ['#meta-author', 'author'],
    ['#meta-sheet', 'sheetNumber'],
  ].forEach(([sel, key]) => {
    $(sel)?.addEventListener('input', (e) => {
      state.exportMeta[key] = e.target.value;
      renderExportPreviewAndRooms();
    });
  });

  $('#export-page-prev')?.addEventListener('click', () => {
    if (state.exportPreviewIndex > 0) {
      state.exportPreviewIndex--;
      renderExportPreviewAndRooms();
    }
  });
  $('#export-page-next')?.addEventListener('click', () => {
    const count = state.floorPlans.length;
    if (state.exportPreviewIndex < count - 1) {
      state.exportPreviewIndex++;
      renderExportPreviewAndRooms();
    }
  });

  $('#btn-back-to-edit').addEventListener('click', () => goToStep(3));

  $('#btn-save-plan-data').addEventListener('click', async () => {
    const floors = getExportFloorsSnapshot();
    const hasGeometry = floors.some((f) => f.walls.length > 0 || f.measurements.length > 0);
    if (!hasGeometry) {
      showError('Nothing to Export', 'Load a 3D scan or draw walls in the editor before saving plan data.');
      return;
    }

    const projectName = nameInput.value.trim() || 'Floor Plan';
    try {
      const data = buildPlanData({
        projectName,
        floors,
        metadata: state.exportMeta,
        tolerance: state.settings.roomMergeTolerance,
      });
      const roomCount = data.floors.reduce((s, f) => s + f.rooms.length, 0);
      const result = await savePlanData(data, `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_plan.json`);
      if (result.success) {
        recordCurrentPlanInRecent();
        const roomsMsg = roomCount
          ? `${roomCount} room${roomCount === 1 ? '' : 's'} across ${data.floors.length} floor${data.floors.length === 1 ? '' : 's'} saved.`
          : 'Walls saved. No closed rooms were found, so the walls will show as a guide to draw rooms over.';
        showSuccess('Plan Data Saved', `${roomsMsg} Re-import this JSON file anytime in Step 1 or in PaintingBusinessManager.`);
      }
    } catch (err) {
      console.error('Plan data export failed:', err);
      showError('Export Failed', `Could not save plan data: ${err.message}`);
    }
  });

  $('#btn-save-svg')?.addEventListener('click', handleSaveSVG);
  $('#btn-save-png')?.addEventListener('click', handleSavePNG);
  $('#btn-save-dxf')?.addEventListener('click', handleSaveDXF);

  $('#btn-save-pdf').addEventListener('click', async () => {
    const floors = getExportFloorsSnapshot().filter(
      (f) => f.bounds && (f.walls.length > 0 || f.measurements.length > 0)
    );
    if (floors.length === 0) {
      showError('Nothing to Export', 'Load a 3D scan or draw walls in the editor before exporting a PDF.');
      return;
    }

    const projectName = nameInput.value.trim() || 'Floor Plan';
    const paperSize = paperSelect.value;
    const scaleVal = scaleSelect.value;
    const scale = scaleVal === 'auto' ? 'auto' : parseInt(scaleVal, 10);

    try {
      const { exportPDF, savePDF } = await loadPdfExporterModule();
      const safeName = `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_floorplan.pdf`;
      const { doc } = exportPDF({
        projectName,
        paperSize,
        orientation: state.exportMeta.orientation,
        scale,
        units: state.settings.units,
        showRooms: state.exportShowRooms,
        showNorth: state.exportMeta.showNorth,
        northAngle: state.exportMeta.northAngle,
        includeRoomSchedule: state.exportMeta.includeRoomSchedule,
        metadata: state.exportMeta,
        floors,
        fileName: safeName,
      });

      const result = await savePDF(doc, safeName);
      if (result.success) {
        recordCurrentPlanInRecent();
        showSuccess(
          'PDF Saved',
          result.method === 'filesystem'
            ? `Floor plan PDF (${floors.length} ${floors.length === 1 ? 'page' : 'pages'}) has been saved to your chosen location.`
            : `Floor plan PDF (${floors.length} ${floors.length === 1 ? 'page' : 'pages'}) has been downloaded.`
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
    nameInput.value = state.file.name.replace(/\.(glb|gltf|obj|stl|ply|json)$/i, '');
  }
  const showRoomsCheckbox = $('#export-show-rooms');
  if (showRoomsCheckbox) {
    showRoomsCheckbox.checked = state.exportShowRooms;
  }
  syncExportMetaInputs();
  state.exportPreviewIndex = Math.max(0, Math.min(state.activeFloorIndex, Math.max(0, state.floorPlans.length - 1)));
  renderExportPreviewAndRooms();
}

// ============================================================
// Global Header Stepper, Command Palette, Shortcuts & Settings
// ============================================================
function applySettingsToApp(nextSettings, changes = []) {
  state.settings = nextSettings;

  const changedKeys = new Set(changes.map((c) => c.key));
  if (changedKeys.has('defaultPaperSize')) {
    $('#paper-size').value = nextSettings.defaultPaperSize;
  }
  if (changedKeys.has('defaultScale')) {
    $('#export-scale').value = nextSettings.defaultScale;
  }
  if (changedKeys.has('showRooms')) {
    state.exportShowRooms = nextSettings.showRooms;
    const cb = $('#export-show-rooms');
    if (cb) cb.checked = nextSettings.showRooms;
  }

  if (state.editor) {
    state.editor.setSettings(nextSettings);
    updateLayerCounts();
  }
  if (state.modelData) {
    updateOrientStatsDisplay();
  }

  if (changedKeys.has('wallSimplification') && state.modelData && getActiveFloor()) {
    const active = getActiveFloor();
    applySliceOffset(active.sliceOffset ?? nextSettings.defaultSliceOffset, { pushUndo: true });
  }

  if (state.floorPlans.length > 0) {
    const active = getActiveFloor();
    if (active) {
      const rooms = labelRooms(
        detectRooms(active.walls || [], nextSettings.roomMergeTolerance),
        active.textNotes || []
      );
      active.rooms = rooms;
      state.editor?.setRooms(rooms);
      renderRoomsSchedule(rooms, (active.walls || []).length);
      const sliderValue = $('#slice-height-value');
      if (sliderValue && typeof active.sliceOffset === 'number') {
        sliderValue.textContent = formatDistance(active.sliceOffset, nextSettings.units);
      }
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
      title: 'Step 1: Load 3D Scan or JSON Plan',
      subtitle: 'Upload a .glb / .json file or resume a recent scan',
      shortcut: '1',
      keywords: 'upload glb json import home start',
      run: () => goToStep(1),
    },
    {
      group: 'Pages',
      title: 'Step 2: Confirm Orientation',
      subtitle: 'Verify the upward axis and detected floor planes in 3D',
      shortcut: '2',
      keywords: '3d axis orient rotate up floors',
      run: () => goToStep(2),
    },
    {
      group: 'Pages',
      title: 'Step 3: Edit Floor Plan',
      subtitle: 'Draw walls, doors, windows, calibrate scale, and label rooms',
      shortcut: '3',
      keywords: '2d canvas editor svg slice',
      run: () => goToStep(3),
    },
    {
      group: 'Pages',
      title: 'Step 4: Export Blueprint',
      subtitle: 'Preview sheets and export PDF, PNG, SVG, DXF, or JSON',
      shortcut: '4',
      keywords: 'pdf png svg dxf json blueprint save download',
      run: () => goToStep(4),
    },
  ];

  const actions = [
    {
      group: 'Actions',
      title: 'Open 3D Scan or JSON Plan...',
      subtitle: 'Open local file picker for .glb, .gltf, .obj, .stl, .ply, or .json',
      shortcut: 'O',
      keywords: 'browse open load file import json glb gltf obj stl ply',
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
      subtitle: 'Configure units, snapping, wall simplification, and defaults',
      shortcut: ',',
      keywords: 'preferences units metric imperial config simplify',
      run: () => settingsCtrl?.open(),
    },
    {
      group: 'Actions',
      title: 'Help & Quick User Guide',
      subtitle: 'Open built-in workflow guide and shortcuts reference',
      shortcut: '?',
      keywords: 'help documentation guide hotkeys keys overlay',
      run: () => shortcutsCtrl?.open('guide'),
    },
    {
      group: 'Actions',
      title: 'Tool: Select / Wall Handles / Marquee',
      subtitle: 'Select items, drag wall endpoints, or box-select',
      shortcut: 'V',
      keywords: 'pointer cursor marquee handles editor',
      run: () => { goToStep(3); selectTool('select'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Pan Canvas',
      subtitle: 'Move around the 2D blueprint canvas (or hold Space+Drag)',
      shortcut: 'H',
      keywords: 'hand drag move editor',
      run: () => { goToStep(3); selectTool('pan'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Draw Wall Chain',
      subtitle: 'Draw continuous snapped wall polylines with endpoint snap',
      shortcut: 'D',
      keywords: 'wall line polyline sketch editor snap',
      run: () => { goToStep(3); selectTool('draw'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Place Door Symbol',
      subtitle: 'Snap an architectural door with swing arc onto a wall',
      shortcut: 'Shift+D',
      keywords: 'door swing symbol architectural editor',
      run: () => { goToStep(3); selectTool('door'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Place Window Symbol',
      subtitle: 'Snap a glazed window opening onto a wall',
      shortcut: 'W',
      keywords: 'window glass symbol architectural editor',
      run: () => { goToStep(3); selectTool('window'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Place Archway / Opening',
      subtitle: 'Snap an open cased archway or wall pass-through onto a wall',
      shortcut: 'A',
      keywords: 'archway opening passage wall symbol editor',
      run: () => { goToStep(3); selectTool('archway'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Place Stairs',
      subtitle: 'Place a staircase flight with treads and UP direction arrow',
      shortcut: 'S',
      keywords: 'stairs staircase steps up flight symbol editor',
      run: () => { goToStep(3); selectTool('stairs'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Measure Distance',
      subtitle: 'Add snapped dimension annotations',
      shortcut: 'M',
      keywords: 'ruler dimension length editor',
      run: () => { goToStep(3); selectTool('measure'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Calibrate Scale',
      subtitle: 'Measure a known span to rescale the floor plan accurately',
      shortcut: 'C',
      keywords: 'calibrate scale resize units',
      run: () => { goToStep(3); selectTool('calibrate'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Add Text Note',
      subtitle: 'Place room labels or architectural notes',
      shortcut: 'T',
      keywords: 'label room name text editor',
      run: () => { goToStep(3); selectTool('text'); },
    },
    {
      group: 'Actions',
      title: 'Tool: Erase / Marquee Erase',
      subtitle: 'Click items or drag a box to erase walls and annotations',
      shortcut: 'E',
      keywords: 'delete remove marquee brush editor',
      run: () => { goToStep(3); selectTool('erase'); },
    },
    {
      group: 'Actions',
      title: 'Toggle 3D Scan Wall Layer',
      subtitle: 'Show or hide auto-sliced 3D scan walls independently from drafted walls',
      keywords: 'layer scan toggle hide show drafted',
      run: () => {
        goToStep(3);
        const ed = ensureEditor();
        ed.setLayerVisibility('scan', !ed.layers.scan);
        updateLayerCounts();
      },
    },
    {
      group: 'Actions',
      title: 'Auto-Straighten Walls',
      subtitle: 'Align rotated scan walls to horizontal and vertical axes',
      shortcut: 'Shift+R',
      keywords: 'rotate align straighten manhattan',
      run: () => { goToStep(3); handleAutoStraighten(); },
    },
    {
      group: 'Actions',
      title: 'Rotate Plan 90° Clockwise',
      subtitle: 'Rotate the active floor plan by 90 degrees',
      shortcut: 'R',
      keywords: 'rotate turn 90 degrees',
      run: () => { goToStep(3); handleRotate90(); },
    },
    {
      group: 'Actions',
      title: 'Flip Plan Horizontally',
      subtitle: 'Mirror the active floor plan left-to-right',
      keywords: 'mirror flip horizontal',
      run: () => { goToStep(3); ensureEditor().flipPlan('x'); },
    },
    {
      group: 'Actions',
      title: 'Flip Plan Vertically',
      subtitle: 'Mirror the active floor plan top-to-bottom',
      keywords: 'mirror flip vertical',
      run: () => { goToStep(3); ensureEditor().flipPlan('y'); },
    },
    {
      group: 'Actions',
      title: 'Add New Floor Level',
      subtitle: 'Append a new floor tab for multi-story editing',
      keywords: 'floor story level multi',
      run: () => { goToStep(3); addBlankFloor(); },
    },
    {
      group: 'Actions',
      title: 'Clear Active Floor Canvas',
      subtitle: 'Clear all walls, symbols, and notes on the current floor (undoable)',
      keywords: 'clear reset empty delete canvas',
      run: () => {
        goToStep(3);
        ensureEditor().clearPlan();
        showSettingsToast($('#app-toast'), 'Canvas cleared', 'Press Ctrl+Z to undo.');
      },
    },
    {
      group: 'Actions',
      title: 'Fit Floor Plan to View',
      subtitle: 'Center and zoom the 2D plan cleanly',
      shortcut: 'F',
      keywords: 'zoom reset center view',
      run: () => { goToStep(3); ensureEditor().fitToView(); },
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
      title: 'Export High-DPI PNG Blueprint',
      subtitle: 'Save the previewed blueprint sheet as a crisp PNG image',
      keywords: 'export png image screenshot quote',
      run: () => { goToStep(4); handleSavePNG(); },
    },
    {
      group: 'Actions',
      title: 'Export Vector SVG',
      subtitle: 'Save layered architectural SVG of the previewed floor',
      keywords: 'export svg vector illustrator',
      run: () => { goToStep(4); handleSaveSVG(); },
    },
    {
      group: 'Actions',
      title: 'Export AutoCAD DXF',
      subtitle: 'Save AutoCAD R12 DXF with WALLS/DOORS/WINDOWS/ROOMS layers',
      keywords: 'export dxf cad autocad',
      run: () => { goToStep(4); handleSaveDXF(); },
    },
    {
      group: 'Actions',
      title: 'Undo Last Edit',
      subtitle: 'Revert the previous change in the 2D editor',
      shortcut: 'Ctrl+Z',
      keywords: 'history revert',
      run: () => { goToStep(3); ensureEditor().undo(); },
    },
    {
      group: 'Actions',
      title: 'Redo Edit',
      subtitle: 'Re-apply the last undone change',
      shortcut: 'Ctrl+Y',
      keywords: 'history forward',
      run: () => { goToStep(3); ensureEditor().redo(); },
    },
  ];

  const recents = (state.recentItems || []).map((item) => ({
    group: 'Recent Items',
    title: item.name,
    subtitle: item.roomCount > 0
      ? `${item.floorCount > 1 ? `${item.floorCount} floors · ` : ''}${item.roomCount} ${item.roomCount === 1 ? 'room' : 'rooms'} · ${item.wallCount} walls`
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
  $('#paper-size').value = state.settings.defaultPaperSize;
  $('#export-scale').value = state.settings.defaultScale;
  const exportShowRooms = $('#export-show-rooms');
  if (exportShowRooms) exportShowRooms.checked = state.exportShowRooms;
  syncExportMetaInputs();

  $$('.step-indicator').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetStep = parseInt(btn.dataset.step, 10);
      goToStep(targetStep);
    });
  });

  initLoadStep();
  bindOrientStepEvents();
  bindEditStepEvents();
  bindExportStepEvents();

  $('#error-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#error-modal')) {
      $('#error-modal').hidden = true;
    }
  });

  paletteCtrl = initCommandPalette({
    modalEl: $('#command-palette-modal'),
    inputEl: $('#command-palette-input'),
    resultsEl: $('#command-palette-results'),
    triggerBtnEl: $('#btn-command-palette'),
    closeBtnEl: $('#btn-close-palette'),
    getItems: buildCommandPaletteItems,
  });

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

  shortcutsCtrl = initShortcutsOverlay({
    modalEl: $('#shortcuts-modal'),
    bodyEl: $('#shortcuts-modal-body'),
    guideBodyEl: $('#help-guide-body'),
    tabShortcutsEl: $('#help-tab-shortcuts'),
    tabGuideEl: $('#help-tab-guide'),
    closeBtnEl: $('#btn-close-shortcuts'),
    openBtnEl: $('#btn-shortcuts-help'),
    getCurrentStep: () => state.currentStep,
    isAnyOtherModalOpen: () => {
      const errorOpen = !$('#error-modal').hidden;
      const calibrateOpen = !$('#calibrate-modal').hidden;
      const floorEditOpen = !$('#floor-edit-modal').hidden;
      return Boolean(paletteCtrl?.isOpen() || settingsCtrl?.isOpen() || errorOpen || calibrateOpen || floorEditOpen);
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
      autoStraighten: handleAutoStraighten,
      rotate90: handleRotate90,
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
        if (!$('#floor-edit-modal').hidden) {
          $('#floor-edit-modal').hidden = true;
          return true;
        }
        if (!$('#calibrate-modal').hidden) {
          $('#calibrate-modal').hidden = true;
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
