import { describe, it, expect } from 'vitest';
import {
    buildHistogram,
    findPeaks,
    smoothHistogram
} from '../src/utils/histogram.js';

describe('Histogram Utils', () => {
    describe('buildHistogram', () => {
        it('should build a correct histogram', () => {
            const values = [0.1, 0.12, 0.19, 0.31, 0.35, 1.5];
            const binSize = 0.1;
            const hist = buildHistogram(values, binSize);

            // Bins:
            // 0.1, 0.12, 0.19 -> bin 0.1 (count 3)
            // 0.31, 0.35 -> bin 0.3 (count 2)
            // 1.5 -> bin 1.5 (count 1)
            // Note: Map keys are Floats, so check values using approximate/exact keys depending on float division
            
            // Convert to object for easier matching (rounding keys to prevent float representation issues)
            const obj = {};
            for (const [bin, count] of hist.entries()) {
                obj[bin.toFixed(2)] = count;
            }

            expect(obj['0.10']).toBe(3);
            expect(obj['0.30']).toBe(2);
            expect(obj['1.50']).toBe(1);
        });
    });

    describe('smoothHistogram', () => {
        it('should smooth values using a moving average window', () => {
            const hist = new Map([
                [0, 10],
                [1, 20],
                [2, 30]
            ]);
            // windowSize = 1 means for each bin, average bin-1, bin, bin+1
            const smoothed = smoothHistogram(hist, 1);

            // For bin 0: neighbors -1 (0 count), 0 (10 count), 1 (20 count) -> sum = 30 -> avg = 30 / 3 = 10
            // For bin 1: neighbors 0 (10 count), 1 (20 count), 2 (30 count) -> sum = 60 -> avg = 60 / 3 = 20
            // For bin 2: neighbors 1 (20 count), 2 (30 count), 3 (0 count) -> sum = 50 -> avg = 50 / 3 = 16.67
            expect(smoothed.get(0)).toBeCloseTo(10, 2);
            expect(smoothed.get(1)).toBeCloseTo(20, 2);
            expect(smoothed.get(2)).toBeCloseTo(16.666, 2);
        });
    });

    describe('findPeaks', () => {
        it('should find peaks above minCount and separate them by minSeparation', () => {
            const hist = new Map([
                [0.0, 10],
                [0.1, 12], // Peak 1 candidate
                [0.2, 8],
                [1.0, 15], // Peak 2 candidate
                [1.1, 14]
            ]);

            // MinCount = 9, MinSeparation = 0.5
            const peaks = findPeaks(hist, 9, 0.5);

            expect(peaks.length).toBe(2);
            
            // Peak 1 should be around bin 1.0 (highest count 15)
            // Peak 2 should be around bin 0.1 (count 12)
            // findPeaks returns peaks sorted by value (bin value)
            expect(peaks[0].value).toBe(0.1);
            expect(peaks[0].count).toBe(12);

            expect(peaks[1].value).toBe(1.0);
            expect(peaks[1].count).toBe(15);
        });
    });
});
