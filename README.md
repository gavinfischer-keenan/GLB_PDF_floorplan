# Bay Scallop · FloorPlan Extractor

Public edition: https://floorplan.11mosswood.us/ (app at `/app/`). All 3D scans and floor plans are processed locally in the browser with zero server uploads. See [DEPLOYMENT.md](DEPLOYMENT.md) for build and hosting details.

FloorPlan Extractor is a client-side 3D-to-2D architectural CAD tool that converts `.glb`, `.gltf`, `.obj`, `.stl`, or meshed `.ply` 3D scans (or re-imported `.json` floor plans) into clean multi-floor architectural drawings and exports **Vector PDF**, **High-DPI PNG**, **Layered SVG**, **AutoCAD R12 DXF**, and **JSON Plan Data**.

---

## Key Features

- **Multi-Format 3D Scan & JSON Plan Loading**: Drag and drop `.glb`, `.gltf`, `.obj`, `.stl`, or meshed `.ply` 3D scans (or re-import `.json` `glb-floorplan` v1 project files), try built-in sample scans, or resume recent plans from local browser history.
- **Intelligent Up-Axis & Multi-Floor Detection**: Automatic up-direction voting (`up-detector.js`), 6-axis manual override (`±X`, `±Y`, `±Z`), multi-story floor/ceiling peak detection (`detectFloors`), and model-sized translucent 3D floor slice planes (`Viewport3D`).
- **BVH-Accelerated Slicing & Wall Cleanup**: Fast `three-mesh-bvh` spatial slicing for large meshes (`>= 2,000` triangles), live undoable slice-offset scrubbing, and configurable Douglas-Peucker collinear wall simplification (`simplifyWallSegments`).
- **Planar Half-Edge Room Detection**: Splits T-junctions and crossings to extract closed rooms reliably across standalone rooms and adjacent shared-wall floor plans, with translucent canvas & blueprint room overlays and area schedules.
- **2D CAD Floor Plan Editor**:
  - **Tools**: Select, Marquee Box & Draggable Wall Endpoint Handles (`V`), Pan / Hand (`H` or `Space+Drag`), Continuous Polyline Draw (`D`), Door Symbol (`Shift+D`), Window Symbol (`W`), Archway / Opening (`A`), Stairs (`S`), Measure (`M`), Calibrate Scale (`C`), Text Note (`T`), and Erase / Marquee Erase (`E`).
  - **Non-Destructive Layers & Properties Bar**: Auto-sliced **3D Scan Walls** remain separate from **Drafted Walls** (toggleable via `Layers ▾`), so Slice Offset scrubbing never overwrites hand-drawn walls. Selecting a wall or opening reveals an inline Properties Bar to set exact lengths/widths, flip door swings, or promote a scan wall.
  - **Precision & Alignment**: Magnetic endpoint, midpoint, and grid snapping (hold `Alt` to bypass), `45°`/`90°`/Freehand angle snapping, **Auto-Straighten** (`Shift+R`), **Rotate 90°** (`R`), Horizontal/Vertical Flip, and 2-click **Scale Calibration**.
  - **Multi-Floor & History**: Per-floor tab switcher, floor rename & ceiling height modal (`✎`), `+ Add Floor`, floor deletion, per-floor 50-step Undo/Redo, and undoable `Clear` canvas.
- **Multi-Format Exports**:
  - **PDF**: Multi-page **Landscape or Portrait** architectural sheets (`A4`, `A3`, `Letter`, `Tabloid`), **US Imperial scales** (`1/2"=1'-0"`, `1/4"=1'-0"`, `1/8"=1'-0"`) and Metric ratios (`1:50`, `1:100`, `1:200`), unit-accurate graphic scale bars, optional **Room Schedule** table, rotatable **North Arrow**, and editable Title Block metadata (Client, Address, Author, Sheet #).
  - **High-DPI PNG**: Clean 2400px-wide raster blueprint image for quotes and quick sharing.
  - **SVG**: Clean layered vector SVG (`#rooms`, `#walls`, `#symbols`, `#dimensions`, `#notes`, optional `#north-arrow`).
  - **DXF**: AutoCAD R12 (`AC1009`) ASCII DXF with `$INSUNITS` (`2` Feet / `6` Meters) and layers `WALLS`, `DOORS`, `WINDOWS`, `OPENINGS`, `STAIRS`, `ROOMS`, `DIMENSIONS`, `NOTES`.
  - **JSON Plan Data**: Multi-floor `glb-floorplan` v1 JSON preserving `scanWalls`, `draftedWalls`, and `metadata` for Bay Scallop re-import and PaintingBusinessManager.
- **Productivity UX**: Command Palette (`Ctrl+K` / `Cmd+K`), built-in Help & Keyboard Shortcuts overlay (`?`), and persistent Settings modal (`,`).

---

## The 4-Step Pipeline

1. **Load**: Drop a `.glb`, `.gltf`, `.obj`, `.stl`, or meshed `.ply` 3D scan (or `.json` plan file), load a built-in sample, or resume a recent snapshot.
2. **Orient**: Inspect the 3D model, verify/override the up vector, toggle detected multi-floor slice planes, and confirm floor extraction.
3. **Edit**: Clean up and annotate walls per floor using CAD drawing, door/window/archway/stairs symbols, snapping, marquee select/erase, auto-straighten, scale calibration, live slice scrubbing, and room renaming.
4. **Export**: Preview each floor sheet live, toggle room overlays/schedules/North arrow, and save as **PDF**, **PNG**, **SVG**, **DXF**, or **JSON Plan Data**.

---

## Documentation

- [User Guide](docs/USER_GUIDE.md) — Step-by-step walkthrough of every tool, snapping rule, calibration, and multi-floor workflow.
- [Formats & Exports](docs/FORMATS_AND_EXPORTS.md) — Supported inputs, `glb-floorplan` JSON schema, PDF scale bars, SVG layers, and AutoCAD DXF layer specification.
- [Keyboard Shortcuts](docs/KEYBOARD_SHORTCUTS.md) — Complete keyboard and mouse reference (also available in-app via `?`).
- [Architecture Specification](architecture.md) — Module layout, algorithms, and test suite overview.
- [Deployment Guide](DEPLOYMENT.md) — Static production build, CSP headers, and hosting notes.

---

## Tech Stack

- **Bundler & Dev Server**: [Vite](https://vite.dev/)
- **3D Engine & Acceleration**: [Three.js](https://threejs.org/) & [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)
- **2D Vector Editor**: [D3.js](https://d3js.org/)
- **PDF Generation**: [jsPDF](https://github.com/parallax/jsPDF)
- **Testing**: [Vitest](https://vitest.dev/)
- **Styling**: Vanilla CSS with CSS custom properties

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22+ recommended for Vite 8)

### Commands

```bash
npm install      # Install dependencies
npm run dev      # Start local Vite development server
npm test         # Run automated Vitest test suite (63 tests across 8 files)
npm run build    # Build production bundle into dist/ (code-split chunks)
npm run preview  # Preview production build locally
```
