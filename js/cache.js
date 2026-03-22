// ── cache.js ───────────────────────────────────────────────
// Isochrone result cache with 24-hour TTL stored in localStorage.

const CACHE_PREFIX  = 'ors-iso-v1:';
// TTL is defined in config.js as ORS_CACHE_TTL_MS — use that directly

/**
 * Cheap non-crypto hash of a string (djb2) for cache key disambiguation.
 * We don't need security — just a short fingerprint to tell keys apart.
 */
function _hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36); // unsigned 32-bit, base-36
}

/**
 * Build a stable cache key from mode + radiusKm + ORS key fingerprint.
 */
function _isoKey(mode, radiusKm) {
  const keyHash = _hashStr(localStorage.getItem('ors-key') || '');
  return CACHE_PREFIX + mode + ':' + radiusKm + ':' + keyHash;
}

/**
 * Read a cached isochrone GeoJSON.
 * Returns the parsed GeoJSON or null if missing / expired.
 */
function isochroneGetCache(mode, radiusKm) {
  try {
    const raw = localStorage.getItem(_isoKey(mode, radiusKm));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.ts || !entry.data) return null;
    if (Date.now() - entry.ts > ORS_CACHE_TTL_MS) {
      localStorage.removeItem(_isoKey(mode, radiusKm));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Store an isochrone GeoJSON in the cache.
 * Silently ignores quota errors.
 */
function isochroneSetCache(mode, radiusKm, geojson) {
  try {
    const entry = { ts: Date.now(), data: geojson };
    localStorage.setItem(_isoKey(mode, radiusKm), JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded – skip caching
  }
}

/**
 * Clear all cached isochrones (useful when ORS key changes).
 */
function isochroneClearCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    if (typeof showToast === 'function') showToast(`Cache geleert (${keysToRemove.length} Einträge)`);
  } catch {
    // ignore
  }
}

