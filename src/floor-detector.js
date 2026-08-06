import { buildHistogram, findPeaks, smoothHistogram } from './utils/histogram.js';

/**
 * Detects floor levels in the 3D model.
 * 
 * @param {Array} meshes - Array of meshes.
 * @param {string} upAxis - The detected up axis ('+y', '-y', '+z', etc.).
 * @returns {Array} Array of floors sorted by height.
 */
export function detectFloors(meshes, upAxis) {
  if (!meshes || meshes.length === 0 || !upAxis) {
    return [];
  }

  const heights = [];
  const axisDim = upAxis[1]; // 'x', 'y', or 'z'
  const sign = upAxis[0] === '-' ? -1 : 1;

  const getAxisValue = (x, y, z) => {
    if (axisDim === 'x') return x * sign;
    if (axisDim === 'y') return y * sign;
    return z * sign;
  };

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

      // Compute face normal via cross product
      const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
      const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        nx /= len; ny /= len; nz /= len;
      }

      const upDot = getAxisValue(nx, ny, nz);
      
      if (upDot > 0.85) {
        // Horizontal face facing up
        const cx = (v0x + v1x + v2x) / 3;
        const cy = (v0y + v1y + v2y) / 3;
        const cz = (v0z + v1z + v2z) / 3;
        
        heights.push(getAxisValue(cx, cy, cz));
      }
    }
  }

  if (heights.length === 0) return [];

  // 0.05m bin size
  const hist = buildHistogram(heights, 0.05);
  const smoothedHist = smoothHistogram(hist, 2); // window of 2 bins each side
  const peaks = findPeaks(smoothedHist, Math.max(5, heights.length * 0.005), 0.5); // min 5 faces or 0.5% of total, 0.5m separation
  
  if (!peaks || peaks.length === 0) return [];

  peaks.sort((a, b) => a.value - b.value); // Sort peaks by height value

  const floors = [];
  let floorIndex = 1;

  for (let i = 0; i < peaks.length; i++) {
    const floorPeak = peaks[i];
    
    if (floorPeak.usedAsCeiling) continue;

    // Attempt to find a ceiling
    let ceilingPeak = null;
    for (let j = i + 1; j < peaks.length; j++) {
      const diff = peaks[j].value - floorPeak.value;
      if (diff >= 2.0 && diff <= 4.0) {
        ceilingPeak = peaks[j];
        break; // Assume first valid peak above is ceiling
      }
    }

    const ceilingHeight = ceilingPeak ? ceilingPeak.value : floorPeak.value + 3.0;
    
    if (ceilingPeak) {
      ceilingPeak.usedAsCeiling = true;
    }

    floors.push({
      name: `Floor ${floorIndex++}`,
      floorHeight: floorPeak.value,
      ceilingHeight: ceilingHeight,
      sliceHeight: floorPeak.value + 1.0
    });
  }

  return floors;
}
