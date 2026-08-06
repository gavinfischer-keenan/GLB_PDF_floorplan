/**
 * Main application — orchestrates the GLB → Floor Plan pipeline
 * Manages the 4-step wizard flow and wires all components together.
 */
import { GLBLoader } from './glb-loader.js';
import { Viewport3D } from './viewport-3d.js';
import { detectUpDirection } from './up-detector.js';
import { detectFloor } from './floor-detector.js';
import { extractCrossSection } from './cross-section.js';
import { detectRooms } from './room-detector.js';
import { FloorPlanEditor } from './floor-plan-editor.js';
import { exportPDF, savePDF } from './pdf-exporter.js';

// ============================================================
// Application State
// ============================================================
const state = {
  currentStep: 1,
  file: null,
  modelData: null,      // From GLBLoader
  upAxis: null,          // Detected up direction
  detectedFloor: null,   // Single detected floor
  floorPlan: null,       // Processed floor plan data
  viewport: null,        // 3D viewport instance
  editor: null,          // Floor plan editor instance
};

// ============================================================
// DOM References
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Steps
const steps = {
  load: $('#step-load'),
  orient: $('#step-orient'),
  edit: $('#step-edit'),
  export: $('#step-export'),
};

// ============================================================
// Step Navigation
// ============================================================
function goToStep(stepNum) {
  state.currentStep = stepNum;

  // Update step visibility
  Object.values(steps).forEach((s) => s?.classList.remove('active'));
  const stepNames = ['load', 'orient', 'edit', 'export'];
  steps[stepNames[stepNum - 1]]?.classList.add('active');

  // Update step indicators
  $$('.step-indicator').forEach((el) => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s === stepNum) el.classList.add('active');
    else if (s < stepNum) el.classList.add('completed');
  });

  // Step-specific initialization
  if (stepNum === 2) initOrientStep();
  if (stepNum === 3) initEditStep();
  if (stepNum === 4) initExportStep();
}

// ============================================================
// Step 1: Load GLB
// ============================================================
function initLoadStep() {
  const uploadZone = $('#upload-zone');
  const fileInput = $('#file-input');
  const btnBrowse = $('#btn-browse');
  const loadingOverlay = $('#loading-overlay');
  const progressFill = $('#progress-fill');

  // Browse button
  btnBrowse.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  // Upload zone click
  uploadZone.addEventListener('click', () => fileInput.click());

  // Drag & drop
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
      handleFile(e.dataTransfer.files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
    }
  });

  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.glb')) {
      showError('Invalid File', 'Please select a .glb file.');
      return;
    }

    state.file = file;
    uploadZone.hidden = true;
    loadingOverlay.hidden = false;

    try {
      const loader = new GLBLoader();
      loader.onProgress = (pct) => {
        progressFill.style.width = `${pct}%`;
      };

      state.modelData = await loader.load(file);

      // Validate: check if model has any geometry
      if (state.modelData.totalTriangles === 0) {
        throw new Error('The GLB file contains no geometry data.');
      }

      goToStep(2);
    } catch (err) {
      console.error('Failed to load GLB:', err);
      showError('Failed to Load', `Could not parse the GLB file: ${err.message}`);
      uploadZone.hidden = false;
      loadingOverlay.hidden = true;
      progressFill.style.width = '0%';
    }
  }
}

