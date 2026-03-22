// ── radius.js ─────────────────────────────────────────────
// Radius drawing (aerial / road / time), ORS isochrones, radius slider.

// ── Layer management ──────────────────────────────────────

function clearRadiusLayers() {
  if (State.radiusLayer)  { State.map.removeLayer(State.radiusLayer);  State.radiusLayer = null; }
  if (State.orsLayer)     { State.map.removeLayer(State.orsLayer);     State.orsLayer    = null; }
  if (State.borderLine)   { State.map.removeLayer(State.borderLine);   State.borderLine  = null; }
}

function drawGermanyOutline() {
  const coords = GERMANY_BORDER.geometry.coordinates[0].map(c => [c[1], c[0]]);
  State.borderLine = L.polygon(coords, {
    color: '#ffffff', weight: 1.5, opacity: 0.3, fill: false,
  }).addTo(State.map);
}

function drawRadius() {
  clearRadiusLayers();
  drawGermanyOutline();

  if (State.radiusMode === 'aerial') {
    _drawAerial();
  } else if (State.orsKey) {
    drawOrsIsochrone(State.radiusMode);
  } else {
    // No ORS key — use Valhalla (falls back to OSRM if unavailable)
    showToast('Kein ORS-Key — Valhalla wird verwendet… (⚙ für ORS-Key)');
    State.orsLoading = true;
    const progress = document.getElementById('ors-progress');
    progress.style.display = 'block';
    _drawValhallaIsochrone(State.radiusMode).finally(() => {
      State.orsLoading = false;
    });
  }
}

// ── Aerial (Turf buffer) ──────────────────────────────────

// Fix 1: cache aerial buffer per radiusKm; sequence counter prevents stale callbacks
let _aerialBufferKm     = null;
let _aerialBufferCoords = null;
let _aerialDrawSeq      = 0; // incremented on each drawAerial call

function _drawAerial() {
  State.isochroneSource = 'aerial';
  const seq = ++_aerialDrawSeq; // capture current sequence

  // Use cached coords if radius unchanged — synchronous, no race possible
  if (_aerialBufferKm === State.radiusKm && _aerialBufferCoords) {
    State.radiusLayer = L.polygon(_aerialBufferCoords, {
      color: '#e94560', weight: 2.5, opacity: 0.9,
      fillColor: '#e94560', fillOpacity: 0.06, dashArray: '8,6',
    }).addTo(State.map);
    return;
  }
  // Show a quick circle placeholder while buffer computes
  State.radiusLayer = L.circle(GERMANY_CENTER, {
    radius: State.radiusM, color: '#e94560', weight: 2, opacity: 0.5,
    fillColor: '#e94560', fillOpacity: 0.04, dashArray: '6,6',
  }).addTo(State.map);
  // Defer heavy turf.buffer to next event loop tick so UI stays responsive
  setTimeout(() => {
    if (seq !== _aerialDrawSeq) return; // Fix 1: stale — a newer call has superseded this one
    try {
      const buffered = turf.buffer(GERMANY_BORDER, State.radiusKm, { units: 'kilometers', steps: 64 });
      _aerialBufferCoords = buffered.geometry.coordinates[0].map(c => [c[1], c[0]]);
      _aerialBufferKm     = State.radiusKm;
      // Remove placeholder circle
      if (State.radiusLayer) { State.map.removeLayer(State.radiusLayer); State.radiusLayer = null; }
      State.radiusLayer = L.polygon(_aerialBufferCoords, {
        color: '#e94560', weight: 2.5, opacity: 0.9,
        fillColor: '#e94560', fillOpacity: 0.06, dashArray: '8,6',
      }).addTo(State.map);
    } catch { /* placeholder circle remains */ }
  }, 0);
}

// ── ORS Isochrone ─────────────────────────────────────────

function sampleBorderPoints(n) {
  const line = turf.lineString(GERMANY_BORDER.geometry.coordinates[0]);
  const len  = turf.length(line, { units: 'kilometers' });
  return Array.from({ length: n }, (_, i) =>
    turf.along(line, (len / n) * i, { units: 'kilometers' }).geometry.coordinates
  );
}

