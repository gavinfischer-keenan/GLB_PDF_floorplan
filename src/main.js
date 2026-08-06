/**
 * Main application — orchestrates the GLB → Floor Plan pipeline
 * Manages the 5-step wizard flow and wires all components together.
 */
import { GLBLoader } from './glb-loader.js';
import { Viewport3D } from './viewport-3d.js';
import { detectUpDirection } from './up-detector.js';
import { detectFloors } from './floor-detector.js';
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
  detectedFloors: [],    // From floor detector
  selectedFloors: [],    // User-selected floors to process
  floorPlans: [],        // Processed floor plan data per floor
  viewport: null,        // 3D viewport instance
  floorsViewport: null,  // 3D viewport for floor selection
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
  floors: $('#step-floors'),
  edit: $('#step-edit'),
  export: $('#step-export'),
};

// ============================================================
// Step Navigation
// ============================================================
function goToStep(stepNum) {
  state.currentStep = stepNum;

  // Update step visibility
  Object.values(steps).forEach((s) => s.classList.remove('active'));
  const stepNames = ['load', 'orient', 'floors', 'edit', 'export'];
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
  if (stepNum === 3) initFloorsStep();
  if (stepNum === 4) initEditStep();
  if (stepNum === 5) initExportStep();
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

  // Confirm button
  $('#btn-confirm-orient').onclick = () => goToStep(3);
  $('#btn-back-to-load').onclick = () => {
    // Reset and go back
    const uploadZone = $('#upload-zone');
    const loadingOverlay = $('#loading-overlay');
    uploadZone.hidden = false;
    loadingOverlay.hidden = true;
    goToStep(1);
  };
}

// ============================================================
// Step 3: Select Floor Levels
// ============================================================
function initFloorsStep() {
  // Create a second viewport for floor visualization
  const container = $('#viewport-floors');
  if (!state.floorsViewport) {
    state.floorsViewport = new Viewport3D(container);
  }
  state.floorsViewport.setModel(state.modelData.scene.clone(), state.modelData.bounds);
  state.floorsViewport.showUpArrow(state.upAxis);

  // Detect floors
  state.detectedFloors = detectFloors(state.modelData.meshes, state.upAxis);

  // Show floor planes in 3D
  state.floorsViewport.showFloorPlanes(state.detectedFloors, state.upAxis);

  // Populate floor list
  const floorList = $('#floor-list');
  floorList.innerHTML = '';

  if (state.detectedFloors.length === 0) {
    floorList.innerHTML = `
      <div style="padding: 1rem; color: var(--text-secondary); text-align: center;">
        <p>No floor levels were automatically detected.</p>
        <p style="font-size: 0.8rem; margin-top: 0.5rem;">This may indicate the model is not a building interior, or the orientation needs adjustment.</p>
      </div>
    `;
  } else {
    state.detectedFloors.forEach((floor, i) => {
      const item = document.createElement('div');
      item.className = 'floor-item selected';
      item.innerHTML = `
        <input type="checkbox" checked data-index="${i}" />
        <div class="floor-item-info">
          <div class="floor-item-name">${floor.name}</div>
          <div class="floor-item-height">Height: ${floor.floorHeight.toFixed(2)}m · Slice: ${floor.sliceHeight.toFixed(2)}m</div>
        </div>
      `;
      floorList.appendChild(item);

      // Toggle selection
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        item.classList.toggle('selected', checkbox.checked);
      });
    });
  }

  // Navigation
  $('#btn-back-to-orient').onclick = () => goToStep(2);
  $('#btn-confirm-floors').onclick = () => {
    // Collect selected floors
    const checkboxes = floorList.querySelectorAll('input[type="checkbox"]');
    state.selectedFloors = [];
    checkboxes.forEach((cb) => {
      if (cb.checked) {
        state.selectedFloors.push(state.detectedFloors[parseInt(cb.dataset.index)]);
      }
    });

    if (state.selectedFloors.length === 0) {
      showError('No Floors Selected', 'Please select at least one floor level to generate a plan for.');
      return;
    }

    // Process floor plans
    processFloorPlans();
    goToStep(4);
  };
}

