import { buildHistogram, findPeaks, smoothHistogram } from './utils/histogram.js';

const BIN_SIZE = 0.05;
const DOT_THRESHOLD_SQ = 0.85 * 0.85;

/**
 * Detects one or more floor levels in the 3D model using horizontal-face height histograms.
 * Excludes top-most roof/ceiling surfaces when insufficient geometry exists above them.
 *
 * @param {Array} meshes - Array of meshes.
 * @param {string} upAxis - The detected up axis ('+y', '-y', '+z', etc.).
 * @param {{ sliceOffset?: number }} [options] - Optional slice offset above floor in meters.
 * @returns {Array<{ name: string, floorHeight: number, ceilingHeight: number, sliceHeight: number, sliceOffset: number }>}
 */
export function detectFloors(meshes, upAxis, options = {}) {
  if (!meshes || meshes.length === 0 || !upAxis) {
    return [];
  }

  const sliceOffset = typeof options.sliceOffset === 'number' && options.sliceOffset > 0
    ? options.sliceOffset
    : 1.0;

  const axisDim = upAxis[1]; // 'x', 'y', or 'z'
  const sign = upAxis[0] === '-' ? -1 : 1;
  const axisIdx = axisDim === 'x' ? 0 : axisDim === 'y' ? 1 : 2;

  const signedHeights = [];
  let maxSignedCoord = -Infinity;

  for (let m = 0; m < meshes.length; m++) {
    const mesh = meshes[m];
    const { positions, indices, bounds } = mesh;
    if (!positions) continue;

    if (bounds && bounds.min && bounds.max) {
      const meshMaxSigned = sign > 0 ? bounds.max[axisIdx] : -bounds.min[axisIdx];
      if (meshMaxSigned > maxSignedCoord) maxSignedCoord = meshMaxSigned;
    } else {
      for (let v = axisIdx; v < positions.length; v += 3) {
        const s = positions[v] * sign;
        if (s > maxSignedCoord) maxSignedCoord = s;
      }
    }

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

      const normalComp = axisIdx === 0 ? nx : axisIdx === 1 ? ny : nz;
      const upComp = normalComp * sign;

      if (upComp > 0 && upComp * upComp > DOT_THRESHOLD_SQ * lenSq) {
        const centroidAxis = (positions[i0 + axisIdx] + positions[i1 + axisIdx] + positions[i2 + axisIdx]) / 3;
        signedHeights.push(centroidAxis * sign);
      }
    }
  }

  if (signedHeights.length === 0) return [];

  const hist = buildHistogram(signedHeights, BIN_SIZE);
  const smoothedHist = smoothHistogram(hist, 2, BIN_SIZE);
  const peaks = findPeaks(smoothedHist, Math.max(3, signedHeights.length * 0.003), 0.3);

  if (!peaks || peaks.length === 0) {
    let minSigned = signedHeights[0];
    for (let i = 1; i < signedHeights.length; i++) {
      if (signedHeights[i] < minSigned) minSigned = signedHeights[i];
    }
    const floorRaw = minSigned * sign;
    return [
      {
        name: 'Floor 1',
        floorHeight: floorRaw,
        ceilingHeight: floorRaw + sign * 3.0,
        sliceHeight: floorRaw + sign * sliceOffset,
        sliceOffset,
      },
    ];
  }

  peaks.sort((a, b) => a.value - b.value);

  const floorPeaks = [peaks[0]];
  for (let i = 1; i < peaks.length; i++) {
    const candidate = peaks[i];
    const lastFloor = floorPeaks[floorPeaks.length - 1];
    // Accept additional stories only when separated by >= 2.0m and with >= 1.2m of walls/structure above
    if (candidate.value - lastFloor.value >= 2.0 && maxSignedCoord - candidate.value >= 1.2) {
      floorPeaks.push(candidate);
    }
  }

  return floorPeaks.map((fp, idx) => {
    const floorRaw = fp.value * sign;
    let ceilingRaw = floorRaw + sign * 3.0;
    for (let j = 0; j < peaks.length; j++) {
      const diff = peaks[j].value - fp.value;
      if (diff >= 2.0 && diff <= 4.5) {
        ceilingRaw = peaks[j].value * sign;
        break;
      }
    }
    return {
      name: `Floor ${idx + 1}`,
      floorHeight: floorRaw,
      ceilingHeight: ceilingRaw,
      sliceHeight: floorRaw + sign * sliceOffset,
      sliceOffset,
    };
  });
}

/**
 * Detects the single primary floor level in the 3D model.
 * Returns the lowest significant horizontal surface as the floor.
 *
 * @param {Array} meshes - Array of meshes.
 * @param {string} upAxis - The detected up axis ('+y', '-y', '+z', etc.).
 * @param {{ sliceOffset?: number }} [options] - Optional slice offset above floor in meters.
 * @returns {{ name: string, floorHeight: number, ceilingHeight: number, sliceHeight: number, sliceOffset: number } | null}
 */
export function detectFloor(meshes, upAxis, options = {}) {
  const floors = detectFloors(meshes, upAxis, options);
  return floors[0] || null;
}
