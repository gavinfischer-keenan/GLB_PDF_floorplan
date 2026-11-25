/**
 * Lightweight 3D scan/model format metadata helpers.
 * Zero external dependencies so Step 1 upload validation does not eagerly bundle Three.js.
 */

export const SUPPORTED_3D_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl', '.ply'];

/**
 * Returns true if the given filename has a supported 3D scan/model extension.
 * @param {string} filename
 * @returns {boolean}
 */
export function isSupported3DFile(filename) {
  if (!filename || typeof filename !== 'string') return false;
  const lower = filename.toLowerCase();
  return SUPPORTED_3D_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
