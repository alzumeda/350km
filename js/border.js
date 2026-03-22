// ── border.js ─────────────────────────────────────────────
// High-accuracy German border distance:
//   1. Static GeoJSON from data/de-border.json (repo-cached)
//   2. Aerial distance via Turf nearestPointOnLine (<1km error)
//   3. Driving distance + road-type breakdown via OSRM steps

const BORDER_CACHE_KEY = 'de-border-v3';
const BORDER_FILE      = './data/de-border.json';

let _borderReady   = false;
let _borderLoading = false; // Fix 2: prevent concurrent fetches
let _borderLine    = null;
let _borderPoly    = null;

// ── Road type classification ──────────────────────────────
// OSRM step classes map to these display buckets.
const ROAD_CLASSES = {
  motorway:       { label: '🛣 Autobahn',    group: 'motorway' },
  motorway_link:  { label: '🛣 Autobahn',    group: 'motorway' },
  trunk:          { label: '🛣 Schnellstr.',  group: 'motorway' },
  trunk_link:     { label: '🛣 Schnellstr.',  group: 'motorway' },
  primary:        { label: '🛤 Bundesstr.',   group: 'primary'  },
  primary_link:   { label: '🛤 Bundesstr.',   group: 'primary'  },
  secondary:      { label: '🛤 Landstraße',   group: 'secondary'},
  secondary_link: { label: '🛤 Landstraße',   group: 'secondary'},
  tertiary:       { label: '🏘 Kreisstr.',    group: 'tertiary' },
  tertiary_link:  { label: '🏘 Kreisstr.',    group: 'tertiary' },
  residential:    { label: '🏘 Stadtstraße',  group: 'urban'    },
  living_street:  { label: '🏘 Stadtstraße',  group: 'urban'    },
  unclassified:   { label: '🏘 Sonstige',     group: 'urban'    },
};

const GROUP_LABELS = {
  motorway:  '🛣 Autobahn / Schnellstr.',
  primary:   '🛤 Bundesstraße',
  secondary: '🛤 Landstraße',
  tertiary:  '🏘 Kreisstraße',
  urban:     '🏘 Stadtstraße / Sonstige',
};

// ── Load border ───────────────────────────────────────────

async function loadHighResBorder() {
  if (_borderReady || _borderLoading) return; // Fix 2: lock against concurrent calls
  _borderLoading = true;
  try {
    const cached = sessionStorage.getItem(BORDER_CACHE_KEY);
    if (cached) { _initFromGeoJSON(JSON.parse(cached)); return; }
  } catch { /* miss */ }

  try {
    showToast('Lade Grenzlinie…');
    const resp = await fetch(BORDER_FILE);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const geojson = await resp.json();
    _initFromGeoJSON(geojson);
    try { sessionStorage.setItem(BORDER_CACHE_KEY, JSON.stringify(geojson)); } catch { /* quota */ }
    showToast(`✓ Grenzlinie: ${_borderLine.geometry.coordinates.length} Punkte`);
  } catch (e) {
    console.warn('[border] fallback:', e.message);
    _initFromGeoJSON(GERMANY_BORDER);
    showToast('⚠ Vereinfachte Grenzlinie (Fallback)');
  } finally {
    _borderLoading = false; // Fix 2: always release lock
  }
}

// ── Aerial distance (sync) ────────────────────────────────

/**
 * Returns the single nearest border point (aerial).
 */
function aerialDistToBorder(lat, lng) {
  const { candidates } = _topNBorderCandidates(lat, lng, 1);
  if (!candidates.length) return { km: null, nearestPt: null };
  const best = candidates[0];
  return { km: best.aerialKm, nearestPt: best.pt };
}

/**
 * Returns the top-N nearest border points sorted by aerial distance.
 * Spreads candidates so they are at least minSpreadKm apart (avoids
 * clustering on the same section of border).
 */
// Fix 3: cache the low-res fallback line so we don't rebuild it on every call
let _fallbackLine = null;
let _fallbackPoly = GERMANY_BORDER;

function _topNBorderCandidates(lat, lng, n = 3, minSpreadKm = 30) {
  if (!_fallbackLine) _fallbackLine = turf.polygonToLine(GERMANY_BORDER);
  const line = _borderLine || _fallbackLine;
  const poly = _borderPoly || _fallbackPoly;
  const coords = line.geometry.coordinates;

  try {
    const pt     = turf.point([lng, lat]);
    const inside = turf.booleanPointInPolygon(pt, poly);

    // Score every border coordinate by aerial distance, pick spread-out top-N
    const scored = coords.map(c => ({
      pt:       c,
      aerialKm: turf.distance(pt, turf.point(c), { units: 'kilometers' }),
    })).sort((a, b) => a.aerialKm - b.aerialKm);

    // Greedily pick candidates that are at least minSpreadKm from each other
    const candidates = [];
    for (const s of scored) {
      if (candidates.length >= n) break;
      const tooClose = candidates.some(c =>
        turf.distance(turf.point(c.pt), turf.point(s.pt), { units: 'kilometers' }) < minSpreadKm
      );
      if (!tooClose) {
        candidates.push({ ...s, aerialKm: inside ? -s.aerialKm : s.aerialKm });
      }
    }
    return { candidates, inside };
  } catch {
    return { candidates: [], inside: false };
  }
}

// ── Driving distance + road breakdown (async) ─────────────

