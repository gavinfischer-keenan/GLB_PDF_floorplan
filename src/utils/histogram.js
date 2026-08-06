/**
 * 1D Histogram utility functions
 */

/**
 * Builds a histogram from numeric values.
 * @param {number[]} values Array of numeric values
 * @param {number} binSize Size of each bin
 * @returns {Map<number, number>} Map of bin key (center or start) to count
 */
export function buildHistogram(values, binSize) {
    const histogram = new Map();
    for (const value of values) {
        const bin = Math.floor(value / binSize) * binSize;
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
        .filter(entry => entry.count >= minCount)
        .sort((a, b) => b.count - a.count);

    const peaks = [];
    
    for (const entry of entries) {
        let isIsolated = true;
        for (const peak of peaks) {
            if (Math.abs(entry.bin - peak.bin) < minSeparation) {
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
 * @param {number} windowSize Number of adjacent bins to include on each side (e.g., 1 means 3 bins total)
 * @returns {Map<number, number>} Smoothed histogram
 */
export function smoothHistogram(histogram, windowSize) {
    const smoothed = new Map();
    const bins = Array.from(histogram.keys()).sort((a, b) => a - b);
    
    if (bins.length === 0) return smoothed;
    
    let binSize = 1;
    if (bins.length > 1) {
        binSize = bins[1] - bins[0];
    }

    for (const bin of bins) {
        let sum = 0;
        let count = 0;
        
        for (let i = -windowSize; i <= windowSize; i++) {
            const neighborBin = bin + i * binSize;
            if (histogram.has(neighborBin)) {
                sum += histogram.get(neighborBin);
            }
            count++;
        }
        
        smoothed.set(bin, sum / count);
    }
    
    return smoothed;
}