// ============================================================
// Step 2: Confirm Orientation
// ============================================================
function initOrientStep() {
  const container = $('#viewport-3d');

  // Create viewport if not exists
  if (!state.viewport) {
    state.viewport = new Viewport3D(container);
  }

  // Set the model
  state.viewport.setModel(state.modelData.scene.clone(), state.modelData.bounds);

  // Auto-detect up direction
  const detection = detectUpDirection(state.modelData.meshes, state.modelData.bounds);
  state.upAxis = detection.axis;

  // Update UI
  $('#detected-axis').textContent = detection.axis.toUpperCase();
  $('#detected-confidence').textContent = `${Math.round(detection.confidence * 100)}%`;

  // Model stats
  $('#stat-triangles').textContent = state.modelData.totalTriangles.toLocaleString();
  $('#stat-meshes').textContent = state.modelData.meshCount.toString();
  const b = state.modelData.bounds;
  const sizeX = (b.max.x - b.min.x).toFixed(1);
  const sizeY = (b.max.y - b.min.y).toFixed(1);
  const sizeZ = (b.max.z - b.min.z).toFixed(1);
  $('#stat-bounds').textContent = `${sizeX} × ${sizeY} × ${sizeZ}m`;

  // Show up arrow
  state.viewport.showUpArrow(state.upAxis);

  // Highlight the detected axis button
  $$('.btn-axis').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.axis === state.upAxis);
  });

  // Axis button clicks
  $$('.btn-axis').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.upAxis = btn.dataset.axis;
      $$('.btn-axis').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewport.showUpArrow(state.upAxis);
    });
  });

  // Confirm button — auto-detect floor and jump to editor
  $('#btn-confirm-orient').onclick = () => {
    // Detect the single floor level
    state.detectedFloor = detectFloor(state.modelData.meshes, state.upAxis);

    if (!state.detectedFloor) {
      // Fallback: use the model bounds to create a slice at the bottom + 1m
      const b = state.modelData.bounds;
      const axisChar = state.upAxis.slice(-1).toLowerCase();
      const sign = state.upAxis[0] === '-' ? -1 : 1;
      const floorH = sign > 0 ? b.min[axisChar] : b.max[axisChar];
      state.detectedFloor = {
        name: 'Floor 1',
        floorHeight: floorH,
        ceilingHeight: floorH + sign * 3.0,
        sliceHeight: floorH + sign * 1.0,
      };
    }

    // Process the floor plan
    processFloorPlan();
    goToStep(3);
  };
  $('#btn-back-to-load').onclick = () => {
    // Reset and go back
    const uploadZone = $('#upload-zone');
    const loadingOverlay = $('#loading-overlay');
    uploadZone.hidden = false;
    loadingOverlay.hidden = true;
    goToStep(1);
  };
}

/**
 * Process cross-section for the detected floor
 */
function processFloorPlan() {
  const floor = state.detectedFloor;

  // Extract cross-section at slice height
  const crossSection = extractCrossSection(
    state.modelData.meshes,
    floor.sliceHeight,
    state.upAxis
  );

  // Detect rooms from cross-section segments
  const rooms = detectRooms(crossSection.segments, 0.05);

  // Check for "non-building" indicators
  const bounds = crossSection.bounds;
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;

  let warning = null;
  if (crossSection.segments.length === 0) {
    warning = 'No wall segments detected. Try adjusting the orientation or the slice height in the editor.';
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
  };
}

