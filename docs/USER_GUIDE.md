# Bay Scallop · User Guide

This guide covers every step of turning a 3D `.glb` scan (or saved `.json` plan) into scaled architectural floor plans.

---

## Step 1: Load a Scan or Saved Plan

- **3D Scans (`.glb`, `.gltf`, `.obj`, `.stl`, meshed `.ply`)**: Drag and drop any supported 3D scan file onto the upload zone or click **Choose 3D Scan / JSON File** (`O`). (Vertex-only `.ply` point clouds must be meshed before loading.)
- **Re-Import Project (`.json`)**: Drop any `_plan.json` file exported from Bay Scallop (`glb-floorplan` format) to jump straight into Step 3 with all floors, walls, doors, windows, measurements, and labels intact.
- **Built-In Samples**: Click **Sample Room (245 KB)** or **Sample House (560 KB)** to test immediately.
- **Recent Scans & Plans**: Edited plans are saved locally in your browser (`localStorage`, up to 8 entries) with one-click **Resume**.

---

## Step 2: Confirm Orientation & Multi-Floor Planes

- Inspect the green **Up** arrow in the 3D viewport (`OrbitControls`: drag to orbit, scroll to zoom, right-drag to pan).
- If the model came from a Z-up tool or inverted scan, click any of the 6 axis buttons (`Y+`, `Y−`, `Z+`, `Z−`, `X+`, `X−`) to override.
- **Detected Floor Planes**: Bay Scallop automatically scans horizontal surface heights to detect single or multi-story levels (`Floor 1`, `Floor 2`, ...) and draws translucent slice planes sized to your model. Toggle **Show detected floor slice planes in 3D** to inspect cut heights before extraction.
- Click **Confirm & Detect Floors** to slice every detected story.

---

## Step 3: 2D CAD Blueprint Editor

### Multi-Floor Tabs & Properties
- Switch between detected floors using the **Floor Tabs** bar beneath the toolbar.
- Click the `✎` icon (or double-click a floor tab) to rename a floor or edit its ceiling height.
- Click **+ Add Floor** to create an additional level manually, or click `×` on a tab to remove an extra floor.
- Each floor maintains its own independent 50-step Undo/Redo history.

### Non-Destructive Layers (`Layers ▾`)
- **3D Scan Walls** (auto-sliced from `.glb`) are stored separately from **Drafted Walls** (drawn manually or via `+ Room`).
- Adjusting the **Slice Offset** slider only re-slices the 3D Scan layer, leaving your drafted walls untouched.
- Open **Layers ▾** in the toolbar to independently toggle visibility of `3D Scan Walls`, `Drafted Walls`, `Room Overlays`, `Doors & Windows`, `Measurements`, `Text Notes`, and `Reference Grid`. Hidden layers are excluded from room detection and exports.

### Drawing, Wall Handles, Properties Bar & Cleanup Tools
- **Select (`V`)**:
  - Click any wall, measurement, door/window symbol, or text note to select it and open the bottom **Properties Bar** (set exact wall lengths, promote a scan wall to the Drafted layer, choose preset door/window widths like `28"`, `32"`, `36"`, `48"`, `60"`, or delete).
  - **Draggable Wall Endpoint Handles**: When a single wall is selected, drag either white/amber endpoint circle (with magnetic snapping) to extend, trim, or close scan gaps cleanly.
  - **Marquee Box Select**: Click and drag on empty canvas to select multiple walls, notes, and symbols at once.
  - Drag text notes to reposition them; double-click to edit text.
  - Drag doors/windows along walls to slide them; double-click or press `Space` to flip door swing (or rotate a window 90°).
