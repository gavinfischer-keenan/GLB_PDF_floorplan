/**
 * Persistent application store for settings and recent scans/plans.
 * Safe in both browser (localStorage) and headless test environments.
 */
import { DEFAULT_SETTINGS, SETTING_GROUPS } from '../config/defaults.js';

export const SETTINGS_STORAGE_KEY = 'scallop_settings_v1';
export const RECENT_STORAGE_KEY = 'scallop_recent_items_v1';
export const MAX_RECENT_ITEMS = 8;

const FIELD_META_BY_KEY = new Map();
for (const group of SETTING_GROUPS) {
  for (const field of group.fields) {
    FIELD_META_BY_KEY.set(field.key, field);
  }
}

function getDefaultStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access blocked
  }
  return null;
}

function normalizeSettings(raw = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  return {
    units: merged.units === 'metric' ? 'metric' : 'imperial',
    snapAngle: [0, 45, 90].includes(Number(merged.snapAngle)) ? Number(merged.snapAngle) : DEFAULT_SETTINGS.snapAngle,
    showGrid: typeof merged.showGrid === 'boolean' ? merged.showGrid : DEFAULT_SETTINGS.showGrid,
    showRooms: typeof merged.showRooms === 'boolean' ? merged.showRooms : DEFAULT_SETTINGS.showRooms,
    snapToGeometry: typeof merged.snapToGeometry === 'boolean' ? merged.snapToGeometry : DEFAULT_SETTINGS.snapToGeometry,
    defaultSliceOffset: [0.6, 1.0, 1.4, 1.8].includes(Number(merged.defaultSliceOffset))
      ? Number(merged.defaultSliceOffset)
      : DEFAULT_SETTINGS.defaultSliceOffset,
    roomMergeTolerance: [0.02, 0.05, 0.1].includes(Number(merged.roomMergeTolerance))
      ? Number(merged.roomMergeTolerance)
      : DEFAULT_SETTINGS.roomMergeTolerance,
    wallSimplification: [0, 0.01, 0.02, 0.05].includes(Number(merged.wallSimplification))
      ? Number(merged.wallSimplification)
      : DEFAULT_SETTINGS.wallSimplification,
    defaultPaperSize: ['a4', 'a3', 'letter', 'tabloid'].includes(merged.defaultPaperSize)
      ? merged.defaultPaperSize
      : DEFAULT_SETTINGS.defaultPaperSize,
    defaultScale: ['auto', '24', '48', '96', '50', '100', '200'].includes(String(merged.defaultScale))
      ? String(merged.defaultScale)
      : DEFAULT_SETTINGS.defaultScale,
  };
}

function formatSettingDisplay(key, value) {
  const meta = FIELD_META_BY_KEY.get(key);
  if (!meta) return String(value);
  if (meta.type === 'checkbox') {
    return value ? 'Enabled' : 'Disabled';
  }
  const opt = meta.options?.find((o) => String(o.value) === String(value));
  return opt ? opt.label : String(value);
}

/**
 * Load user settings merged with defaults.
 * @param {Storage|null} [storage]
 * @returns {Object}
 */
export function loadSettings(storage = getDefaultStorage()) {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Compute human-readable differences between two settings objects.
 * @param {Object} prevSettings
 * @param {Object} nextSettings
 * @returns {Array<{ key: string, label: string, from: any, to: any, fromLabel: string, toLabel: string }>}
 */
export function diffSettings(prevSettings, nextSettings) {
  const prev = normalizeSettings(prevSettings);
  const next = normalizeSettings(nextSettings);
  const changes = [];

  for (const [key, meta] of FIELD_META_BY_KEY.entries()) {
    if (prev[key] !== next[key]) {
      changes.push({
        key,
        label: meta.label,
        from: prev[key],
        to: next[key],
        fromLabel: formatSettingDisplay(key, prev[key]),
        toLabel: formatSettingDisplay(key, next[key]),
      });
    }
  }
  return changes;
}

/**
 * Persist updated settings and return the new settings plus list of changed fields.
 * @param {Object} nextSettings
 * @param {Storage|null} [storage]
 * @returns {{ settings: Object, changes: Array }}
 */
export function saveSettings(nextSettings, storage = getDefaultStorage()) {
  const prev = loadSettings(storage);
  const normalized = normalizeSettings(nextSettings);
  const changes = diffSettings(prev, normalized);

  if (storage) {
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }

  return { settings: normalized, changes };
}

/**
 * Reset all settings back to factory defaults.
 * @param {Storage|null} [storage]
 * @returns {{ settings: Object, changes: Array }}
 */
export function resetSettings(storage = getDefaultStorage()) {
  return saveSettings({ ...DEFAULT_SETTINGS }, storage);
}

/**
 * Load recent scan/plan items sorted by most recent first.
 * @param {Storage|null} [storage]
 * @returns {Array<Object>}
 */
export function loadRecentItems(storage = getDefaultStorage()) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Record a scan or plan in recent history (deduplicated by name + sourceType).
 * @param {Object} item
 * @param {Storage|null} [storage]
 * @returns {Array<Object>}
 */
export function addRecentItem(item, storage = getDefaultStorage()) {
  if (!item || !item.name) return loadRecentItems(storage);
  const current = loadRecentItems(storage);

  const entry = {
    id: item.id || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: item.name,
    sourceType: item.sourceType || 'file',
    samplePath: item.samplePath || null,
    totalTriangles: item.totalTriangles || 0,
    wallCount: item.wallCount || 0,
    roomCount: item.roomCount || 0,
    floorCount: item.floorCount || (Array.isArray(item.floorsSnapshot) ? item.floorsSnapshot.length : 1),
    timestamp: item.timestamp || new Date().toISOString(),
    metadata: item.metadata || null,
    floorPlanSnapshot: item.floorPlanSnapshot || null,
    floorsSnapshot: item.floorsSnapshot || null,
  };

  const filtered = current.filter(
    (existing) => !(existing.name === entry.name && existing.sourceType === entry.sourceType)
  );
  const updated = [entry, ...filtered].slice(0, MAX_RECENT_ITEMS);

  if (storage) {
    try {
      storage.setItem(RECENT_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Retry without snapshot payloads if localStorage quota is tight
      try {
        const lightweight = updated.map((u, idx) =>
          idx === 0 ? u : { ...u, floorPlanSnapshot: null, floorsSnapshot: null }
        );
        storage.setItem(RECENT_STORAGE_KEY, JSON.stringify(lightweight));
      } catch {
        // Ignore if storage is completely unavailable
      }
    }
  }

  return updated;
}

/**
 * Clear all recent items.
 * @param {Storage|null} [storage]
 * @returns {Array}
 */
export function clearRecentItems(storage = getDefaultStorage()) {
  if (storage) {
    try {
      storage.removeItem(RECENT_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  return [];
}