async function drawOrsIsochrone(mode) {
  if (State.orsLoading) return;

  // Check cache first
  const cachedEntry = isochroneGetCache(mode, State.radiusKm);
  if (cachedEntry) {
    const color = mode === 'road' ? '#533483' : '#1d9e75';
    State.orsLayer = L.geoJSON(cachedEntry.data, {
      style: { color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
    }).addTo(State.map);
    const srcTag = cachedEntry.src !== 'ors' ? ` (${cachedEntry.src})` : '';
    const label = mode === 'road'
      ? `${State.radiusKm}km Straße${srcTag}`
      : `${formatTime(Math.round(State.radiusKm / 85 * 3600))} Fahrzeit${srcTag}`;
    State.isochroneSource = cachedEntry.src || 'unknown';
    showToast(`✓ ${label} (Cache)`);
    (document.getElementById('chip-radius-val') || {textContent:''}).textContent = label;
    return;
  }

  State.orsLoading = true;

  const progress = document.getElementById('ors-progress');
  progress.style.display = 'block';

  try {
    const rangeType = mode === 'road' ? 'distance' : 'time';
    // ORS Free-Tier: max 100,000m distance OR 3,600s time
    // We use the maximum allowed value — the isochrone shows road-accessible
    // area from the German border within these limits, unioned into one shape.
    // This is NOT the full radiusKm from the border, but the best possible
    // with the free tier. Premium key removes this limitation.
    const ORS_FREE_MAX_DIST = 100000; // 100km in meters
    const ORS_FREE_MAX_TIME = 3600;   // 1 hour in seconds
    const rangeVal = mode === 'road' ? ORS_FREE_MAX_DIST : ORS_FREE_MAX_TIME;

    const pts     = sampleBorderPoints(ORS_BORDER_SAMPLE_POINTS);
    const batches = [];
    for (let i = 0; i < pts.length; i += ORS_BATCH_SIZE) {
      batches.push(pts.slice(i, i + ORS_BATCH_SIZE));
    }

    showToast(`Lade ${mode === 'road' ? 'Straßen-Radius' : 'Fahrzeit-Isochrone'}… (${pts.length} Punkte)`);

    const allPolygons = [];
    let done         = 0;
    let fatalError   = null; // set on unrecoverable error to break loop early

    for (const [idx, batch] of batches.entries()) {
      if (fatalError) break;
      try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 15000); // 15s per batch
        let resp;
        try {
          resp = await fetch('https://api.openrouteservice.org/v2/isochrones/driving-car', {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
              'Authorization': State.orsKey,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ locations: batch, range: [rangeVal], range_type: rangeType, smoothing: 5 }),
          });
        } finally {
          clearTimeout(tid);
        }

        if (resp.status === 401 || resp.status === 403) {
          showToast('⚠ ORS API-Key ungültig oder abgelaufen');
          progress.style.display = 'none';
          showOrsKeyPanel();
          fatalError = 'auth';
          return; // finally resets orsLoading
        }
        if (resp.status === 429) {
          const retryAfter = resp.headers.get('Retry-After');
          const waitSec    = retryAfter ? parseInt(retryAfter) : null;
          const waitMsg    = waitSec
            ? `Bitte ${waitSec}s warten`
            : 'Tageslimit möglicherweise erreicht';
          showToast(`⚠ ORS Limit (429) — ${waitMsg}`);
          _showOrsQuotaHint(waitSec);
          fatalError = 'ratelimit';
          break;
        }
        if (resp.status === 503 || resp.status === 502) {
          showToast(`⚠ ORS nicht erreichbar (${resp.status}) — OSRM-Näherung wird geladen`);
          fatalError = 'unavailable';
          break;
        }
        if (resp.status >= 500) {
          showToast(`⚠ ORS Server-Fehler (${resp.status}) — Versuch wird fortgesetzt`);
          // don't break, try remaining batches
        } else if (resp.ok) {
          const data = await resp.json();
          if (data.error) {
            const code = data.error.code || 0;
            const msg  = data.error.message || 'Unbekannter Fehler';
            console.warn('[ORS] API error:', code, msg);
            if (code === 3002 || code === 3003) {
              // Range exceeds free-tier limit — fatal, no point retrying batches
              showToast('⚠ ORS: Reichweite überschreitet Free-Tier-Limit');
              fatalError = 'limit';
              break;
            }
            showToast(`⚠ ORS: ${msg.substring(0, 60)}`);
          } else if (data.features) {
            allPolygons.push(...data.features);
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          showToast('⚠ ORS Timeout — Batch übersprungen');
        }
        // network error: skip batch, continue
      }

      done += batch.length;
      progress.style.transform = `scaleX(${done / pts.length})`;

      if (idx < batches.length - 1) {
        await new Promise(r => setTimeout(r, ORS_BATCH_DELAY_MS));
      }
    }

    progress.style.transform = 'scaleX(1)';
    setTimeout(() => { progress.style.display = 'none'; progress.style.transform = 'scaleX(0)'; }, 400);

    if (allPolygons.length === 0) {
      if (fatalError === 'ratelimit') {
        showToast('ORS Rate-Limit — versuche OSRM-Approximation…');
      } else if (fatalError === 'auth') {
        return; // already handled
      } else if (fatalError === 'unavailable') {
        // already toasted above, fall through to OSRM
      } else if (fatalError === 'limit') {
        showToast('⚠ ORS Free-Tier Limit — OSRM-Approximation wird geladen…');
      } else {
        showToast('⚠ Keine ORS-Daten — OSRM-Approximation wird geladen…');
      }
      // Fallback chain: Valhalla → OSRM approximation
      progress.style.display = 'block';
      progress.style.transform = 'scaleX(0.1)';
      await _drawValhallaIsochrone(mode);
      return;
    }

    let union = _unionAll(allPolygons);
    union = _ensureGermanyIncluded(union);

    const color = mode === 'road' ? '#533483' : '#1d9e75';
    State.orsLayer = L.geoJSON(union, {
      style: { color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
    }).addTo(State.map);

    isochroneSetCache(mode, State.radiusKm, union);

    const label = mode === 'road'
      ? `${State.radiusKm}km Straße`
      : `${formatTime(Math.round(State.radiusKm / 85 * 3600))} Fahrzeit`;
    const orsLabel = mode === 'road' ? '100km Straße ab Grenze' : '1h Fahrzeit ab Grenze';
    showToast(`✓ ${orsLabel} geladen (${allPolygons.length} Polygone)`);
    (document.getElementById('chip-radius-val') || {textContent:''}).textContent = orsLabel;

  } finally {
    State.orsLoading = false; // Fix 5: always reset, even on unexpected throw
  }
}