/**
 * Process cross-sections and detect rooms for each selected floor
 */
function processFloorPlans() {
  state.floorPlans = [];

  for (const floor of state.selectedFloors) {
    // Extract cross-section at slice height
    const crossSection = extractCrossSection(
      state.modelData.meshes,
      floor.sliceHeight,
      state.upAxis
    );

    // Detect rooms from cross-section segments
    const rooms = detectRooms(crossSection.segments, 0.05);

    // Check for "non-building" indicators
    const totalArea = rooms.reduce((sum, r) => sum + Math.abs(r.area), 0);
    const bounds = crossSection.bounds;
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;

    let warning = null;
    if (rooms.length === 0 && crossSection.segments.length > 0) {
      warning = 'No enclosed rooms detected. The model may be an open area or the slice height may need adjustment.';
    } else if (totalArea > 10000) {
      warning = 'Very large area detected (>10,000 m²). This may not be a building interior.';
    } else if (spanX > 200 || spanY > 200) {
      warning = 'Model spans over 200m. This appears to be a large outdoor area rather than a building.';
    }

    state.floorPlans.push({
      name: floor.name,
      floorHeight: floor.floorHeight,
      sliceHeight: floor.sliceHeight,
      segments: crossSection.segments,
      rooms,
      bounds: crossSection.bounds,
      warning,
      walls: crossSection.segments,  // alias for PDF exporter
    });
  }
}

// ============================================================
// Step 4: Edit Floor Plans
// ============================================================
function initEditStep() {
  const svgElement = $('#floor-plan-svg');

  // Create editor
  if (!state.editor) {
    state.editor = new FloorPlanEditor(svgElement);

    // Wire up callbacks
    state.editor.onRoomSelected = (room) => {
      updateRoomEditor(room);
    };

    state.editor.onZoomChanged = (pct) => {
      $('#zoom-level').textContent = `${pct}%`;
    };

    state.editor.onRoomUpdated = () => {
      updateRoomList();
    };
  }

  // Check for warnings
  for (const plan of state.floorPlans) {
    if (plan.warning) {
      showError('Warning', plan.warning);
      break; // Show only the first warning
    }
  }

  // Load floor data into editor
  state.editor.setFloorData(state.floorPlans);

  // Build floor tabs
  const tabContainer = $('#floor-tabs');
  tabContainer.innerHTML = '';
  state.floorPlans.forEach((plan, i) => {
    const tab = document.createElement('button');
    tab.className = `floor-tab${i === 0 ? ' active' : ''}`;
    tab.textContent = plan.name;
    tab.addEventListener('click', () => {
      tabContainer.querySelectorAll('.floor-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.editor.switchFloor(i);
      updateRoomList();
    });
    tabContainer.appendChild(tab);
  });

  // Toolbar tools
  $$('.btn-tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.btn-tool[data-tool]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.editor.setTool(btn.dataset.tool);
    });
  });

  // Undo/Redo
  $('#btn-undo').onclick = () => {
    state.editor.undo();
    updateRoomList();
  };
  $('#btn-redo').onclick = () => {
    state.editor.redo();
    updateRoomList();
  };

  // Zoom controls
  $('#btn-zoom-in').onclick = () => state.editor.zoomIn();
  $('#btn-zoom-out').onclick = () => state.editor.zoomOut();
  $('#btn-zoom-fit').onclick = () => state.editor.fitToView();

  // Slice height slider
  const slider = $('#slice-height-slider');
  const sliderValue = $('#slice-height-value');
  const activeFloor = state.floorPlans[state.editor.activeFloorIndex];
  if (activeFloor) {
    const minH = activeFloor.floorHeight;
    const maxH = activeFloor.sliceHeight + 2;
    slider.min = Math.round(minH * 100);
    slider.max = Math.round(maxH * 100);
    slider.value = Math.round(activeFloor.sliceHeight * 100);
    sliderValue.textContent = `${activeFloor.sliceHeight.toFixed(1)}m`;
  }

  slider.addEventListener('input', () => {
    const height = parseInt(slider.value) / 100;
    sliderValue.textContent = `${height.toFixed(1)}m`;
  });

  slider.addEventListener('change', () => {
    const height = parseInt(slider.value) / 100;
    const floorIdx = state.editor.activeFloorIndex;
    const plan = state.floorPlans[floorIdx];
    plan.sliceHeight = height;

    // Re-process this floor
    const crossSection = extractCrossSection(
      state.modelData.meshes,
      height,
      state.upAxis
    );
    const rooms = detectRooms(crossSection.segments, 0.05);

    plan.segments = crossSection.segments;
    plan.walls = crossSection.segments;
    plan.rooms = rooms;
    plan.bounds = crossSection.bounds;

    state.editor.setFloorData(state.floorPlans);
    state.editor.switchFloor(floorIdx);
    updateRoomList();
  });

  // Room name/type inputs
  $('#room-name-input').addEventListener('change', (e) => {
    if (state.editor.selectedRoom) {
      state.editor.updateRoom(state.editor.selectedRoom, { name: e.target.value });
      updateRoomList();
    }
  });

  $('#room-type-select').addEventListener('change', (e) => {
    if (state.editor.selectedRoom) {
      state.editor.updateRoom(state.editor.selectedRoom, { type: e.target.value });
    }
  });

  // Delete room button
  $('#btn-delete-room').onclick = () => {
    if (state.editor.selectedRoom) {
      state.editor.deleteRoom(state.editor.selectedRoom);
      updateRoomEditor(null);
      updateRoomList();
    }
  };

  // Navigation
  $('#btn-back-to-floors').onclick = () => goToStep(3);
  $('#btn-export').onclick = () => goToStep(5);

  // Populate room list
  updateRoomList();

  // Keyboard shortcuts
  document.onkeydown = (e) => {
    if (state.currentStep !== 4) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.key === 'v') {
      selectTool('select');
    } else if (e.key === 'l') {
      selectTool('label');
    } else if (e.key === 'd') {
      selectTool('draw');
    } else if (e.key === 'e') {
      selectTool('erase');
    } else if (e.key === 'm') {
      selectTool('measure');
    } else if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      state.editor.undo();
      updateRoomList();
    } else if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      state.editor.redo();
      updateRoomList();
    }
  };
}