// ============================================================
// Step 3: Edit Floor Plan
// ============================================================
function initEditStep() {
  const svgElement = $('#floor-plan-svg');

  // Create editor
  if (!state.editor) {
    state.editor = new FloorPlanEditor(svgElement);

    // Wire up callbacks
    state.editor.onZoomChanged = (pct) => {
      $('#zoom-level').textContent = `${pct}%`;
    };
  }

  // Check for warnings
  if (state.floorPlan?.warning) {
    showError('Warning', state.floorPlan.warning);
  }

  // Load floor data into editor
  const floorData = state.floorPlan ? [state.floorPlan] : [];
  state.editor.setFloorData(floorData);

  // Toolbar tools
  $$('.btn-tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.btn-tool[data-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.editor.setTool(btn.dataset.tool);
    });
  });

  // Undo/Redo
  $('#btn-undo').onclick = () => state.editor.undo();
  $('#btn-redo').onclick = () => state.editor.redo();

  // Zoom controls
  $('#btn-zoom-in').onclick = () => state.editor.zoomIn();
  $('#btn-zoom-out').onclick = () => state.editor.zoomOut();
  $('#btn-zoom-fit').onclick = () => state.editor.fitToView();

  // Slice height slider
  const slider = $('#slice-height-slider');
  const sliderValue = $('#slice-height-value');
  const plan = state.floorPlan;
  if (plan) {
    const minH = plan.floorHeight;
    const maxH = plan.sliceHeight + 2;
    slider.min = Math.round(minH * 100);
    slider.max = Math.round(maxH * 100);
    slider.value = Math.round(plan.sliceHeight * 100);
    sliderValue.textContent = `${plan.sliceHeight.toFixed(1)}m`;
  }

  slider.addEventListener('input', () => {
    const height = parseInt(slider.value) / 100;
    sliderValue.textContent = `${height.toFixed(1)}m`;
  });

  slider.addEventListener('change', () => {
    const height = parseInt(slider.value) / 100;
    if (!state.floorPlan) return;
    state.floorPlan.sliceHeight = height;

    // Re-process floor plan
    const crossSection = extractCrossSection(
      state.modelData.meshes,
      height,
      state.upAxis
    );
    const rooms = detectRooms(crossSection.segments, 0.05);

    state.floorPlan.segments = crossSection.segments;
    state.floorPlan.walls = crossSection.segments;
    state.floorPlan.rooms = rooms;
    state.floorPlan.bounds = crossSection.bounds;

    state.editor.setFloorData([state.floorPlan]);
  });

  // Navigation
  const btnBack = $('#btn-back-to-orient');
  if (btnBack) btnBack.onclick = () => goToStep(2);
  $('#btn-export').onclick = () => goToStep(4);

  // Keyboard shortcuts
  document.onkeydown = (e) => {
    if (state.currentStep !== 3) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.key === 'v') {
      selectTool('select');
    } else if (e.key === 'h') {
      selectTool('pan');
    } else if (e.key === 't') {
      selectTool('text');
    } else if (e.key === 'd') {
      selectTool('draw');
    } else if (e.key === 'm') {
      selectTool('measure');
    } else if (e.key === 'e') {
      selectTool('erase');
    } else if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      state.editor.undo();
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      state.editor.redo();
    }
  };
}

function selectTool(tool) {
  $$('.btn-tool[data-tool]').forEach((b) => b.classList.remove('active'));
  $(`.btn-tool[data-tool="${tool}"]`)?.classList.add('active');
  state.editor?.setTool(tool);
}

// ============================================================
// Step 4: Export PDF
// ============================================================
function initExportStep() {
  // Set default project name from file
  const nameInput = $('#project-name');
  if (!nameInput.value && state.file) {
    nameInput.value = state.file.name.replace(/\.glb$/i, '');
  }

  // Back button
  $('#btn-back-to-edit').onclick = () => goToStep(3);

  // Save PDF button
  $('#btn-save-pdf').onclick = async () => {
    const projectName = nameInput.value || 'Floor Plan';
    const paperSize = $('#paper-size').value;
    const scaleVal = $('#export-scale').value;
    const scale = scaleVal === 'auto' ? 'auto' : parseInt(scaleVal);

    try {
      const exportFloor = state.editor ? state.editor.getExportData() : state.floorPlan;
      if (exportFloor && state.floorPlan) {
        exportFloor.name = state.floorPlan.name;
      }

      const { doc, fileName } = exportPDF({
        projectName,
        paperSize,
        scale,
        floors: exportFloor ? [exportFloor] : [],
        fileName: `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_floorplan.pdf`,
      });

      const result = await savePDF(doc, `${projectName.replace(/[^a-zA-Z0-9]/g, '_')}_floorplan.pdf`);

      if (result.success) {
        showSuccess('PDF Saved', result.method === 'filesystem'
          ? 'Floor plan PDF has been saved to your chosen location.'
          : 'Floor plan PDF has been downloaded.');
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      showError('Export Failed', `Could not generate PDF: ${err.message}`);
    }
  };
}

// ============================================================
// Error & Success Modals
// ============================================================
function showError(title, message) {
  const modal = $('#error-modal');
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
// Initialize
// ============================================================
initLoadStep();
goToStep(1);