// ── Safe geometry helpers ─────────────────────────────────

function _safeUnion(a, b) {
  if (!a) return b;
  if (!b) return a;
  try { return turf.union(a, b); }
  catch (e) {
    console.warn('[union]', e.message?.substring(0, 80));
    // Keep the larger polygon on failure
    return JSON.stringify(a).length >= JSON.stringify(b).length ? a : b;
  }
}

function _flattenPolygons(features) {
  // Flatten MultiPolygons into individual Polygon features
  // This prevents triangle artifacts when unioning overlapping MultiPolygons
  const result = [];
  for (const f of features) {
    if (!f?.geometry) continue;
    if (f.geometry.type === 'Polygon') {
      result.push(f);
    } else if (f.geometry.type === 'MultiPolygon') {
      // Each sub-polygon becomes its own feature
      for (const coords of f.geometry.coordinates) {
        result.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } });
      }
    } else if (f.geometry.type === 'GeometryCollection') {
      for (const geom of f.geometry.geometries || []) {
        if (geom.type === 'Polygon') {
          result.push({ type: 'Feature', properties: {}, geometry: geom });
        }
      }
    }
  }
  return result;
}

function _unionAll(polygons) {
  if (!polygons?.length) return null;
  // Flatten MultiPolygons first to avoid triangle artifacts
  const flat = _flattenPolygons(polygons);
  if (!flat.length) return polygons[0] || null;
  // Sort largest first — more stable progressive union
  const sorted = [...flat].sort((a, b) => {
    try {
      const ba = turf.bbox(a), bb = turf.bbox(b);
      return ((bb[2]-bb[0])*(bb[3]-bb[1])) - ((ba[2]-ba[0])*(ba[3]-ba[1]));
    } catch { return 0; }
  });
  return sorted.reduce((acc, poly) => _safeUnion(acc, poly));
}

