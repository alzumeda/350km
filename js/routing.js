// ── routing.js ────────────────────────────────────────────
// OSRM turn-by-turn routing + exact border distance display.

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
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  // Show popup immediately with aerial estimate, then update with driving distance
  const popup = L.popup({ closeButton: true })
    .setLatLng(e.latlng)
    .setContent(_popupHtml(lat, lng, '…', null))
    .openOn(State.map);

  borderDistWithCallback(lat, lng, ({ aerialLabel, driveLabel, km }, done) => {
    const inside = km !== null && km < 0;
    popup.setContent(_popupHtml(lat, lng, aerialLabel, driveLabel, inside));
    // Update route panel border field if visible
    const borderEl = document.getElementById('route-border-dist');
    if (borderEl && document.getElementById('route-panel').style.display === 'block') {
      borderEl.textContent = driveLabel || aerialLabel;
    }
  });

  if (!State.routeMode) return;

  if (!State.userPos) {
    showToast('Erst GPS-Standort aktivieren');
    return;
  }

  const dest = e.latlng;

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

  // Show aerial border distance immediately in panel
  const { km: bKm } = aerialDistToBorder(lat, lng);
  const aerialLbl   = bKm !== null
    ? (bKm < 0 ? `${Math.round(-bKm)} km (in DE)` : `+${Math.round(bKm)} km`)
    : '–';
  document.getElementById('route-border-dist').textContent = aerialLbl;

  // Async: update with driving distance once computed
  drivingDistToBorder(lat, lng).then(driving => {
    if (!driving) return;
    const lbl = `${driving.driveKm.toFixed(1)} km · ${driving.driveMin}min`;
    document.getElementById('route-border-dist').textContent = lbl;
    showToast(`Grenze: ${lbl}`);
  });

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

    document.getElementById('route-dist').textContent    = `${km} km`;
    document.getElementById('route-time').textContent    = hrs > 0 ? `${hrs}h ${min}min` : `${mins} min`;
    document.getElementById('route-panel').style.display = 'block';
    document.getElementById('fab-clear').style.display   = 'flex';
    showToast(`Route: ${km} km`);
  });

  State.routeControl.on('routingerror', () => showToast('Route konnte nicht berechnet werden'));

  State.routeMode = false;
  document.getElementById('btn-route').classList.remove('active');
  document.getElementById('route-mode-banner').style.display = 'none';
}

function _popupHtml(lat, lng, aerialLabel, driveLabel, inside) {
  const color = inside ? '#1d9e75' : '#e94560';
  const status = inside ? '✓ Innerhalb' : '✗ Außerhalb';
  return `
    <div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.7;min-width:180px">
      <b style="color:${color}">${status} des Radius</b><br>
      ✈ Luftlinie Grenze: <b>${aerialLabel}</b><br>
      ${driveLabel ? `🚗 Fahrweg Grenze: <b>${driveLabel}</b>` : '<span style="color:#8a8a9a;font-size:11px">🚗 Fahrweg wird berechnet…</span>'}
      <br><span style="font-size:11px;color:#8a8a9a">${lat.toFixed(4)}°N ${lng.toFixed(4)}°E</span>
    </div>`;
}

function clearRoute() {
  if (State.routeControl)      { State.map.removeControl(State.routeControl);    State.routeControl      = null; }
  if (State.destinationMarker) { State.map.removeLayer(State.destinationMarker); State.destinationMarker = null; }
  document.getElementById('route-panel').style.display = 'none';
  document.getElementById('fab-clear').style.display   = 'none';
}
