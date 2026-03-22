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
    showOrsKeyPanel();
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
    let done = 0;

    for (const [idx, batch] of batches.entries()) {
      try {
        const resp = await fetch('https://api.openrouteservice.org/v2/isochrones/driving-car', {
          method: 'POST',
          headers: {
            'Authorization': State.orsKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ locations: batch, range: [rangeVal], range_type: rangeType, smoothing: 5 }),
        });

        if (resp.status === 401 || resp.status === 403) {
          showToast('ORS API-Key ungültig');
          progress.style.display = 'none';
          showOrsKeyPanel();
          return; // finally still runs
        }

        if (resp.ok) {
          const data = await resp.json();
          if (data.features) allPolygons.push(...data.features);
        }
      } catch { /* skip failed batch */ }

      done += batch.length;
      progress.style.transform = `scaleX(${done / pts.length})`;

      if (idx < batches.length - 1) {
        await new Promise(r => setTimeout(r, ORS_BATCH_DELAY_MS));
      }
    }

    progress.style.transform = 'scaleX(1)';
    setTimeout(() => { progress.style.display = 'none'; progress.style.transform = 'scaleX(0)'; }, 400);

    if (allPolygons.length === 0) {
      showToast('Keine Daten von ORS erhalten');
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