/**
 * Queries OSRM in parallel for top-3 nearest border candidates.
 * Returns the result with the shortest driving distance.
 * This avoids wrong snapping into impassable mountain terrain.
 *
 * Returns { driveKm, driveMin, nearestPt, aerialKm, roadBreakdown, candidatesUsed }
 */
async function drivingDistToBorder(lat, lng) {
  const { candidates } = _topNBorderCandidates(lat, lng, 3, 30);
  if (!candidates.length) return null;

  // Fire all OSRM requests in parallel
  const requests = candidates.map(c => _osrmRoute(lat, lng, c.pt, c.aerialKm));
  const results  = await Promise.all(requests);

  // Pick shortest driving distance among successful results
  const valid = results.filter(Boolean);
  if (!valid.length) return null;

  valid.sort((a, b) => a.driveKm - b.driveKm);
  const best = valid[0];
  best.candidatesUsed = valid.length; // how many candidates returned routes
  return best;
}

/**
 * Single OSRM route request with road-type steps.
 */
async function _osrmRoute(lat, lng, borderPt, aerialKm) {
  const [bLng, bLat] = borderPt;
  try {
    const url  = `https://router.project-osrm.org/route/v1/driving/` +
      `${lng},${lat};${bLng},${bLat}?overview=false&steps=true`;
    // Fix 6: 8s timeout so a hanging OSRM request doesn't block the UI indefinitely
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.code !== 'Ok' || !data.routes?.length) return null;

      const route = data.routes[0];
      const driveKm  = route.distance / 1000;
      const driveMin = Math.round(route.duration / 60);
      return {
        driveKm,
        driveMin,
        nearestPt:     borderPt,
        aerialKm,
        roadBreakdown: _parseRoadBreakdown(route.legs, driveKm),
      };
    } finally {
      clearTimeout(tid); // Fix 3: always clear timer regardless of outcome
    }
  } catch {
    return null;
  }
}

/**
 * Parse OSRM legs → steps → intersections to get km per road group.
 */
function _parseRoadBreakdown(legs, totalKm) {
  const groupKm = {};

  for (const leg of legs) {
    for (const step of (leg.steps || [])) {
      const dist = step.distance / 1000; // km
      if (dist <= 0) continue;

      // OSRM provides road class via step.ref or name; highway type via
      // step.intersections[0].classes or step.driving_side.
      // Most reliable: check step name for Autobahn pattern, or use
      // step.maneuver.type combined with distance heuristics.
      // Best available: step.intersections[0].classes array (motorway, etc.)
      const classes = step.intersections?.[0]?.classes || [];
      let group = 'urban'; // default

      if (classes.includes('motorway')) {
        group = 'motorway';
      } else if (classes.includes('trunk')) {
        group = 'motorway';
      } else if (step.ref && /^(A|B)\s*\d+/.test(step.ref)) {
        // Ref like "A3", "B42" → motorway or bundesstrasse
        group = step.ref.startsWith('A') ? 'motorway' : 'primary';
      } else if (step.name && /Autobahn|BAB/.test(step.name)) {
        group = 'motorway';
      } else if (step.name && /Bundesstraße|B \d/.test(step.name)) {
        group = 'primary';
      } else if (classes.includes('restricted') || classes.length === 0) {
        // No class info → estimate from speed
        const speedKmh = step.duration > 0 ? (step.distance / step.duration) * 3.6 : 0;
        if (speedKmh > 100)     group = 'motorway';
        else if (speedKmh > 70) group = 'primary';
        else if (speedKmh > 50) group = 'secondary';
        else                    group = 'urban';
      }

      groupKm[group] = (groupKm[group] || 0) + dist;
    }
  }

  // Build sorted breakdown array
  const order = ['motorway', 'primary', 'secondary', 'tertiary', 'urban'];
  return order
    .filter(g => groupKm[g] > 0)
    .map(g => ({
      group: g,
      label: GROUP_LABELS[g],
      km:    groupKm[g],
      pct:   Math.round((groupKm[g] / totalKm) * 100),
    }))
    .sort((a, b) => b.km - a.km);
}

// ── Two-phase callback ────────────────────────────────────

async function borderDistWithCallback(lat, lng, callback) {
  const { km, nearestPt } = aerialDistToBorder(lat, lng);
  callback({ aerialLabel: _fmtAerial(km), driveLabel: null, km, driving: null }, false);

  const driving = await drivingDistToBorder(lat, lng);
  callback({
    aerialLabel: _fmtAerial(km),
    driveLabel:  driving ? _fmtDriving(driving.driveKm, driving.driveMin) : null,
    km,
    driving,
  }, true);
}

// ── Formatters ────────────────────────────────────────────

function _fmtAerial(km) {
  if (km === null) return '–';
  if (km < 0) return `${Math.round(-km)} km (in DE)`;
  return `+${Math.round(km)} km`;
}

function _fmtDriving(km, min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const t = h > 0 ? `${h}h${m > 0 ? ' ' + m + 'min' : ''}` : `${min}min`;
  return `${km.toFixed(1)} km · ${t}`;
}

// ── Internal ──────────────────────────────────────────────

function _initFromGeoJSON(geojson) {
  let coords;
  if (geojson.type === 'Feature') {
    coords = geojson.geometry.coordinates[0];
  } else {
    coords = geojson.coordinates ? geojson.coordinates[0] : geojson.geometry.coordinates[0];
  }
  const ring = [...coords];
  if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
    ring.push(ring[0]);
  }
  _borderLine  = turf.lineString(ring);
  _borderPoly  = turf.polygon([ring]);
  _borderReady = true;
}