- **Pan (`H` or `Space+Drag`)**: Drag to pan anywhere on the canvas without switching tools. Mouse wheel always zooms.
- **Draw Wall (`D`)**: Continuous polyline wall drawing—click point-to-point to chain connected walls rapidly; close the loop back to the start, double-click, right-click, or press `Esc` to finish. Includes angle snapping (`45°`, `90°`, or Freehand in Settings) and **magnetic endpoint / midpoint / grid snapping** (green ring = endpoint, amber = midpoint, blue = grid). Hold `Alt` to temporarily bypass snapping.
- **Door (`Shift+D`), Window (`W`), & Archway (`A`)**: Hover near a wall to preview an auto-aligned architectural opening; click to place it cleanly on the wall.
- **Stairs (`S`)**: Click anywhere in a room or hallway to place a staircase flight with treads and `UP` direction arrow (drag freely in Select mode; use the Properties Bar to change width, run length, **Flip UP**, or **Rotate 90°**).
- **Measure (`M`)**: Two-click snapped dimension annotation.
- **Calibrate Scale (`C`)**: If a `.glb` scan was exported in centimeters or arbitrary scale, click two points across a known wall or doorway, enter the true real-world length (`ft`, `in`, `m`, or `cm`), and choose whether to rescale **All floors** or only the **Active floor**.
- **Text Note (`T`)**: Click anywhere to place a room label or note. Any text note placed inside a closed room automatically names that room in the Room Schedule and exports.
- **Erase (`E`)**: Click individual items to delete, or **click and drag** a red marquee box to batch-erase scan clutter in a single undoable step.

### Alignment, Templates & Slice Offset
- **Auto-Straighten (`Shift+R`)**: Estimates the dominant wall angle across the active floor and rotates the entire plan so walls align horizontally/vertically.
- **Rotate 90° (`R`)** & **Flip H/V** (via Command Palette `Ctrl+K`): Quickly reorient plans.
- **Slice Offset Slider**: Drag to scrub the 3D cut height above the current floor in real time (works for both positive and negative up-axes). A single `Ctrl+Z` restores pre-scrub walls.
- **+ Room**: Inserts a clean `4 m × 3 m` closed starter room.
- **Clear**: Clears all geometry and annotations on the active floor (undoable with `Ctrl+Z`).

### Detected Rooms Drawer
- Closed loops (including shared-wall multi-room layouts and standalone rooms) are automatically detected and listed with dimensions and area.
- Click a room name to smoothly pan/focus onto it, or click **Rename** to add/update its label directly.

---

## Step 4: Preview & Export

- **Project Name, Paper Size, Orientation & Scale**: Choose `A4`, `A3`, `Letter`, or `Tabloid` in **Landscape** or **Portrait**, with `Auto-fit` (Imperial or Metric aware), US Imperial architectural scales (`1/2" = 1'-0"`, `1/4" = 1'-0"`, `1/8" = 1'-0"`), or Metric ratios (`1:50`, `1:100`, `1:200`).
- **Sheet Options**: Toggle room overlays, toggle the **on-sheet Room Schedule table**, enable/rotate the **North Arrow** (`0°–359°`), and expand **Title Block Details** to enter Client Name, Property Address, Drawn By, and Sheet #.
- **Multi-Page Preview**: For multi-story buildings, use `‹` / `›` above the blueprint sheet to inspect every floor and its Room Schedule Summary.
- **Export Formats**:
  - **Save PDF**: Vector multi-page blueprint with exact unit-accurate scale bar, optional Room Schedule, North Arrow, and Title Block.
  - **Save PNG**: High-DPI (`2400 px` wide) raster blueprint sheet image for quick sharing or client quotes.
  - **Save SVG**: Clean layered vector SVG for Illustrator, Inkscape, or Figma.
  - **Save DXF**: AutoCAD R12 DXF with separate layers for `WALLS`, `DOORS`, `WINDOWS`, `ROOMS`, `DIMENSIONS`, and `NOTES`.
  - **Save Plan Data (`.json`)**: Multi-floor JSON preserving layers and metadata for re-importing into Bay Scallop or importing into PaintingBusinessManager.

---

## Settings (`,`) & Command Palette (`Ctrl+K`)

Open **Settings** (`,`) to configure:
- **Display Units**: Imperial (`ft` & `in`, `sq ft`) or Metric (`m` & `cm`, `m²`).
- **Angle Snapping**: `45°`, `90° Orthogonal`, or `Freehand`.
- **Reference Grid**, **Room Overlays & Labels**, and **Endpoint & Grid Snapping** toggles.
- **Default Slice Height**, **Wall Gap Tolerance** (`2 cm`, `5 cm`, `10 cm`), and **Wall Cleanup / Simplification** (`Off`, `1 cm`, `2 cm`, `5 cm`).
- **Default Paper Size** & **Default Drawing Scale**.
