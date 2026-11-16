// Cross-section extraction: slices 3D meshes at a given height to produce 2D wall segments

/**
 * Computes and caches per-mesh world axis bounds when missing.
 * @param {Object} mesh
 * @returns {{ min: [number, number, number], max: [number, number, number] }}
 */
function getMeshBounds(mesh) {
  if (mesh.bounds && mesh.bounds.min && mesh.bounds.max) {
    return mesh.bounds;
  }
  const { positions } = mesh;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  mesh.bounds = {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
  return mesh.bounds;
}

/**
 * Extracts a 2D cross-section from an array of 3D meshes by slicing at a given height.
 * Uses per-mesh bounding-box culling and zero-allocation triangle intersection math.
 *
 * @param {Array<{positions: Float32Array, normals?: Float32Array, indices: Uint32Array|Uint16Array, bounds?: Object}>} meshes
 * @param {number} sliceHeight - The height at which to slice the meshes.
 * @param {string} upAxis - The up axis string ('+y', '-y', '+z', '-z', '+x', '-x').
 * @returns {{ segments: Array<[[number, number], [number, number]]>, bounds: {minX: number, minY: number, maxX: number, maxY: number} }}
 */
export function extractCrossSection(meshes, sliceHeight, upAxis) {
  if (!meshes || meshes.length === 0) {
    return { segments: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  const sign = upAxis.startsWith('-') ? -1 : 1;
  const axisChar = upAxis.slice(-1).toLowerCase();
  const axisIndex = axisChar === 'x' ? 0 : axisChar === 'y' ? 1 : 2;
  const uIndex = (axisIndex + 1) % 3;
  const vIndex = (axisIndex + 2) % 3;

  const rawSegments = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let m = 0; m < meshes.length; m++) {
    const mesh = meshes[m];
    const { positions, indices } = mesh;
    if (!positions || !indices || positions.length === 0) continue;

    // Skip entire mesh if slice plane does not intersect its bounding box along the up axis
    const meshBounds = getMeshBounds(mesh);
    if (sliceHeight < meshBounds.min[axisIndex] || sliceHeight > meshBounds.max[axisIndex]) {
      continue;
    }

    for (let i = 0; i < indices.length; i += 3) {
      const idx0 = indices[i] * 3;
      const idx1 = indices[i + 1] * 3;
      const idx2 = indices[i + 2] * 3;

      const p0Axis = positions[idx0 + axisIndex];
      const p1Axis = positions[idx1 + axisIndex];
      const p2Axis = positions[idx2 + axisIndex];

      // Fast raw-coordinate triangle rejection before signed distance math
      if (
        (p0Axis > sliceHeight && p1Axis > sliceHeight && p2Axis > sliceHeight) ||
        (p0Axis < sliceHeight && p1Axis < sliceHeight && p2Axis < sliceHeight) ||
        (p0Axis === sliceHeight && p1Axis === sliceHeight && p2Axis === sliceHeight)
      ) {
        continue;
      }

      const d0 = (p0Axis - sliceHeight) * sign;
      const d1 = (p1Axis - sliceHeight) * sign;
      const d2 = (p2Axis - sliceHeight) * sign;

      let count = 0;
      let ix0 = 0;
      let iy0 = 0;
      let ix1 = 0;
      let iy1 = 0;

      // Edge 0 -> 1
      if ((d0 > 0 && d1 <= 0) || (d0 <= 0 && d1 > 0)) {
        const t = d0 / (d0 - d1);
        ix0 = positions[idx0 + uIndex] + t * (positions[idx1 + uIndex] - positions[idx0 + uIndex]);
        iy0 = positions[idx0 + vIndex] + t * (positions[idx1 + vIndex] - positions[idx0 + vIndex]);
        count = 1;
      }

      // Edge 1 -> 2
      if ((d1 > 0 && d2 <= 0) || (d1 <= 0 && d2 > 0)) {
        const t = d1 / (d1 - d2);
        const px = positions[idx1 + uIndex] + t * (positions[idx2 + uIndex] - positions[idx1 + uIndex]);
        const py = positions[idx1 + vIndex] + t * (positions[idx2 + vIndex] - positions[idx1 + vIndex]);
        if (count === 0) {
          ix0 = px;
          iy0 = py;
          count = 1;
        } else {
          ix1 = px;
          iy1 = py;
          count = 2;
        }
      }

      // Edge 2 -> 0
      if (count < 2 && ((d2 > 0 && d0 <= 0) || (d2 <= 0 && d0 > 0))) {
        const t = d2 / (d2 - d0);
        const px = positions[idx2 + uIndex] + t * (positions[idx0 + uIndex] - positions[idx2 + uIndex]);
        const py = positions[idx2 + vIndex] + t * (positions[idx0 + vIndex] - positions[idx2 + vIndex]);
        if (count === 1) {
          ix1 = px;
          iy1 = py;
          count = 2;
        }
      }

      if (count === 2) {
        const dx = ix0 - ix1;
        const dy = iy0 - iy1;
        if (dx * dx + dy * dy >= 0.0001) {
          rawSegments.push([[ix0, iy0], [ix1, iy1]]);
          if (ix0 < minX) minX = ix0;
          if (ix1 < minX) minX = ix1;
          if (ix0 > maxX) maxX = ix0;
          if (ix1 > maxX) maxX = ix1;
          if (iy0 < minY) minY = iy0;
          if (iy1 < minY) minY = iy1;
          if (iy0 > maxY) maxY = iy0;
          if (iy1 > maxY) maxY = iy1;
        }
      }
    }
  }

  if (rawSegments.length === 0) {
    return { segments: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  return {
    segments: rawSegments,
    bounds: { minX, minY, maxX, maxY },
  };
}
