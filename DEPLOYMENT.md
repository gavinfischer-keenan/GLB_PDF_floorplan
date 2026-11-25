# Bay Scallop deployment

This is a static, browser-side application. Node is needed only to build it; no application runtime, database, upload endpoint, or server GPU is required.

## Production build

Use Node 22 or newer (Vite 8 requirements apply).

```sh
npm ci
npm test -- --run
npm run build -- --base=/app/
```

Copy only `dist/` to the static server. At https://floorplan.11mosswood.us/app/ the reverse proxy strips `/app/` and serves these files. The root hostname serves the separate TripoFisch landing page. For a standalone root deployment, run `npm run build` instead.

Serve JavaScript and CSS with their normal MIME types, GLB as `model/gltf-binary`, and unknown files as 404. Use no-cache/revalidation for HTML and non-fingerprinted assets. Hashed build assets can be cached immutably. Keep third-party notices with the build. Do not serve source folders, node_modules, or private input scans.

Recommended Content-Security-Policy:

```
default-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

The supplied Dockerfile provides a standalone root deployment. Docker is optional; the public deployment uses Caddy static files. Only supplied `public/` samples enter the build. Root-level scan files are not published.

## Validation

All 63 unit and integration tests across 8 Vitest files (`tests/pipeline-e2e.test.js`, `tests/model-loader.test.js`, `tests/geometry.test.js`, `tests/detectors.test.js`, `tests/histogram.test.js`, `tests/plan-data-exporter.test.js`, `tests/vector-exporter.test.js`, and `tests/app-features.test.js`) pass, and `vite build` emits code-split chunks into `dist/` with no >500 kB chunk warnings.

Check generated plans against the source model and real measurements before using them for construction. Automatic extraction depends on scan quality.
