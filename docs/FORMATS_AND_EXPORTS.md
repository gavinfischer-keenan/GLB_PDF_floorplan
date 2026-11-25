# Supported Formats & Export Specifications

## Input Formats

| Format | Extension | Notes |
| --- | --- | --- |
| Binary / Embedded glTF | `.glb` | Parsed locally via Three.js `GLTFLoader`. Triangle geometry is extracted in world space. |
| ASCII glTF | `.gltf` | Parsed via `GLTFLoader` (self-contained `.gltf` files with embedded buffers). |
| Wavefront OBJ | `.obj` | Parsed via `OBJLoader`; computes vertex normals automatically when omitted. |
| Stereolithography | `.stl` | Binary or ASCII `.stl` parsed via `STLLoader`. |
| Polygon File Format | `.ply` | Meshed binary or ASCII `.ply` parsed via `PLYLoader`. Face-less point clouds are rejected with an explanatory error. |
| Bay Scallop Plan Data | `.json` | `glb-floorplan` v1 JSON files exported from Step 4. Restores all floors, walls, rooms, measurements, text notes, and architectural symbols directly into Step 3. |

---

## JSON Plan Data Schema (`glb-floorplan` v1)

All coordinates in JSON exports are stored in **meters** (`x` right, `y` down in plan space):

```json
{
  "format": "glb-floorplan",
  "version": 1,
  "units": "m",
  "projectName": "Sample House",
  "exportedAt": "2026-11-24T22:00:00.000Z",
  "metadata": {
    "client": "Jane Doe",
    "address": "123 Main St",
    "author": "Bay Scallop",
    "sheetNumber": "A-101",
    "orientation": "landscape",
    "showNorth": true,
    "northAngle": 0,
    "includeRoomSchedule": true
  },
  "floors": [
    {
      "name": "Floor 1",
      "floorHeight": 0.0,
      "ceilingHeight": 3.0,
      "sliceHeight": 1.0,
      "walls": [[[0, 0], [4, 0]], [[4, 0], [4, 3]]],
      "scanWalls": [[[0, 0], [4, 0]]],
      "draftedWalls": [[[4, 0], [4, 3]]],
      "rooms": [
        {
          "id": "room-1",
          "name": "Kitchen",
          "polygon": [[0, 0], [4, 0], [4, 3], [0, 3]],
          "area": 12.0,
          "perimeter": 14.0
        }
      ],
      "measurements": [
        { "id": "m_1", "p1": [0, 0], "p2": [4, 0], "text": "13' 1\"" }
      ],
      "textNotes": [
        { "id": "t_1", "pos": [2, 1.5], "text": "Kitchen" }
      ],
      "symbols": [
        { "id": "s_1", "kind": "door", "pos": [2, 0], "angle": 0, "width": 0.9, "swing": 1 }
      ]
    }
  ]
}
```

- **PaintingBusinessManager Compatibility**: Preserves `format: "glb-floorplan"`, `version: 1`, `units: "m"`, and per-floor `walls` and `rooms` (`id`, `name`, `polygon`, `area`, `perimeter`).
- **Round-Trip Fidelity**: `parsePlanData()` validates `format === "glb-floorplan"` and `floors`, restores all annotations/symbols, and synthesizes text labels for custom-named rooms if none exist inside the polygon.

---

## Architectural Blueprint PDF (`pdf-exporter.js`) & High-DPI PNG (`vector-exporter.js`)

- **Paper Sizes & Orientations (`Landscape` or `Portrait`)**:
  - `A4`: `297 × 210 mm`
  - `A3`: `420 × 297 mm`
  - `Letter`: `279.4 × 215.9 mm`
  - `Tabloid`: `431.8 × 279.4 mm`
- **Scales**:
  - `Auto-fit`: Picks Imperial architectural denominators (`[12, 24, 48, 96, 120, 192, 240, 480]`) when Display Units = Imperial, or Metric denominators (`[10, 20, 25, 50, 75, 100, 150, 200, 250, 500]`) when Metric.
  - Fixed US Imperial: `1/2" = 1'-0" (1:24)`, `1/4" = 1'-0" (1:48)`, `1/8" = 1'-0" (1:96)`.
  - Fixed Metric: `1:50`, `1:100`, `1:200`.
- **Unit-Accurate Scale Bar (`computeScaleBar`)**:
  - **Imperial**: Picks exact round feet (`1, 2, 4, 5, 10, 15, 20, 25, 50, 100, 200 ft`) whose exact metric equivalent (`ft × 0.3048 × 1000 / scale`) fits within `55 mm`.
  - **Metric**: Picks exact round metric lengths (`0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 50, 100 m`) within `55 mm`.
- **Sheet Elements**: Optional on-sheet Room Schedule table (`58 mm` right column with `TOTAL` row), rotatable North Arrow, custom Title Block metadata (`Client`, `Address`, `Drawn By`, `Sheet #`), and multi-page output (`Page X of Y`).
- **High-DPI PNG (`exportSVGElementToPNG`)**: Rasterizes the live blueprint sheet SVG onto a white background at `2400 px` width.

---

## Layered Vector SVG (`vector-exporter.js`)

Exports one floor per `.svg` file (`1 SVG unit = 1 meter`) with semantic groups:
- `<g id="rooms">` — Subtle room fill polygons
- `<g id="walls">` — Wall segments
- `<g id="symbols">` — Wall-break masks, door leaves + swing arcs, window frames + glazing
- `<g id="dimensions">` — Overall bounds and user measurement lines/text
- `<g id="notes">` — Room labels, area callouts, and user text notes

---

## AutoCAD R12 DXF (`vector-exporter.js`)

Exports ASCII DXF (`$ACADVER = AC1009`) compatible with AutoCAD, LibreCAD, QCAD, BricsCAD, and SketchUp:
- **Units (`$INSUNITS`)**:
  - Metric mode: `$INSUNITS = 6` (Meters), coordinates in meters.
  - Imperial mode: `$INSUNITS = 2` (Feet), coordinates converted to feet (`× 3.28084`).
- **Coordinate Orientation**: Y is negated (`-y`) so top-down plan layout matches standard CAD `+Y up` coordinates.
- **Layers**:
  - `WALLS` (Color 7 — White/Black): `LINE`
  - `DOORS` (Color 3 — Green): `LINE` (leaf) + `ARC` (exact 90° swing)
  - `WINDOWS` (Color 5 — Blue): `LINE` (frame & glazing)
  - `OPENINGS` (Color 6 — Magenta): `LINE` (archway jambs & dashed span)
  - `STAIRS` (Color 1 — Red): `LINE` (perimeter, treads, direction arrow) + `TEXT` (`UP`)
  - `ROOMS` (Color 4 — Cyan): `TEXT` (room name + area)
  - `DIMENSIONS` (Color 8 — Gray): `LINE` + `TEXT`
  - `NOTES` (Color 2 — Yellow): `TEXT`