function _ensureGermanyIncluded(geom) {
  if (!geom) return GERMANY_BORDER;
  try {
    if (turf.booleanPointInPolygon(
      turf.point([GERMANY_CENTER[1], GERMANY_CENTER[0]]), geom
    )) return geom;
  } catch { /* union anyway */ }
  // Flatten both before union to prevent triangle artifacts
  const flat = _flattenPolygons([geom, GERMANY_BORDER]);
  if (flat.length < 2) return geom;
  return flat.reduce((acc, poly) => _safeUnion(acc, poly));
}

// ── Valhalla isochrone (no key needed) ────────────────────
// Valhalla endpoints in priority order — first available is used
const VALHALLA_URLS = [
  'https://valhalla1.openstreetmap.de/isochrone',
  'https://valhalla2.openstreetmap.de/isochrone',
  'https://valhalla3.openstreetmap.de/isochrone',
];
let _valhallaWorkingUrl = null; // cached after first success

// 16 evenly-distributed border points (~230km spacing along DE perimeter)
// ensures no gap > 460km so 350km isochroness fully cover all border sections
const DE_BORDER_KEY_POINTS = [
  { lat: 47.66, lon:  9.18 }, // SW  Konstanz/CH
  { lat: 47.59, lon:  7.59 }, // SW  Basel/CH-FR
  { lat: 48.97, lon:  8.20 }, // W   Karlsruhe/FR
  { lat: 49.23, lon:  6.99 }, // W   Saarbrücken/FR
  { lat: 49.87, lon:  6.36 }, // W   Trier/LU
  { lat: 50.77, lon:  6.08 }, // NW  Aachen/BE-NL
  { lat: 51.84, lon:  5.99 }, // NW  Nijmegen/NL
  { lat: 53.17, lon:  7.20 }, // N   Bunde/NL
  { lat: 54.79, lon:  9.44 }, // N   Flensburg/DK
  { lat: 54.03, lon: 13.98 }, // NE  Stralsund/PL-Küste
  { lat: 53.88, lon: 14.28 }, // NE  Stettin/PL
  { lat: 52.35, lon: 14.55 }, // E   Frankfurt-Oder/PL
  { lat: 51.15, lon: 14.99 }, // E   Görlitz/CZ-PL
  { lat: 50.22, lon: 12.95 }, // SE  Erzgebirge/CZ
  { lat: 48.57, lon: 13.46 }, // SE  Passau/AT
  { lat: 47.50, lon: 11.09 }, // S   Garmisch/AT
];

async function _valhallaIsochrone(location, contour) {
  const urls = _valhallaWorkingUrl
    ? [_valhallaWorkingUrl, ...VALHALLA_URLS.filter(u => u !== _valhallaWorkingUrl)]
    : VALHALLA_URLS;

  const body = JSON.stringify({
    locations:  [location],
    costing:    'auto',
    contours:   [{ ...contour, color: 'ff0000' }],
    polygons:   true,
    denoise:    0.4,
    generalize: 400,
  });

  for (const url of urls) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 60000);
    try {
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const feat = data.features?.[0] || null;
      if (feat) {
        _valhallaWorkingUrl = url; // cache working endpoint
        return feat;
      }
    } catch (err) {
      if (err.name === 'AbortError') continue;
      continue;
    } finally {
      clearTimeout(tid);
    }
  }
  return null; // all endpoints failed
}

