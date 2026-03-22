// ── app.js ────────────────────────────────────────────────
// App bootstrap: wires up all event listeners and calls init.

document.addEventListener('DOMContentLoaded', () => {

  // ── Map & radius ──────────────────────────────────────
  initMap();
  initRadiusSliderEvents();
  initOrsEvents();

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
});
