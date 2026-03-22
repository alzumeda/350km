// ── border.js ─────────────────────────────────────────────
// High-accuracy German border:
//   - Loads static pre-built GeoJSON from repo (data/de-border.json)
//   - Falls back to built-in 50-point polygon if fetch fails
//   - Caches in sessionStorage across page reloads
//   - Aerial distance via Turf.js nearestPointOnLine (<1km error)
//   - Driving distance via OSRM to nearest border point

const BORDER_CACHE_KEY = 'de-border-v3';
const BORDER_FILE      = './data/de-border.json';

// ── Internal state ────────────────────────────────────────
let _borderReady  = false;
let _borderLine   = null;   // turf LineString (high-res)
let _borderPoly   = null;   // turf Polygon    (high-res)

// ── Public: load border ───────────────────────────────────

/**
 * Load high-res DE border from static file (cached in sessionStorage).
 * Non-blocking — call once at app start.
 */
async function loadHighResBorder() {
  if (_borderReady) return;

  // 1. Try sessionStorage cache
  try {
    const cached = sessionStorage.getItem(BORDER_CACHE_KEY);
    if (cached) {
      _initFromGeoJSON(JSON.parse(cached));
      console.log(`[border] Loaded from cache: ${_borderLine.geometry.coordinates.length} pts`);
      return;
    }
  } catch { /* cache miss or parse error */ }

  // 2. Load static file from repo
  try {
    showToast('Lade Grenzlinie…');
    const resp = await fetch(BORDER_FILE);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const geojson = await resp.json();
    _initFromGeoJSON(geojson);
    // Cache for session
    try { sessionStorage.setItem(BORDER_CACHE_KEY, JSON.stringify(geojson)); } catch { /* quota */ }
    const pts = _borderLine.geometry.coordinates.length;
    showToast(`✓ Grenzlinie: ${pts} Punkte geladen`);
    console.log(`[border] Loaded from file: ${pts} pts`);
  } catch (e) {
    // 3. Fallback: built-in simplified border from config.js
    console.warn('[border] Static file failed, using built-in:', e.message);
    _initFromGeoJSON(GERMANY_BORDER);
    showToast('⚠ Vereinfachte Grenzlinie (Fallback)');
  }
}

// ── Public: aerial distance ───────────────────────────────

/**
 * Returns distance in km from [lat, lng] to nearest border point.
 * Negative = inside Germany. Uses high-res border if loaded.
 * @returns {{ km: number|null, nearestPt: [lng,lat]|null }}
 */
function aerialDistToBorder(lat, lng) {
  const line = _borderLine || turf.polygonToLine(GERMANY_BORDER);
  const poly = _borderPoly || GERMANY_BORDER;
  try {
    const pt      = turf.point([lng, lat]);
    const nearest = turf.nearestPointOnLine(line, pt, { units: 'kilometers' });
    const d       = nearest.properties.dist;
    const inside  = turf.booleanPointInPolygon(pt, poly);
    return { km: inside ? -d : d, nearestPt: nearest.geometry.coordinates };
  } catch {
    return { km: null, nearestPt: null };
  }
}

// ── Public: driving distance ──────────────────────────────

/**
 * Computes driving distance + time from [lat,lng] to nearest border point via OSRM.
 * @returns {{ driveKm, driveMin, nearestPt, aerialKm }} or null
 */
async function drivingDistToBorder(lat, lng) {
  const { km, nearestPt } = aerialDistToBorder(lat, lng);
  if (!nearestPt) return null;

  const [bLng, bLat] = nearestPt;
  try {
    const url  = `https://router.project-osrm.org/route/v1/driving/${lng},${lat};${bLng},${bLat}?overview=false`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes?.length) return null;

    return {
      driveKm:  data.routes[0].distance / 1000,
      driveMin: Math.round(data.routes[0].duration / 60),
      nearestPt,
      aerialKm: km,
    };
  } catch {
    return null;
  }
}

/**
 * Two-phase border distance: calls callback immediately with aerial,
 * then again when driving result arrives.
 * callback({ aerialLabel, driveLabel, km, driving }, isDone)
 */
async function borderDistWithCallback(lat, lng, callback) {
  const { km, nearestPt } = aerialDistToBorder(lat, lng);
  callback({ aerialLabel: _fmtAerial(km), driveLabel: null, km }, false);

  const driving = await drivingDistToBorder(lat, lng);
  callback({
    aerialLabel: _fmtAerial(km),
    driveLabel:  driving ? _fmtDriving(driving.driveKm, driving.driveMin) : null,
    km,
    driving,
  }, true);
}

// ── Formatting helpers ────────────────────────────────────

function fmtBorderAerial(km) { return _fmtAerial(km); }
function fmtBorderDriving(km, min) { return _fmtDriving(km, min); }

function _fmtAerial(km) {
  if (km === null) return '–';
  if (km < 0) return `${Math.round(-km)} km (in DE)`;
  return `+${Math.round(km)} km Luftlinie`;
}

function _fmtDriving(km, min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const t = h > 0 ? `${h}h ${m}min` : `${min}min`;
  return `${km.toFixed(1)} km · ${t} zur Grenze`;
}

// ── Internal ──────────────────────────────────────────────

function _initFromGeoJSON(geojson) {
  let coords;
  // Accept both Feature<Polygon> and raw Polygon
  if (geojson.type === 'Feature') {
    coords = geojson.geometry.coordinates[0];
  } else if (geojson.geometry) {
    coords = geojson.geometry.coordinates[0];
  } else {
    coords = geojson.coordinates[0];
  }

  // Close ring if needed
  const ring = [...coords];
  if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
    ring.push(ring[0]);
  }

  _borderLine  = turf.lineString(ring);
  _borderPoly  = turf.polygon([ring]);
  _borderReady = true;
}
