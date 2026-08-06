// Cross-section extraction: slices 3D meshes at a given height to produce 2D wall segments

/**
 * Extracts a 2D cross-section from an array of 3D meshes by slicing at a given height.
 * 
 * @param {Array<{positions: Float32Array, normals: Float32Array, indices: Uint32Array|Uint16Array}>} meshes - Array of mesh objects.
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

  let rawSegments = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const mesh of meshes) {
    const { positions, indices } = mesh;
    if (!positions || !indices) continue;

    for (let i = 0; i < indices.length; i += 3) {
      const idx0 = indices[i] * 3;
      const idx1 = indices[i + 1] * 3;
      const idx2 = indices[i + 2] * 3;

      const p0Axis = positions[idx0 + axisIndex];
      const p1Axis = positions[idx1 + axisIndex];
      const p2Axis = positions[idx2 + axisIndex];

      const d0 = (p0Axis - sliceHeight) * sign;
      const d1 = (p1Axis - sliceHeight) * sign;
      const d2 = (p2Axis - sliceHeight) * sign;

      // Skip if all vertices are on the same side of the slice plane
      if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0) || (d0 === 0 && d1 === 0 && d2 === 0)) {
        continue;
      }

      const intersections = [];
      const distances = [d0, d1, d2];
      const baseIndices = [idx0, idx1, idx2];

      for (let j = 0; j < 3; j++) {
        const next = (j + 1) % 3;
        const d_A = distances[j];
        const d_B = distances[next];

        if ((d_A > 0 && d_B <= 0) || (d_A <= 0 && d_B > 0)) {
          if (d_A === 0 && d_B === 0) continue;
          
          const t = d_A / (d_A - d_B);
          const iA = baseIndices[j];
          const iB = baseIndices[next];

          const pU = positions[iA + uIndex] + t * (positions[iB + uIndex] - positions[iA + uIndex]);
          const pV = positions[iA + vIndex] + t * (positions[iB + vIndex] - positions[iA + vIndex]);
          
          intersections.push([pU, pV]);
        }
      }

      if (intersections.length === 2) {
        const pt1 = intersections[0];
        const pt2 = intersections[1];
        
        // Filter out very short segments (length < 0.01m)
        const dx = pt1[0] - pt2[0];
        const dy = pt1[1] - pt2[1];
        const distSq = dx * dx + dy * dy;
        
        if (distSq >= 0.0001) {
          rawSegments.push([pt1, pt2]);
          
          minX = Math.min(minX, pt1[0], pt2[0]);
          maxX = Math.max(maxX, pt1[0], pt2[0]);
          minY = Math.min(minY, pt1[1], pt2[1]);
          maxY = Math.max(maxY, pt1[1], pt2[1]);
        }
      }
    }
  }

  if (rawSegments.length === 0) {
    return { segments: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  return {
    segments: rawSegments,
    bounds: { minX, minY, maxX, maxY }
  };
}
