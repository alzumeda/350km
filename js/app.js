// ── app.js ────────────────────────────────────────────────
// App bootstrap: wires up all event listeners and calls init.

document.addEventListener('DOMContentLoaded', () => {

  // ── Map & radius ──────────────────────────────────────
  initMap();
  initRadiusSliderEvents();
  initOrsEvents();
  _updateOrsKeyBtn(); // show key status on load

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
});

// ── ORS key button status ──────────────────────────────────
function _updateOrsKeyBtn() {
  const btn = document.getElementById('rmode-ors-key-btn');
  if (!btn) return;
  const hasKey = !!State.orsKey;
  btn.textContent = hasKey ? '🔑 ORS ✓' : '🔑 ORS-Key';
  btn.style.color = hasKey ? '#1d9e75' : '';
}
