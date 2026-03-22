// ── routing.js ────────────────────────────────────────────
// OSRM turn-by-turn routing between GPS position and map tap.

function toggleRouteMode() {
  State.routeMode = !State.routeMode;
  const btn    = document.getElementById('btn-route');
  const banner = document.getElementById('route-mode-banner');

  if (State.routeMode) {
    btn.classList.add('active');
    banner.style.display = 'block';
    showToast('Ziel auf Karte tippen');
  } else {
    btn.classList.remove('active');
    banner.style.display = 'none';
    clearRoute();
  }
}

function onMapClick(e) {
  if (!State.routeMode) return;

  if (!State.userPos) {
    showToast('Erst GPS-Standort aktivieren');
    return;
  }

  const dest = e.latlng;

  // Destination marker
  if (State.destinationMarker) State.map.removeLayer(State.destinationMarker);
  State.destinationMarker = L.marker(dest, {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;background:#533483;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.5);"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8],
    }),
  }).addTo(State.map);

  if (State.routeControl) { State.map.removeControl(State.routeControl); State.routeControl = null; }

  showToast('Route wird berechnet…');

  State.routeControl = L.Routing.control({
    waypoints: [L.latLng(...State.userPos), L.latLng(dest.lat, dest.lng)],
    routeWhileDragging: false,
    showAlternatives: false,
    lineOptions: {
      styles: [
        { color: '#e94560', weight: 4, opacity: 0.85 },
        { color: 'rgba(233,69,96,0.2)', weight: 8, opacity: 1 },
      ],
    },
    createMarker: () => null,
    router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' }),
  }).addTo(State.map);

  State.routeControl.on('routesfound', ev => {
    const r    = ev.routes[0];
    const km   = (r.summary.totalDistance / 1000).toFixed(1);
    const mins = Math.round(r.summary.totalTime / 60);
    const hrs  = Math.floor(mins / 60);
    const min  = mins % 60;

    document.getElementById('route-dist').textContent = `${km} km`;
    document.getElementById('route-time').textContent = hrs > 0 ? `${hrs}h ${min}min` : `${mins} min`;
    document.getElementById('route-panel').style.display = 'block';
    document.getElementById('fab-clear').style.display   = 'flex';
    showToast(`Route: ${km} km`);
  });

  State.routeControl.on('routingerror', () => showToast('Route konnte nicht berechnet werden'));

  // Exit route mode after placing destination
  State.routeMode = false;
  document.getElementById('btn-route').classList.remove('active');
  document.getElementById('route-mode-banner').style.display = 'none';
}

function clearRoute() {
  if (State.routeControl)      { State.map.removeControl(State.routeControl);    State.routeControl      = null; }
  if (State.destinationMarker) { State.map.removeLayer(State.destinationMarker); State.destinationMarker = null; }
  document.getElementById('route-panel').style.display = 'none';
  document.getElementById('fab-clear').style.display   = 'none';
}