function selectTool(tool) {
  $$('.btn-tool[data-tool]').forEach((b) => b.classList.remove('active'));
  $(`.btn-tool[data-tool="${tool}"]`)?.classList.add('active');
  state.editor?.setTool(tool);
}

function updateRoomEditor(room) {
  const panel = $('#room-editor');
  if (room) {
    panel.hidden = false;
    $('#room-name-input').value = room.name || '';
    $('#room-type-select').value = room.type || 'room';
    $('#room-area').textContent = `${Math.abs(room.area).toFixed(1)} m²`;
    $('#room-perimeter').textContent = `${room.perimeter.toFixed(1)} m`;
  } else {
    panel.hidden = true;
  }
}

function updateRoomList() {
  const list = $('#room-list-editor');
  list.innerHTML = '';

  const currentFloor = state.floorPlans[state.editor?.activeFloorIndex || 0];
  if (!currentFloor) return;

  for (const room of currentFloor.rooms) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${room.name || 'Room'}</span>
      <span class="room-area-badge">${Math.abs(room.area).toFixed(1)} m²</span>
    `;
    li.addEventListener('click', () => {
      state.editor._selectRoom(room);
    });
    list.appendChild(li);
  }
}

// ============================================================
// Step 5: Export PDF
// ============================================================
function initExportStep() {
  // Set default project name from file
  const nameInput = $('#project-name');
  if (!nameInput.value && state.file) {
    nameInput.value = state.file.name.replace(/\.glb$/i, '');
  }

  // Back button
  $('#btn-back-to-edit').onclick = () => goToStep(4);

  // Save PDF button
  $('#btn-save-pdf').onclick = async () => {
    const projectName = nameInput.value || 'Floor Plan';
    const paperSize = $('#paper-size').value;
    const scaleVal = $('#export-scale').value;
    const scale = scaleVal === 'auto' ? 'auto' : parseInt(scaleVal);

    try {
      const { doc, fileName } = exportPDF({
        projectName,
        paperSize,
        scale,
        floors: state.floorPlans,
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