async function _drawValhallaIsochrone(mode) {
  const progress = document.getElementById('ors-progress');
  const color    = mode === 'road' ? '#533483' : '#1d9e75';

  // Fix 7: try/finally so State.orsLoading is always reset
  try {
    if (mode === 'time') {
      // Use border points — NOT center — so isochrone expands OUTWARD from DE border
      const timeMins = Math.round(State.radiusKm / 85 * 60);
      const h = Math.floor(timeMins / 60), m = timeMins % 60;
      const timeStr = h > 0 ? `${h}h ${m}min` : `${m}min`;
      showToast(`Valhalla: ${DE_BORDER_KEY_POINTS.length} Punkte × ${timeStr} — kann 1-2 Min dauern…`);
      progress.style.display = 'block';
      progress.style.transform = 'scaleX(0.1)';

      // Batched requests to avoid server overload
      const VTBATCH = 4;
      const timeResults = [];
      for (let i = 0; i < DE_BORDER_KEY_POINTS.length; i += VTBATCH) {
        const batch = DE_BORDER_KEY_POINTS.slice(i, i + VTBATCH);
        const br = await Promise.all(batch.map(pt => _valhallaIsochrone(pt, { time: timeMins })));
        timeResults.push(...br);
        progress.style.transform = `scaleX(${0.1 + 0.75 * (timeResults.length / DE_BORDER_KEY_POINTS.length)})`;
        if (i + VTBATCH < DE_BORDER_KEY_POINTS.length) await new Promise(r => setTimeout(r, 500));
      }

      const timePolygons = timeResults.filter(Boolean);
      if (timePolygons.length < 3) {
        showToast('⚠ Valhalla nicht erreichbar — OSRM-Näherung');
        await _drawOsrmApproximation(mode);
        return;
      }

      await new Promise(r => setTimeout(r, 0));
      let timeUnion = _unionAll(timePolygons);
      timeUnion = _ensureGermanyIncluded(timeUnion);

      progress.style.transform = 'scaleX(1)';
      setTimeout(() => { progress.style.display = 'none'; progress.style.transform = 'scaleX(0)'; }, 400);

      if (State.orsLayer) { State.map.removeLayer(State.orsLayer); State.orsLayer = null; }
      State.orsLayer = L.geoJSON(timeUnion, {
        style: { color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
      }).addTo(State.map);
      const label = `${timeStr} Fahrzeit ab Grenze (Valhalla)`;
      isochroneSetCache(mode, State.radiusKm, timeUnion, 'valhalla');
      State.isochroneSource = 'valhalla';
      showToast(`✓ ${label} (${timePolygons.length}/${DE_BORDER_KEY_POINTS.length} Punkte)`);
      (document.getElementById('chip-radius-val') || {textContent:''}).textContent = label;
      return;
    }

    const distKm = State.radiusKm;
    showToast(`Valhalla: ${DE_BORDER_KEY_POINTS.length} Punkte × ${distKm}km — bitte warten…`);
    progress.style.display = 'block';
    progress.style.transform = 'scaleX(0.05)';

    // Send requests in batches of 4 with a small delay between batches
    // to avoid overwhelming the Valhalla server → prevents eastern gaps
    const VBATCH = 4;
    const results = [];
    for (let i = 0; i < DE_BORDER_KEY_POINTS.length; i += VBATCH) {
      const batch = DE_BORDER_KEY_POINTS.slice(i, i + VBATCH);
      const batchResults = await Promise.all(
        batch.map(pt => _valhallaIsochrone(pt, { distance: distKm }))
      );
      results.push(...batchResults);
      const pct = 0.05 + 0.8 * (results.length / DE_BORDER_KEY_POINTS.length);
      progress.style.transform = `scaleX(${pct})`;
      showToast(`Valhalla: ${results.filter(Boolean).length}/${results.length} Punkte geladen…`);
      // Small delay between batches to be a fair-use citizen
      if (i + VBATCH < DE_BORDER_KEY_POINTS.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const polygons = results.filter(Boolean);
    if (polygons.length < DE_BORDER_KEY_POINTS.length * 0.6) {
      // Less than 60% success — warn but continue with what we have
      showToast(`⚠ Nur ${polygons.length}/${DE_BORDER_KEY_POINTS.length} Valhalla-Punkte geladen`);
    }
    if (polygons.length < 3) {
      showToast('⚠ Valhalla nicht erreichbar — OSRM-Näherung');
      await _drawOsrmApproximation(mode);
      return;
    }

    // Fix 2: defer union to next tick to avoid blocking UI
    await new Promise(r => setTimeout(r, 0));
    let union = _unionAll(polygons);
    union = _ensureGermanyIncluded(union);

    progress.style.transform = 'scaleX(1)';
    setTimeout(() => { progress.style.display = 'none'; progress.style.transform = 'scaleX(0)'; }, 400);

    if (State.orsLayer) { State.map.removeLayer(State.orsLayer); State.orsLayer = null; }
    State.orsLayer = L.geoJSON(union, {
      style: { color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
    }).addTo(State.map);
    const label = `${distKm}km Straße (Valhalla)`;
    isochroneSetCache(mode, State.radiusKm, union, 'valhalla');
    State.isochroneSource = 'valhalla';
    showToast(`✓ ${label} (${polygons.length}/${DE_BORDER_KEY_POINTS.length} Punkte)`);
    (document.getElementById('chip-radius-val') || {textContent:''}).textContent = label;

  } finally {
    State.orsLoading = false; // Fix 7: always reset
    progress.style.display = 'none';
  }
}

// ── OSRM-based radius approximation ──────────────────────
// Used as fallback when ORS Free-Tier limits are exceeded.
// Strategy: sample N border points, compute a reachable point ~radiusKm
// outward from each using OSRM table (snap), build convex hull as polygon.

async function _drawOsrmApproximation(mode) {
  const progress = document.getElementById('ors-progress');
  const color    = mode === 'road' ? '#533483' : '#1d9e75';

  // Sample fewer points for OSRM (table API can handle ~25 at once)
  const N   = 32;
  const pts = sampleBorderPoints(N); // [lng, lat] each

  // For each border point, compute a destination point ~radiusKm outward
  // using correct haversine-aware projection (cos(lat) for longitude compression)
  const cx  = 10.4515;
  const cy  = 51.1657;
  const destinations = pts.map(([bLng, bLat]) => {
    // Convert degree-vector to km, accounting for longitude compression at latitude
    const cosLat = Math.cos(((bLat + cy) / 2) * Math.PI / 180);
    const dxKm   = (bLng - cx) * 111 * cosLat;
    const dyKm   = (bLat - cy) * 111;
    const lenKm  = Math.sqrt(dxKm * dxKm + dyKm * dyKm) || 1;
    // Project outward exactly radiusKm along the same direction
    const destLng = bLng + (dxKm / lenKm) * State.radiusKm / (111 * cosLat);
    const destLat = bLat + (dyKm / lenKm) * State.radiusKm / 111;
    return [destLng, destLat];
  });

  // Use OSRM table to snap destinations to real roads
  // We query: source = border point, destination = projected point
  // and take the snapped destination coordinate from the annotation
  const snappedPts = [];
  const CHUNK = 6; // OSRM table: keep small to avoid 414 URI Too Long

  progress.style.transform = 'scaleX(0.2)';

  // Fix 3: shared abort controller for all OSRM table requests
  const osrmAbort = new AbortController();

  for (let i = 0; i < pts.length; i += CHUNK) {
    if (osrmAbort.signal.aborted) break;
    const chunk    = pts.slice(i, i + CHUNK);
    const dstChunk = destinations.slice(i, i + CHUNK);

    const coords = [...chunk, ...dstChunk]
      .map(([lng, lat]) => `${lng},${lat}`).join(';');
    const srcIdx = chunk.map((_, j) => j).join(';');
    const dstIdx = dstChunk.map((_, j) => chunk.length + j).join(';');

    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 10000);
      let data;
      try {
        const url  = `https://router.project-osrm.org/table/v1/driving/${coords}` +
                     `?sources=${srcIdx}&destinations=${dstIdx}&annotations=distance`;
        const resp = await fetch(url, { signal: ctrl.signal });
        if (!resp.ok) continue;
        data = await resp.json();
      } finally { clearTimeout(tid); }

      if (data.code !== 'Ok') continue;

      // OSRM table gives us snapped waypoints in data.destinations
      // Each destination[j].location is [lng, lat] of snapped road point
      for (const dest of (data.destinations || [])) {
        if (dest?.location) snappedPts.push(dest.location); // [lng, lat]
      }
    } catch { /* skip chunk */ }

    progress.style.transform = `scaleX(${0.2 + 0.7 * (i / pts.length)})`;
    const batchNum = Math.floor(i / CHUNK) + 1;
    const batchTotal = Math.ceil(pts.length / CHUNK);
    showToast(`OSRM-Näherung… Batch ${batchNum}/${batchTotal}`);
    await new Promise(r => setTimeout(r, 200));
  }

  progress.style.transform = 'scaleX(1)';
  setTimeout(() => { progress.style.display = 'none'; progress.style.transform = 'scaleX(0)'; }, 400);

  if (snappedPts.length < 3) {
    showToast('⚠ OSRM-Approximation fehlgeschlagen — Luftlinie wird angezeigt');
    setRadiusMode('aerial');
    return;
  }

  await new Promise(r => setTimeout(r, 0));
  const fc = turf.featureCollection([
    ...snappedPts.map(p => turf.point(p)),
    ...GERMANY_BORDER.geometry.coordinates[0].map(c => turf.point(c)),
  ]);
  let hull = null;
  try { hull = turf.concave(fc, { maxEdge: 200, units: 'kilometers' }); } catch { hull = null; }
  if (!hull) {
    try { hull = turf.convex(fc); } catch { hull = null; }
  }
  if (hull) {
    try { hull = turf.simplify(hull, { tolerance: 0.08, highQuality: false }); } catch { /* keep */ }
  }
  if (!hull) {
    showToast('⚠ Approximation fehlgeschlagen — Luftlinie wird angezeigt');
    setRadiusMode('aerial');
    return;
  }

  if (State.orsLayer) { State.map.removeLayer(State.orsLayer); State.orsLayer = null; }
  State.orsLayer = L.geoJSON(hull, {
    style: { color, weight: 2.5, opacity: 0.85, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
  }).addTo(State.map);

  hull = _ensureGermanyIncluded(hull);
  isochroneSetCache(mode, State.radiusKm, hull, 'osrm');
  State.isochroneSource = 'osrm';

  const label = mode === 'road'
    ? `${State.radiusKm}km Straße (Näherung)`
    : `${formatTime(Math.round(State.radiusKm / 85 * 3600))} Fahrzeit (Näherung)`;
  showToast(`✓ ${label} — OSRM-Approximation`);
  (document.getElementById('chip-radius-val') || {textContent:''}).textContent = label;
  State.orsLoading = false;
}

// ── Radius mode toggle ────────────────────────────────────

function setRadiusMode(mode) {
  State.radiusMode = mode;
  document.querySelectorAll('.rmode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  updateRadiusLabels();
  drawRadius();
}

// ── ORS Key Panel ─────────────────────────────────────────

function _showOrsQuotaHint(waitSec) {
  const el = document.getElementById('ors-quota-info');
  if (!el) return;
  const waitMsg = waitSec
    ? `Bitte noch ${waitSec} Sekunden warten.`
    : 'Das Tageslimit (500 Req) ist möglicherweise erschöpft.';
  el.textContent = `⚠ ORS Rate-/Tageslimit erreicht. ${waitMsg} → ORS Premium (2000 Req/Tag) unter openrouteservice.org/plans`;
  el.style.display = 'block';
  showOrsKeyPanel();
}

function showOrsKeyPanel(showQuota) {
  document.getElementById('ors-overlay').style.display = 'block';
  document.getElementById('ors-panel').style.display   = 'flex';
  if (State.orsKey) document.getElementById('ors-key-input').value = State.orsKey;
  // Only show quota hint if explicitly triggered by rate-limit
  const qi = document.getElementById('ors-quota-info');
  if (qi && !showQuota) qi.style.display = 'none';
}

function hideOrsKeyPanel() {
  document.getElementById('ors-overlay').style.display = 'none';
  document.getElementById('ors-panel').style.display   = 'none';
}

// ── Radius Slider ─────────────────────────────────────────

function openRadiusSlider() {
  const slider = document.getElementById('radius-slider');
  slider.value = State.radiusKm;
  _updateSliderDisplay(State.radiusKm);
  document.getElementById('radius-slider-panel').classList.add('open');
}

function _updateSliderDisplay(km) {
  const secs = Math.round(km / 85 * 3600);
  document.getElementById('rsp-km-label').textContent   = `${km} km`;
  document.getElementById('rsp-time-label').textContent = `≈ ${formatTime(secs)} Fahrzeit`;
}

function initRadiusSliderEvents() {
  document.getElementById('radius-slider').addEventListener('input', e =>
    _updateSliderDisplay(parseInt(e.target.value))
  );

  document.getElementById('rsp-apply-btn').addEventListener('click', () => {
    State.radiusKm = parseInt(document.getElementById('radius-slider').value);
    localStorage.setItem('radius-km', State.radiusKm);
    document.getElementById('radius-slider-panel').classList.remove('open');
    updateRadiusLabels();
    if (State.orsLoading) {
      showToast('ORS-Request läuft noch — Radius wird danach aktualisiert');
      const modeAtApply = State.radiusMode;
      const poll = setInterval(() => {
        if (!State.orsLoading) {
          clearInterval(poll);
          if (State.radiusMode === modeAtApply) drawRadius(); // skip if user switched mode
        }
      }, 500);
      return;
    }
    drawRadius();
    showToast(`Radius: ${State.radiusKm} km`);
  });

  document.getElementById('rsp-close').addEventListener('click', () =>
    document.getElementById('radius-slider-panel').classList.remove('open')
  );

  // Long-press on radius button → open slider (Touch + Mouse)
  let pressTimer;
  const btnRadius = document.getElementById('btn-radius');

  btnRadius.addEventListener('touchstart', () => {
    pressTimer = setTimeout(openRadiusSlider, 500);
  }, { passive: true });
  btnRadius.addEventListener('touchend',   () => clearTimeout(pressTimer), { passive: true });
  btnRadius.addEventListener('touchmove',  () => clearTimeout(pressTimer), { passive: true });

  btnRadius.addEventListener('mousedown', () => {
    pressTimer = setTimeout(openRadiusSlider, 500);
  });
  btnRadius.addEventListener('mouseup',   () => clearTimeout(pressTimer));
  btnRadius.addEventListener('mouseleave',() => clearTimeout(pressTimer));
}

function initOrsEvents() {
  document.getElementById('ors-save-btn').addEventListener('click', () => {
    const key = document.getElementById('ors-key-input').value.trim();
    if (!key) { showToast('Bitte API-Key eingeben'); return; }
    if (key !== State.orsKey) {
      isochroneClearCache();  // old key's cached results are invalid
    }
    State.orsKey = key;
    localStorage.setItem('ors-key', key);
    hideOrsKeyPanel();
    drawOrsIsochrone(State.radiusMode);
    if (typeof _updateOrsKeyBtn === 'function') _updateOrsKeyBtn();
    if (typeof _updateSettingsStatus === 'function') _updateSettingsStatus();
  });

  document.getElementById('ors-cancel-btn').addEventListener('click', () => {
    hideOrsKeyPanel();
    setRadiusMode('aerial');
  });

  document.getElementById('ors-overlay').addEventListener('click', () => {
    hideOrsKeyPanel();
    if (State.radiusMode !== 'aerial') setRadiusMode('aerial');
  });
}
