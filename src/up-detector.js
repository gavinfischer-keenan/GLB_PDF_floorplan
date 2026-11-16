/**
 * Auto-detects which direction is 'up' in a loaded 3D model.
 * Uses sqrt-free squared-threshold normal voting and bounding-box aspect ratio heuristics.
 *
 * @param {Array} meshes - Array of meshes from GLBLoader.
 * @param {Object} bounds - Bounding box { min: { x, y, z }, max: { x, y, z } }.
 * @returns {{ axis: string, confidence: number, counts: Object<string, number> }}
 */
export function detectUpDirection(meshes, bounds) {
  const counts = { '+x': 0, '-x': 0, '+y': 0, '-y': 0, '+z': 0, '-z': 0 };
  if (!meshes || meshes.length === 0) {
    return { axis: '+y', confidence: 0, counts };
  }

  // dot > 0.85 <=> (n_c)^2 > 0.7225 * |n|^2; since 0.7225 > 0.5, at most one axis can satisfy this per triangle.
  const DOT_THRESHOLD_SQ = 0.85 * 0.85;

  for (let m = 0; m < meshes.length; m++) {
    const { positions, indices } = meshes[m];
    if (!positions) continue;

    const numTriangles = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
    for (let i = 0; i < numTriangles; i++) {
      let i0, i1, i2;
      if (indices) {
        const base = i * 3;
        i0 = indices[base] * 3;
        i1 = indices[base + 1] * 3;
        i2 = indices[base + 2] * 3;
      } else {
        i0 = i * 9;
        i1 = i0 + 3;
        i2 = i0 + 6;
      }

      const v0x = positions[i0];
      const v0y = positions[i0 + 1];
      const v0z = positions[i0 + 2];

      const e1x = positions[i1] - v0x;
      const e1y = positions[i1 + 1] - v0y;
      const e1z = positions[i1 + 2] - v0z;

      const e2x = positions[i2] - v0x;
      const e2y = positions[i2 + 1] - v0y;
      const e2z = positions[i2 + 2] - v0z;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      const lenSq = nx * nx + ny * ny + nz * nz;
      if (lenSq === 0) continue;

      const thresholdSq = DOT_THRESHOLD_SQ * lenSq;
      if (nx * nx > thresholdSq) {
        counts[nx > 0 ? '+x' : '-x']++;
      } else if (ny * ny > thresholdSq) {
        counts[ny > 0 ? '+y' : '-y']++;
      } else if (nz * nz > thresholdSq) {
        counts[nz > 0 ? '+z' : '-z']++;
      }
    }
  }

  // Default preference for glTF standard (+y) to prevent vertical walls from outvoting horizontal floors.
  const yCount = counts['+y'];
  let bestAxis = '+y';
  let maxWeightedCount = yCount * 2.5;

  const axisNames = ['+x', '-x', '+y', '-y', '+z', '-z'];
  for (let i = 0; i < axisNames.length; i++) {
    const axisName = axisNames[i];
    if (axisName === '+y') continue;
    const count = counts[axisName];
    if (count > maxWeightedCount) {
      maxWeightedCount = count;
      bestAxis = axisName;
    }
  }

  let totalVotes = 0;
  let rawMax = 0;
  for (let i = 0; i < axisNames.length; i++) {
    const c = counts[axisNames[i]];
    totalVotes += c;
    if (c > rawMax) rawMax = c;
  }

  let confidence = totalVotes > 0 ? rawMax / totalVotes : 0.8;

  // Aspect-ratio heuristic: buildings are typically shorter along their vertical axis than horizontally.
  if (bounds && bounds.min && bounds.max) {
    const sx = bounds.max.x - bounds.min.x;
    const sy = bounds.max.y - bounds.min.y;
    const sz = bounds.max.z - bounds.min.z;
    const minSpan = Math.min(sx, sy, sz);
    const axisChar = bestAxis[1];
    const bestSpan = axisChar === 'x' ? sx : axisChar === 'y' ? sy : sz;
    if (Math.max(sx, sy, sz) > 0 && bestSpan <= minSpan + 1e-6) {
      confidence = Math.min(1, confidence + 0.2);
    }
  }

  return { axis: bestAxis, confidence, counts };
}
