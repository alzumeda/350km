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

// ── Real road border crossings ───────────────────────────
// These are actual Grenzübergänge (road border crossings) on main roads.
// Using these as OSRM targets gives accurate real-road distances to the border,
// unlike raw GeoJSON polygon points which may land on mountains or rivers.

// Coordinates verified to be AT or just beyond the actual border line
// (on the foreign side or exactly at the crossing point)
// This ensures OSRM routes end AT the border, not inside Germany.
const DE_BORDER_CROSSINGS = [
  // Netherlands — A/B road crossings
  { name: 'Bad Nieuweschans (NL)',  lat: 53.177, lng:  7.196, neighbor: 'NL' }, // at NL side
  { name: 'Venlo/A61 (NL)',         lat: 51.364, lng:  6.173, neighbor: 'NL' }, // Grenzweg, verified
  { name: 'Aachen/Vetschau A4',     lat: 50.779, lng:  5.985, neighbor: 'NL' }, // just over NL border
  // Belgium / Luxembourg
  { name: 'Aachen/Lichtenbusch',    lat: 50.727, lng:  6.032, neighbor: 'BE' }, // on BE side A44
  { name: 'Prüm/St.Vith B410',      lat: 50.157, lng:  6.227, neighbor: 'BE' }, // St. Vith side
  { name: 'Trier/Wasserbillig A1',   lat: 49.718, lng:  6.502, neighbor: 'LU' }, // at LU border
  // France
  { name: "Kehl/Pont de l'Europe",  lat: 48.591, lng:  7.789, neighbor: 'FR' }, // bridge midpoint
  { name: 'Saarbrücken/Goldene Bremm', lat: 49.200, lng: 6.939, neighbor: 'FR' }, // A320 crossing
  { name: 'Neuenburg/Chalampé A35',  lat: 47.817, lng:  7.558, neighbor: 'FR' }, // Rhine bridge
  // Switzerland
  { name: 'Basel/Hüningen A35',      lat: 47.608, lng:  7.567, neighbor: 'CH' }, // Rhine bridge
  { name: 'Konstanz/Kreuzlingen',    lat: 47.659, lng:  9.175, neighbor: 'CH' }, // at CH border
  { name: 'Lindau/St.Margrethen A96',lat: 47.538, lng:  9.703, neighbor: 'CH' }, // Rhine bridge
  // Austria
  { name: 'Walserberg/Salzburg A8',  lat: 47.780, lng: 13.008, neighbor: 'AT' }, // at AT border
  { name: 'Passau/Suben A3',         lat: 48.541, lng: 13.473, neighbor: 'AT' }, // at AT border
  { name: 'Kufstein/Kiefersfelden A93', lat: 47.591, lng: 12.173, neighbor: 'AT' }, // AT side
  { name: 'Füssen/Vils A7 AT',       lat: 47.552, lng: 10.709, neighbor: 'AT' }, // AT border
  // Czech Republic
  { name: 'Furth/Folmava A3',        lat: 49.319, lng: 12.836, neighbor: 'CZ' }, // at CZ border
  { name: 'Waidhaus/Rozvadov A6',    lat: 49.661, lng: 12.560, neighbor: 'CZ' }, // at CZ border
  { name: 'Zinnwald/Cinovec A17',    lat: 50.736, lng: 13.769, neighbor: 'CZ' }, // verified tunnel exit
  // Poland — Oder/Neisse river bridges
  { name: 'Frankfurt/Oder/Slubice A12', lat: 52.348, lng: 14.556, neighbor: 'PL' }, // Oder bridge
  { name: 'Görlitz/Zgorzelec A4',    lat: 51.152, lng: 15.002, neighbor: 'PL' }, // Neisse bridge
  { name: 'Pomellen/Kołbaskowo A11', lat: 53.493, lng: 14.367, neighbor: 'PL' }, // actual A11 crossing
  // Denmark — E45/A7
  { name: 'Ellund/Frøslev E45',      lat: 54.869, lng:  9.552, neighbor: 'DK' }, // verified at border
  { name: 'Kupfermühle/Padborg B200', lat: 54.833, lng:  9.375, neighbor: 'DK' }, // B200 crossing
];

// ── Live border crossings (Overpass) ─────────────────────

const CROSSINGS_CACHE_KEY = 'de-crossings-v1';
const CROSSINGS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
let _liveCrossings = null; // loaded once, then cached in memory

/**
 * Load all German border crossings from Overpass API.
 * Caches result 24h in localStorage. Falls back to DE_BORDER_CROSSINGS.
 */
