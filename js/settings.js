// ── settings.js ───────────────────────────────────────────
// Central settings panel — API keys, GPX export, cache, app info.

// ── Open / Close ──────────────────────────────────────────

function openSettingsPanel() {
  _updateSettingsStatus();
  document.getElementById('settings-overlay').style.display = 'block';
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('btn-settings').classList.add('active');
}

function closeSettingsPanel() {
  document.getElementById('settings-overlay').style.display = 'none';
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('btn-settings').classList.remove('active');
}

// ── Status labels ─────────────────────────────────────────

function _updateSettingsStatus() {
  // ORS key
  const orsEl = document.getElementById('sett-ors-status');
  if (orsEl) {
    const srcMap = { ors: '✓ ORS aktiv', valhalla: '✓ Valhalla aktiv', osrm: '✓ OSRM-Näherung aktiv', aerial: 'Luftlinie aktiv' };
    const srcLabel = State.isochroneSource ? (srcMap[State.isochroneSource] || State.isochroneSource) : null;
    orsEl.textContent = State.orsKey
      ? `✓ Key eingetragen${srcLabel ? ' · ' + srcLabel : ''}`
      : `Kein Key — ${srcLabel || 'Valhalla/OSRM Fallback'}`;
    orsEl.style.color = State.orsKey ? '#1d9e75' : (State.isochroneSource ? '#8a8a9a' : '');
  }

  // OCM key
  const ocmEl = document.getElementById('sett-ocm-status');
  if (ocmEl) {
    ocmEl.textContent = State.ocmKey
      ? `✓ Key eingetragen`
      : 'Kein Key — OSM-Fallback aktiv';
    ocmEl.style.color = State.ocmKey ? '#1d9e75' : '';
  }

  // GPX export
  const gpxEl = document.getElementById('sett-gpx-status');
  if (gpxEl) {
    if (State.lastRouteCoords && State.lastRouteCoords.length) {
      const pts    = State.lastRouteCoords.length;
      const hasElev = !!State.lastElevations;
      gpxEl.textContent = `Route bereit · ${pts} Punkte${hasElev ? ' · mit Höhenprofil' : ''}`;
      gpxEl.style.color = '#1d9e75';
    } else {
      gpxEl.textContent = 'Keine Route berechnet';
      gpxEl.style.color = '';
    }
  }

  // Cache stats
  const cacheEl = document.getElementById('sett-cache-status');
  if (cacheEl) {
    const { valid, expired } = _getCacheStats();
    if (valid + expired === 0) {
      cacheEl.textContent = 'Kein Cache vorhanden';
    } else {
      cacheEl.textContent = `${valid} gültig · ${expired} abgelaufen`;
    }
  }
}

function _getCacheStats() {
  let valid = 0, expired = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('ors-iso-v1:')) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        if (entry && entry.ts && Date.now() - entry.ts <= ORS_CACHE_TTL_MS) valid++;
        else expired++;
      } catch { expired++; }
    }
  } catch { /* ignore */ }
  return { valid, expired };
}

// ── Init (called from app.js DOMContentLoaded) ────────────

function initSettingsPanel() {
  document.getElementById('btn-settings').addEventListener('click', openSettingsPanel);
  document.getElementById('settings-close').addEventListener('click', closeSettingsPanel);
  document.getElementById('settings-overlay').addEventListener('click', closeSettingsPanel);

  // ORS Key
  document.getElementById('sett-ors-key').addEventListener('click', () => {
    closeSettingsPanel();
    showOrsKeyPanel();
  });

  // OCM Key
  document.getElementById('sett-ocm-key').addEventListener('click', () => {
    closeSettingsPanel();
    showOcmKeyPanel();
  });

  // GPX Export
  document.getElementById('sett-gpx-export').addEventListener('click', () => {
    closeSettingsPanel();
    exportGpx();
  });

  // Clear cache
  document.getElementById('sett-clear-cache').addEventListener('click', () => {
    isochroneClearCache();
    _updateSettingsStatus();
  });

  // Crossing threshold slider
  const slider   = document.getElementById('sett-crossing-slider');
  const sliderVal = document.getElementById('sett-crossing-val');
  const sliderSub = document.getElementById('sett-crossing-sub');

  if (slider) {
    slider.value = State.crossingMaxDistKm;
    _updateCrossingSliderDisplay(State.crossingMaxDistKm);

    slider.addEventListener('input', () => {
      const v = parseInt(slider.value);
      sliderVal.textContent = `${v} km`;
      _updateCrossingSliderDisplay(v);
    });
    slider.addEventListener('change', () => {
      State.crossingMaxDistKm = parseInt(slider.value);
      localStorage.setItem('crossing-max-km', State.crossingMaxDistKm);
      // Re-detect crossing if route is active
      if (State.lastRouteCoords?.length) {
        _showRouteCrossing(State.lastRouteCoords);
      }
    });
  }
}

function _updateCrossingSliderDisplay(km) {
  const sub = document.getElementById('sett-crossing-sub');
  if (!sub) return;
  if (km <= 10) {
    sub.textContent = `Nur direkte Übergänge (≤${km}km von der Route)`;
  } else if (km <= 30) {
    sub.textContent = `Normale Erkennung — ≤${km}km Umweg erkennbar`;
  } else if (km <= 60) {
    sub.textContent = `Großzügig — auch Übergänge ≤${km}km neben der Route`;
  } else {
    sub.textContent = `Sehr weit — Route kann beliebig durch DE fahren (≤${km}km)`;
  }
}
