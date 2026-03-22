// ── app.js ────────────────────────────────────────────────
// App bootstrap: wires up all event listeners and calls init.

document.addEventListener('DOMContentLoaded', () => {

  // ── Map & radius ──────────────────────────────────────
  initMap();
  initRadiusSliderEvents();
  initOrsEvents();
  initSettingsPanel();
  _updateOrsKeyBtn(); // show key status on load

  // ── Dynamic bottom bar height ─────────────────────────
  // ResizeObserver keeps --bar-h exactly equal to bottom panel height
  // so FABs and panels are never covered regardless of chip visibility.
  const bottomPanel = document.getElementById('bottom-panel');
  if (bottomPanel && window.ResizeObserver) {
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const h = Math.ceil(e.contentRect.height) + 8; // 8px breathing room
        document.documentElement.style.setProperty('--bar-h', `${h}px`);
      }
    });
    ro.observe(bottomPanel);
  }

  // Radius button: tap = toggle mode bar, long-press = open slider (handled in radius.js)
  document.getElementById('btn-radius').addEventListener('click', () => {
    const bar = document.getElementById('radius-mode-bar');
    const open = bar.classList.contains('visible');
    bar.classList.toggle('visible', !open);
    document.getElementById('btn-radius').classList.toggle('active', !open);
    if (!open) State.map.flyTo(GERMANY_CENTER, 5);
  });
  // Set icon
  document.getElementById('btn-radius').querySelector('.icon').textContent = '⚙';

  // ── GPS ───────────────────────────────────────────────
  document.getElementById('fab-locate').addEventListener('click', locateUser);

  // ── Routing ───────────────────────────────────────────
  document.getElementById('btn-route').addEventListener('click', toggleRouteMode);
  document.getElementById('route-close').addEventListener('click', clearRoute);

  // ── POI ───────────────────────────────────────────────
  document.getElementById('btn-poi').addEventListener('click', () => {
    const panel = document.getElementById('poi-panel');
    if (panel.style.display === 'flex') {
      panel.style.display = 'none';
      document.getElementById('btn-poi').classList.remove('active');
    } else {
      showPoiMenu();
    }
  });
  document.getElementById('poi-close').addEventListener('click', () => {
    document.getElementById('poi-panel').style.display = 'none';
    document.getElementById('btn-poi').classList.remove('active');
  });

  // ── Search ────────────────────────────────────────────
  initSearch();

  document.getElementById('btn-gpx-export').addEventListener('click', exportGpx);

  // ── OCM Key panel ─────────────────────────────────────
  document.getElementById('ocm-save-btn').addEventListener('click', () => {
    const key = document.getElementById('ocm-key-input').value.trim();
    State.ocmKey = key;
    localStorage.setItem('ocm-key', key);
    hideOcmKeyPanel();
    showToast(key ? '✓ OCM API-Key gespeichert' : 'OCM-Key geleert — Fallback auf OSM');
    if (typeof _updateSettingsStatus === 'function') _updateSettingsStatus();
  });
  document.getElementById('ocm-cancel-btn').addEventListener('click', hideOcmKeyPanel);
  document.getElementById('ocm-overlay').addEventListener('click', hideOcmKeyPanel);

  // ── OCM Key Panel ─────────────────────────────────────
  document.getElementById('ocm-save-btn').addEventListener('click', () => {
    const key = document.getElementById('ocm-key-input').value.trim();
    if (!key) { showToast('Bitte API-Key eingeben'); return; }
    State.ocmKey = key;
    localStorage.setItem('ocm-key', key);
    hideOcmKeyPanel();
    showToast('✓ OpenChargeMap Key gespeichert');
  });
  document.getElementById('ocm-cancel-btn').addEventListener('click', hideOcmKeyPanel);
  document.getElementById('ocm-overlay').addEventListener('click', hideOcmKeyPanel);

  // ── Passes toggle ─────────────────────────────────────
  document.getElementById('btn-passes').addEventListener('click', togglePassMarkers);

  // ── Layer toggle ──────────────────────────────────────
  document.getElementById('btn-layer').addEventListener('click', toggleTileLayer);

  // ── FABs ──────────────────────────────────────────────
  document.getElementById('fab-germany').addEventListener('click', () =>
    State.map.flyTo(GERMANY_CENTER, 5, { duration: 1.2 })
  );

  document.getElementById('fab-clear').addEventListener('click', () => {
    clearRoute();
    clearPoiMarkers();
    document.getElementById('poi-panel').style.display = 'none';
    document.getElementById('btn-poi').classList.remove('active');
  });

  // ── iOS banner ────────────────────────────────────────
  initIosBanner();

  // ── Service Worker ────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // ── High-res DE border (async, non-blocking) ──────────
  // Loads ~5000-point OSM border into sessionStorage cache.
  // All border distance calculations auto-upgrade once loaded.
  loadHighResBorder();

  // ── Live border crossings (async, non-blocking) ────────
  // Loads all ~140 German Grenzübergänge from Overpass, 24h cached.
  // Falls back to 24 hardcoded crossings if Overpass unavailable.
  loadLiveCrossings();

  // Fix 5: clean up expired ORS cache entries on startup
  _cleanExpiredOrsCache();
});

function _cleanExpiredOrsCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('ors-iso-v1:')) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        if (!entry || !entry.ts || Date.now() - entry.ts > ORS_CACHE_TTL_MS) {
          keysToRemove.push(key);
        }
      } catch { keysToRemove.push(key); }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ── ORS key button status ──────────────────────────────────
function _updateOrsKeyBtn() {
  const btn = document.getElementById('rmode-ors-key-btn');
  if (!btn) return;
  const hasKey = !!State.orsKey;
  btn.textContent = hasKey ? '🔑 ORS ✓' : '🔑 ORS-Key';
  btn.style.color = hasKey ? '#1d9e75' : '';
}