async function loadLiveCrossings() {
  if (_liveCrossings) return; // already loaded this session

  // Check localStorage cache first
  try {
    const raw = localStorage.getItem(CROSSINGS_CACHE_KEY);
    if (raw) {
      const entry = JSON.parse(raw);
      if (entry && entry.ts && Date.now() - entry.ts < CROSSINGS_CACHE_TTL && entry.data?.length > 10) {
        _liveCrossings = entry.data;
    
        return;
      }
    }
  } catch { /* miss */ }

  // Fetch from Overpass
  const q = `[out:json][timeout:20];(node["barrier"="border_control"](47.2,5.8,55.1,15.1);node["amenity"="border_control"](47.2,5.8,55.1,15.1););out body;`;
  try {
    const resp = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`
    );
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const nodes = (data.elements || []).filter(e => e.type === 'node' && e.lat && e.lon);

    if (nodes.length < 10) throw new Error('Too few results: ' + nodes.length);

    // Map nodes to crossings — prefer name:de for German-side names
    const rawCrossings = nodes.map(n => ({
      name:     n.tags?.['name:de'] || n.tags?.name || 'Grenzübergang',
      lat:      n.lat,
      lng:      n.lon,
      neighbor: null,
    }));

    // Deduplicate: if two crossings are <1.5km apart, keep only one
    const deduped = [];
    for (const c of rawCrossings) {
      const tooClose = deduped.some(d =>
        Math.abs(d.lat - c.lat) < 0.015 && Math.abs(d.lng - c.lng) < 0.02
      );
      if (!tooClose) deduped.push(c);
    }

    _liveCrossings = deduped;

    // Cache result
    try {
      localStorage.setItem(CROSSINGS_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: _liveCrossings }));
    } catch { /* quota */ }


  } catch (e) {
    console.warn('[border] Overpass crossings failed, using hardcoded fallback:', e.message);
    _liveCrossings = null; // will use DE_BORDER_CROSSINGS
  }
}

/**
 * Returns the current crossing list: live from Overpass or hardcoded fallback.
 */
function _getCrossings() {
  return (_liveCrossings && _liveCrossings.length > 10) ? _liveCrossings : DE_BORDER_CROSSINGS;
}

/**
 * Returns the N nearest border crossings sorted by aerial distance.
 * Uses actual Grenzübergänge instead of raw polygon coordinates. */
function _topNCrossings(lat, lng, n = 5) {
  const pt     = turf.point([lng, lat]);
  const poly   = _borderPoly || _fallbackPoly;
  const inside = (() => {
    try { return turf.booleanPointInPolygon(pt, poly); } catch { return false; }
  })();

  // Rough bbox pre-filter: only compute precise distance for crossings
  // within ~6° (≈660km) of the query point — skips ~80% of list
  const latRange = 6, lngRange = 8;
  const candidates = _getCrossings().filter(c =>
    Math.abs(c.lat - lat) < latRange && Math.abs(c.lng - lng) < lngRange
  );
  // Fall back to full list if filter too aggressive
  const list = candidates.length >= n ? candidates : _getCrossings();

  return list
    .map(c => {
      const dist = turf.distance(pt, turf.point([c.lng, c.lat]), { units: 'kilometers' });
      return { ...c, aerialKm: inside ? -dist : dist };
    })
    .sort((a, b) => Math.abs(a.aerialKm) - Math.abs(b.aerialKm))
    .slice(0, n);
}

// ── Aerial distance (sync) ────────────────────────────────

/**
 * Returns the single nearest border point (aerial).
 */
function aerialDistToBorder(lat, lng) {
  // Use real border crossings for aerial estimate
  const crossings = _topNCrossings(lat, lng, 1);
  if (!crossings.length) return { km: null, nearestPt: null };
  const best = crossings[0];
  return { km: best.aerialKm, nearestPt: [best.lng, best.lat] };
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
  // Use top-5 nearest real border crossings as OSRM targets
  // This gives accurate road distances to actual Grenzübergänge
  const crossings = _topNCrossings(lat, lng, 5);
  if (!crossings.length) return null;

  // Fire all OSRM requests in parallel
  const requests = crossings.map(c =>
    _osrmRoute(lat, lng, [c.lng, c.lat], c.aerialKm, c.name)
  );
  const results = await Promise.all(requests);

  // Pick shortest driving distance
  const valid = results.filter(Boolean);
  if (!valid.length) return null;

  valid.sort((a, b) => a.driveKm - b.driveKm);
  const best = valid[0];
  best.candidatesUsed = valid.length;
  // Attach the crossing node so callers can show direction + flag
  const bPt = best.nearestPt; // [lng, lat]
  try { best.crossing = _topNCrossings(bPt[1], bPt[0], 1)[0] || null; } catch { best.crossing = null; }
  return best;
}

/**
 * Single OSRM route request with road-type steps.
 */
async function _osrmRoute(lat, lng, borderPt, aerialKm, crossingName) {
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
        crossingName:  crossingName || null,
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

// ── Direction helpers ────────────────────────────────────

function _bearing(lat1, lng1, lat2, lng2) {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const y   = Math.sin(Δλ) * Math.cos(φ2);
  const x   = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function _bearingToDirection(deg) {
  const arrows  = ['↑','↗','→','↘','↓','↙','←','↖'];
  const compass = ['N','NO','O','SO','S','SW','W','NW'];
  const idx = Math.round(deg / 45) % 8;
  return { arrow: arrows[idx], compass: compass[idx] };
}

function _countryFlag(neighbor) {
  const flags = { NL:'🇳🇱', BE:'🇧🇪', LU:'🇱🇺', FR:'🇫🇷',
                  CH:'🇨🇭', AT:'🇦🇹', CZ:'🇨🇿', PL:'🇵🇱', DK:'🇩🇰' };
  return flags[neighbor] || '';
}

/**
 * Format driving border distance with direction arrow + country flag.
 * e.g. "170.3 km · ← W 🇫🇷"
 */
function formatBorderWithDirection(fromLat, fromLng, crossing, driveKm) {
  if (!crossing) return driveKm != null ? `${driveKm.toFixed(1)} km` : null;
  const bear = _bearing(fromLat, fromLng, crossing.lat, crossing.lng);
  const { arrow, compass } = _bearingToDirection(bear);
  const flag = _countryFlag(crossing.neighbor);
  const dirStr = `${arrow} ${compass}${flag ? ' ' + flag : ''}`;
  return driveKm != null ? `${driveKm.toFixed(1)} km · ${dirStr}` : dirStr;
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

// ── Route crossing detection ──────────────────────────────

/**
 * Find which border crossing a route passes through.
 * Checks every crossing against every route coordinate — the crossing
 * with the minimum distance to any route point is the one used.
 *
 * @param {L.LatLng[]} latLngs   - Route coordinates from Leaflet
 * @param {number}     maxDistKm - Max distance to consider "on route" (default 8km)
 * @returns {{ name, lat, lng, neighbor, distKm } | null}
 */
function detectRouteCrossing(latLngs, maxDistKm = 8) {
  if (!latLngs || !latLngs.length) return null;

  const poly = _borderPoly || _fallbackPoly;
  const crossings = _getCrossings();

  // Step 1: find where the route crosses the DE border polygon
  // Walk the route and find the transition point inside→outside (or outside→inside)
  let borderIntersectPt = null;
  try {
    const routeLine = turf.lineString(latLngs.map(p => [p.lng, p.lat]));
    const intersects = turf.lineIntersect(routeLine, turf.polygonToLine(poly));
    if (intersects.features.length > 0) {
      // Use first intersection (route entry/exit of DE)
      borderIntersectPt = intersects.features[0].geometry.coordinates; // [lng, lat]
    }
  } catch { /* fall back to proximity search */ }

  if (borderIntersectPt) {
    // Step 2: find crossing nearest to the actual border intersection point
    const iPt = turf.point(borderIntersectPt);
    let bestCrossing = null;
    let bestDist     = Infinity;

    for (const crossing of crossings) {
      const dist = turf.distance(iPt, turf.point([crossing.lng, crossing.lat]), { units: 'kilometers' });
      if (dist < bestDist) {
        bestDist     = dist;
        bestCrossing = crossing;
      }
    }
    // Use a wider threshold here — the intersection point is exact, crossing might be a few km away
    if (bestDist <= Math.max(maxDistKm, 20)) {
      return { ...bestCrossing, distKm: Math.round(bestDist * 10) / 10 };
    }
  }

  // Fallback: proximity search along route samples (original method)
  let bestCrossing = null;
  let bestDist     = Infinity;
  const step    = Math.max(1, Math.floor(latLngs.length / 60));
  const samples = latLngs.filter((_, i) => i % step === 0);

  for (const crossing of crossings) {
    const cPt = turf.point([crossing.lng, crossing.lat]);
    for (const p of samples) {
      const dist = turf.distance(turf.point([p.lng, p.lat]), cPt, { units: 'kilometers' });
      if (dist < bestDist) {
        bestDist     = dist;
        bestCrossing = crossing;
      }
    }
  }

  if (bestDist > maxDistKm) return null;
  return { ...bestCrossing, distKm: Math.round(bestDist * 10) / 10 };
}
