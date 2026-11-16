/**
 * 1D Histogram utility functions
 */

const roundBin = (value) => {
  const rounded = Math.round(value * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
};

/**
 * Builds a histogram from numeric values with normalized bin keys to prevent float drift.
 * @param {number[]} values Array of numeric values
 * @param {number} binSize Size of each bin
 * @returns {Map<number, number>} Map of bin start to count
 */
export function buildHistogram(values, binSize) {
  const histogram = new Map();
  if (!values || values.length === 0 || !(binSize > 0)) return histogram;

  const invBinSize = 1 / binSize;
  for (let i = 0; i < values.length; i++) {
    const bin = roundBin(Math.floor(values[i] * invBinSize) * binSize);
    histogram.set(bin, (histogram.get(bin) || 0) + 1);
  }
  return histogram;
}

/**
 * Finds peaks in a histogram.
 * @param {Map<number, number>} histogram The histogram map
 * @param {number} minCount Minimum count to be considered a peak
 * @param {number} minSeparation Minimum distance between peaks
 * @returns {Array<{bin: number, count: number, value: number}>} Sorted array of peaks by bin value
 */
export function findPeaks(histogram, minCount, minSeparation) {
  const entries = Array.from(histogram.entries())
    .map(([bin, count]) => ({ bin, count, value: bin }))
    .filter((entry) => entry.count >= minCount)
    .sort((a, b) => b.count - a.count);

  const peaks = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let isIsolated = true;
    for (let j = 0; j < peaks.length; j++) {
      if (Math.abs(entry.bin - peaks[j].bin) < minSeparation) {
        isIsolated = false;
        break;
      }
    }
    if (isIsolated) {
      peaks.push(entry);
    }
  }

  return peaks.sort((a, b) => a.value - b.value);
}

/**
 * Smooths a histogram using a moving average window.
 * @param {Map<number, number>} histogram The histogram map
 * @param {number} windowSize Number of adjacent bins to include on each side
 * @param {number} [explicitBinSize] Optional known bin width (inferred from minimum bin gap if omitted)
 * @returns {Map<number, number>} Smoothed histogram
 */
export function smoothHistogram(histogram, windowSize, explicitBinSize = null) {
  const smoothed = new Map();
  const bins = Array.from(histogram.keys()).sort((a, b) => a - b);

  if (bins.length === 0) return smoothed;

  let binSize = explicitBinSize > 0 ? explicitBinSize : 1;
  if (!(explicitBinSize > 0) && bins.length > 1) {
    let minDiff = Infinity;
    for (let i = 1; i < bins.length; i++) {
      const diff = roundBin(bins[i] - bins[i - 1]);
      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
      }
    }
    if (Number.isFinite(minDiff)) {
      binSize = minDiff;
    }
  }

  const windowSpan = windowSize * 2 + 1;
  for (let bIdx = 0; bIdx < bins.length; bIdx++) {
    const bin = bins[bIdx];
    let sum = 0;

    for (let i = -windowSize; i <= windowSize; i++) {
      const neighborBin = roundBin(bin + i * binSize);
      const val = histogram.get(neighborBin);
      if (val !== undefined) {
        sum += val;
      }
    }

    smoothed.set(bin, sum / windowSpan);
  }

  return smoothed;
}
