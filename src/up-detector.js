/**
 * Auto-detects which direction is 'up' in a loaded 3D model.
 * 
 * @param {Array} meshes - Array of meshes from GLBLoader.
 * @param {Object} bounds - Bounding box { min: { x, y, z }, max: { x, y, z } }.
 * @returns {Object} Result object with up axis, confidence, and counts.
 */
export function detectUpDirection(meshes, bounds) {
  if (!meshes || meshes.length === 0) {
    return { axis: '+y', confidence: 0, counts: { '+x': 0, '-x': 0, '+y': 0, '-y': 0, '+z': 0, '-z': 0 } };
  }

  const counts = { '+x': 0, '-x': 0, '+y': 0, '-y': 0, '+z': 0, '-z': 0 };
  const axes = [
    { name: '+x', vec: [1, 0, 0] },
    { name: '-x', vec: [-1, 0, 0] },
    { name: '+y', vec: [0, 1, 0] },
    { name: '-y', vec: [0, -1, 0] },
    { name: '+z', vec: [0, 0, 1] },
    { name: '-z', vec: [0, 0, -1] }
  ];

  for (const mesh of meshes) {
    const { positions, indices } = mesh;
    if (!positions) continue;

    const numTriangles = indices ? indices.length / 3 : positions.length / 9;
    for (let i = 0; i < numTriangles; i++) {
      let v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z;
      
      if (indices) {
        const i0 = indices[i * 3] * 3;
        const i1 = indices[i * 3 + 1] * 3;
        const i2 = indices[i * 3 + 2] * 3;
        
        v0x = positions[i0]; v0y = positions[i0 + 1]; v0z = positions[i0 + 2];
        v1x = positions[i1]; v1y = positions[i1 + 1]; v1z = positions[i1 + 2];
        v2x = positions[i2]; v2y = positions[i2 + 1]; v2z = positions[i2 + 2];
      } else {
        const idx = i * 9;
        v0x = positions[idx]; v0y = positions[idx + 1]; v0z = positions[idx + 2];
        v1x = positions[idx + 3]; v1y = positions[idx + 4]; v1z = positions[idx + 5];
        v2x = positions[idx + 6]; v2y = positions[idx + 7]; v2z = positions[idx + 8];
      }

      // Edges
      const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
      const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

      // Cross product
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;

      // Normalize
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        nx /= len; ny /= len; nz /= len;
      }

      // Dot product with axes
      for (const axis of axes) {
        const dot = nx * axis.vec[0] + ny * axis.vec[1] + nz * axis.vec[2];
        if (dot > 0.85) {
          counts[axis.name]++;
        }
      }
    }
  }

  // Find axis with max count
  let maxCount = -1;
  let maxAxis = '+y';
  for (const axis of axes) {
    if (counts[axis.name] > maxCount) {
      maxCount = counts[axis.name];
      maxAxis = axis.name;
    }
  }

  if (!bounds || !bounds.min || !bounds.max) {
      const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
      return { axis: maxAxis, confidence: totalVotes > 0 ? maxCount / totalVotes : 0, counts };
  }

  // Bounding box heuristic
  const extents = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z
  };

  const isSmallestExtent = (axis) => {
    const dim = axis[1]; // 'x', 'y', or 'z'
    const ext = extents[dim];
    return ext <= extents.x && ext <= extents.y && ext <= extents.z;
  };

  const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
  const confidenceNormals = totalVotes > 0 ? maxCount / totalVotes : 0;
  
  let confidence = confidenceNormals;
  if (isSmallestExtent(maxAxis)) {
    confidence = Math.min(1.0, confidence + 0.2); // Boost confidence if it's the smallest extent
  }

  return { axis: maxAxis, confidence, counts };
}
