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
    // No ORS key — use OSRM approximation directly, offer key panel via toast
    showToast('Kein ORS-Key — OSRM-Näherung wird berechnet… (⚙ für Key)');
    State.orsLoading = true;
    const progress = document.getElementById('ors-progress');
    progress.style.display = 'block';
    _drawOsrmApproximation(State.radiusMode).finally(() => {
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
  const cached = isochroneGetCache(mode, State.radiusKm);
  if (cached) {
    const color = mode === 'road' ? '#533483' : '#1d9e75';
    State.orsLayer = L.geoJSON(cached, {
      style: { color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
    }).addTo(State.map);
    const label = mode === 'road'
      ? `${State.radiusKm}km Straße`
      : `${formatTime(Math.round(State.radiusKm / 100 * 3600))} Fahrzeit`;
    showToast(`✓ ${label} (Cache)`);
    document.getElementById('chip-radius-val').textContent = label;
    return;
  }

  State.orsLoading = true;

  const progress = document.getElementById('ors-progress');
  progress.style.display = 'block';

  try {
    const rangeType = mode === 'road' ? 'distance' : 'time';
    const rangeVal  = mode === 'road'
      ? State.radiusKm * 1000
      : Math.round(State.radiusKm / 100 * 3600);

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
          showToast('⚠ ORS Rate-Limit erreicht — bitte kurz warten');
          fatalError = 'ratelimit';
          break;
        }
        if (resp.status >= 500) {
          showToast(`⚠ ORS Server-Fehler (${resp.status}) — Versuch wird fortgesetzt`);
          // don't break, try remaining batches
        } else if (resp.ok) {
          const data = await resp.json();
          if (data.error) {
            // ORS returns 200 with error object on some failures
            console.warn('[ORS] API error:', data.error.message || data.error);
            showToast(`⚠ ORS: ${data.error.message || 'Unbekannter Fehler'}`);
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
      } else {
        showToast('⚠ ORS Limit überschritten (Free-Tier: max 100km/1h) — OSRM-Approximation wird geladen…');
      }
      // Fallback: OSRM-based approximation
      progress.style.display = 'block';
      progress.style.transform = 'scaleX(0.1)';
      await _drawOsrmApproximation(mode);
      return;
    }

    let union = allPolygons[0];
    for (let i = 1; i < allPolygons.length; i++) {
      try { union = turf.union(union, allPolygons[i]); } catch { /* skip */ }
    }
    try { union = turf.union(union, GERMANY_BORDER); } catch { /* skip */ }

    const color = mode === 'road' ? '#533483' : '#1d9e75';
    State.orsLayer = L.geoJSON(union, {
      style: { color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
    }).addTo(State.map);

    isochroneSetCache(mode, State.radiusKm, union);

    const label = mode === 'road'
      ? `${State.radiusKm}km Straße`
      : `${formatTime(Math.round(State.radiusKm / 100 * 3600))} Fahrzeit`;
    showToast(`✓ ${label} geladen (${allPolygons.length} Punkte)`);
    document.getElementById('chip-radius-val').textContent = label;

  } finally {
    State.orsLoading = false; // Fix 5: always reset, even on unexpected throw
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
  const N   = 24;
  const pts = sampleBorderPoints(N); // [lng, lat] each

  // For each border point, compute a destination point ~radiusKm outward
  // by extending the vector from Germany center through the border point
  const cx  = 10.4515;
  const cy  = 51.1657;
  const destinations = pts.map(([bLng, bLat]) => {
    const dx  = bLng - cx;
    const dy  = bLat - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // 1° ≈ 111km; push outward by radiusKm
    const scale = State.radiusKm / 111 / len;
    return [bLng + dx * scale, bLat + dy * scale];
  });

  // Use OSRM table to snap destinations to real roads
  // We query: source = border point, destination = projected point
  // and take the snapped destination coordinate from the annotation
  const snappedPts = [];
  const CHUNK = 6; // OSRM table: keep small to avoid 414 URI Too Long

  progress.style.transform = 'scaleX(0.2)';

  for (let i = 0; i < pts.length; i += CHUNK) {
    const chunk    = pts.slice(i, i + CHUNK);
    const dstChunk = destinations.slice(i, i + CHUNK);

    // Build coordinate string: sources first, then destinations
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
    await new Promise(r => setTimeout(r, 200));
  }

  progress.style.transform = 'scaleX(1)';
  setTimeout(() => { progress.style.display = 'none'; progress.style.transform = 'scaleX(0)'; }, 400);

  if (snappedPts.length < 3) {
    showToast('⚠ OSRM-Approximation fehlgeschlagen — Luftlinie wird angezeigt');
    setRadiusMode('aerial');
    return;
  }

  // Build convex hull from snapped points + Germany border
  const allPts = [
    ...snappedPts.map(p => turf.point(p)),
    ...GERMANY_BORDER.geometry.coordinates[0].map(c => turf.point(c)),
  ];
  let hull;
  try {
    hull = turf.convex(turf.featureCollection(allPts));
  } catch {
    hull = null;
  }

  if (!hull) {
    showToast('⚠ Konvexe Hülle fehlgeschlagen — Luftlinie wird angezeigt');
    setRadiusMode('aerial');
    return;
  }

  if (State.orsLayer) { State.map.removeLayer(State.orsLayer); State.orsLayer = null; }
  State.orsLayer = L.geoJSON(hull, {
    style: { color, weight: 2.5, opacity: 0.85, fillColor: color, fillOpacity: 0.07, dashArray: '8,5' },
  }).addTo(State.map);

  isochroneSetCache(mode, State.radiusKm, hull);

  const label = mode === 'road'
    ? `${State.radiusKm}km Straße (Näherung)`
    : `${formatTime(Math.round(State.radiusKm / 100 * 3600))} Fahrzeit (Näherung)`;
  showToast(`✓ ${label} — OSRM-Approximation`);
  document.getElementById('chip-radius-val').textContent = label;
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

function showOrsKeyPanel() {
  document.getElementById('ors-overlay').style.display = 'block';
  document.getElementById('ors-panel').style.display   = 'flex';
  if (State.orsKey) document.getElementById('ors-key-input').value = State.orsKey;
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
  const secs = Math.round(km / 100 * 3600);
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
