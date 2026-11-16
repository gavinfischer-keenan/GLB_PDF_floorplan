/**
 * Unit formatting helpers (Imperial & Metric)
 */

/**
 * Formats a distance in meters as Feet & Inches (e.g., 3.77m -> 12' 4").
 * @param {number} meters - Distance in meters
 * @returns {string} Formatted string in feet and inches
 */
export function formatFeetInches(meters) {
  if (meters == null || Number.isNaN(meters)) return '0\' 0"';
  const totalInches = Math.round(meters * 39.3701);
  const absInches = Math.abs(totalInches);
  const feet = Math.floor(absInches / 12);
  const inches = absInches % 12;
  const sign = meters < 0 && absInches > 0 ? '-' : '';
  return `${sign}${feet}' ${inches}"`;
}

/**
 * Formats a distance in meters according to the selected unit system.
 * @param {number} meters - Distance in meters
 * @param {'imperial'|'metric'} [units='imperial'] - Display unit system
 * @returns {string}
 */
export function formatDistance(meters, units = 'imperial') {
  if (units === 'metric') {
    if (meters == null || Number.isNaN(meters)) return '0.00 m';
    const abs = Math.abs(meters);
    if (abs > 0 && abs < 1) {
      return `${Math.round(meters * 100)} cm`;
    }
    return `${meters.toFixed(2)} m`;
  }
  return formatFeetInches(meters);
}

/**
 * Formats an area in square meters according to the selected unit system.
 * @param {number} sqMeters - Area in square meters
 * @param {'imperial'|'metric'} [units='imperial'] - Display unit system
 * @returns {string}
 */
export function formatArea(sqMeters, units = 'imperial') {
  if (sqMeters == null || Number.isNaN(sqMeters)) {
    return units === 'metric' ? '0.0 m²' : '0 sq ft';
  }
  if (units === 'metric') {
    return `${sqMeters.toFixed(1)} m²`;
  }
  return `${Math.round(sqMeters * 10.7639)} sq ft`;
}
