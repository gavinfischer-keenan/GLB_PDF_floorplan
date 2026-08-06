import { buildHistogram, findPeaks, smoothHistogram } from './utils/histogram.js';

/**
 * Detects the single primary floor level in the 3D model.
 * Returns the lowest significant horizontal surface as the floor.
 * 
 * @param {Array} meshes - Array of meshes.
 * @param {string} upAxis - The detected up axis ('+y', '-y', '+z', etc.).
 * @returns {{ name: string, floorHeight: number, ceilingHeight: number, sliceHeight: number } | null}
 */
export function detectFloor(meshes, upAxis) {
  if (!meshes || meshes.length === 0 || !upAxis) {
    return null;
  }

  const heights = [];
  const axisDim = upAxis[1]; // 'x', 'y', or 'z'
  const sign = upAxis[0] === '-' ? -1 : 1;

  const getAxisValue = (x, y, z) => {
    if (axisDim === 'x') return x * sign;
    if (axisDim === 'y') return y * sign;
    return z * sign;
  };

  // Also track the raw axis coordinate (not sign-adjusted) for accurate slicing
  const axisIdx = axisDim === 'x' ? 0 : axisDim === 'y' ? 1 : 2;

  // Track raw heights (actual model coordinates along the up axis)
  const rawHeights = [];

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
        // Horizontal face pointing up — this is a floor surface
        const cx = (v0x + v1x + v2x) / 3;
        const cy = (v0y + v1y + v2y) / 3;
        const cz = (v0z + v1z + v2z) / 3;
        
        const signedH = getAxisValue(cx, cy, cz);
        heights.push(signedH);

        // Raw model coordinate along the up axis
        const raw = [cx, cy, cz][axisIdx];
        rawHeights.push(raw);
      }
    }
  }

  if (heights.length === 0) return null;

  // Find the lowest horizontal surface — that's the floor
  const hist = buildHistogram(heights, 0.05);
  const smoothedHist = smoothHistogram(hist, 2);
  const peaks = findPeaks(smoothedHist, Math.max(3, heights.length * 0.003), 0.3);
  
  if (!peaks || peaks.length === 0) {
    // Fallback: just use the minimum height
    const minHeight = Math.min(...heights);
    const minRaw = Math.min(...rawHeights);
    return {
      name: 'Floor 1',
      floorHeight: minRaw,
      ceilingHeight: minRaw + sign * 3.0,
      sliceHeight: minRaw + sign * 1.0,
    };
  }

  // Sort peaks by value (lowest first for positive up, highest first for negative)
  peaks.sort((a, b) => a.value - b.value);

  // The lowest peak is the floor
  const floorPeak = peaks[0];

  // Convert signed height back to raw model coordinate
  const floorRaw = floorPeak.value * sign;

  // Try to find a ceiling (next peak 2-4m above the floor)
  let ceilingRaw = floorRaw + sign * 3.0; // default 3m ceiling
  for (let j = 1; j < peaks.length; j++) {
    const diff = peaks[j].value - floorPeak.value;
    if (diff >= 2.0 && diff <= 4.5) {
      ceilingRaw = peaks[j].value * sign;
      break;
    }
  }

  return {
    name: 'Floor 1',
    floorHeight: floorRaw,
    ceilingHeight: ceilingRaw,
    sliceHeight: floorRaw + sign * 1.0, // 1m above floor in model coordinates
  };
}
