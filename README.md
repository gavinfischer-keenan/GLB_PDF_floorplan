# FloorPlan Extractor — GLB to Architectural Blueprint

FloorPlan Extractor is a web-based, client-side tool designed to automatically extract professional 2D architectural blueprint PDF floor plans from 3D scan files in `.glb` format. Using Three.js for 3D processing, D3.js for interactive SVG layout editing, and jsPDF for vector rendering, it guides users through a clean, 5-step wizard interface.

---

## Key Features

- **3D Scan Loading**: Drag and drop `.glb` files for client-side processing.
- **Intelligent Up-Direction Detection**: Automatic orientation detection using face-normal voting and aspect-ratio heuristics, with a manual override interface.
- **Histogram-Based Floor Level Detection**: Automated detection of floor levels and height offsets from vertex distribution density.
- **Interactive SVG Blueprint Editor**: Fine-tune generated walls, draw new walls, erase unwanted features, measure distances, and name rooms.
- **Professional Blueprint Export**: Generate landscape drawings (A3/A4/Letter/Tabloid) with standard architectural title blocks, dynamic scale bars, and automated dimension lines.

---

## The 5-Step Pipeline

1. **Load**: Select a `.glb` file. The app validates and parses the 3D scene geometry.
2. **Orient**: Confirm the "up" vector of the model (detected via face normal distribution) to align coordinate systems.
3. **Floors**: Slices the model to locate floor-ceiling heights and selects which levels to process.
4. **Edit**: Reviews auto-detected wall segments and room structures, allows manual modification, and adjusts slice heights.
5. **Export**: Customizes scale, paper size, and metadata, generating a vector-quality PDF blueprint.

---

## Tech Stack

- **Bundler & Dev Server**: [Vite](https://vite.dev/)
- **3D Engine**: [Three.js](https://threejs.org/) & [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)
- **Vector Graphics & UI Interaction**: [D3.js](https://d3js.org/)
- **PDF Generation**: [jsPDF](https://github.com/parallax/jsPDF) & [svg2pdf.js](https://github.com/yWorks/svg2pdf.js/)
- **Testing**: [Vitest](https://vitest.dev/)
- **Styling**: Vanilla CSS with modern custom properties (CSS variables).

---

## Getting Started

### Prerequisites

You need [Node.js](https://nodejs.org/) installed on your machine.

### Installation

Clone the repository and install dependencies:

```bash
npm install
```

### Development Server

Start the local Vite development server:

```bash
npm run dev
```

### Production Build

Build and optimize the application for deployment:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

### Running Tests

Run the automated Vitest test suite:

```bash
npm run test
```
