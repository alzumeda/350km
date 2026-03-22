// ── passes.js ──────────────────────────────────────────────
// Alpine pass data with seasonal closure windows.
// Shows markers on the map and warns when a route passes nearby.

// ── Static pass data ──────────────────────────────────────
// closedFrom / closedTo: month (1–12) when the pass is typically impassable.
// Source: ADAC / TCS / official road-authority data.

const ALPINE_PASSES = [
  { name: 'Brennerpass',       lat: 47.0017, lng: 11.5069, alt: 1374, closedFrom: null,  closedTo: null,  note: 'Ganzjährig (Autobahn)' },
  { name: 'Reschenpass',       lat: 46.8361, lng: 10.5128, alt: 1508, closedFrom: null,  closedTo: null,  note: 'Ganzjährig geöffnet' },
  { name: 'Fernpass',          lat: 47.3667, lng: 10.8667, alt: 1209, closedFrom: null,  closedTo: null,  note: 'Ganzjährig geöffnet' },
  { name: 'Arlbergpass',       lat: 47.1317, lng: 10.2033, alt: 1793, closedFrom: 11,    closedTo: 4,     note: 'Nov–Apr gesperrt (Tunnel empfohlen)' },
  { name: 'Silvretta-Hochalpenstraße', lat: 46.9167, lng: 10.1167, alt: 2032, closedFrom: 11, closedTo: 5, note: 'Nov–Mai gesperrt' },
  { name: 'Timmelsjoch',       lat: 46.8836, lng: 11.1050, alt: 2474, closedFrom: 11,    closedTo: 5,     note: 'Nov–Mai gesperrt' },
  { name: 'Großglockner-Hochalpenstraße', lat: 47.0744, lng: 12.8386, alt: 2571, closedFrom: 11, closedTo: 4, note: 'Nov–Apr gesperrt' },
  { name: 'Nufenenpass',       lat: 46.4783, lng: 8.3856,  alt: 2478, closedFrom: 10,    closedTo: 6,     note: 'Okt–Jun gesperrt' },
  { name: 'Gotthard (Passstraße)', lat: 46.5561, lng: 8.5653, alt: 2108, closedFrom: 11, closedTo: 5,     note: 'Nov–Mai gesperrt (Tunnel verfügbar)' },
  { name: 'Grimselpass',       lat: 46.5722, lng: 8.3361,  alt: 2165, closedFrom: 11,    closedTo: 5,     note: 'Nov–Mai gesperrt' },
  { name: 'Sustenpass',        lat: 46.7275, lng: 8.4461,  alt: 2224, closedFrom: 11,    closedTo: 5,     note: 'Nov–Mai gesperrt' },
  { name: 'Furkapass',         lat: 46.5719, lng: 8.4156,  alt: 2429, closedFrom: 10,    closedTo: 5,     note: 'Okt–Mai gesperrt' },
  { name: 'Flüelapass',        lat: 46.7581, lng: 9.9481,  alt: 2383, closedFrom: 11,    closedTo: 5,     note: 'Nov–Mai gesperrt' },
  { name: 'Maloja',            lat: 46.4256, lng: 9.6983,  alt: 1815, closedFrom: null,  closedTo: null,  note: 'Ganzjährig geöffnet' },
  { name: 'Julierpass',        lat: 46.4956, lng: 9.7283,  alt: 2284, closedFrom: null,  closedTo: null,  note: 'Ganzjährig geöffnet (ggf. Schneeketten)' },
];

// ── State ─────────────────────────────────────────────────

let _passMarkerGroup = null;
let _passMarkersVisible = false;

// ── Helpers ───────────────────────────────────────────────

/**
 * Returns true if the pass is currently closed (using system clock).
 */
function _isCurrentlyClosed(pass) {
  if (pass.closedFrom === null || pass.closedTo === null) return false;
  const month = new Date().getMonth() + 1; // 1–12
  if (pass.closedFrom > pass.closedTo) {
    // wraps around year-end: e.g. Nov(11) → Apr(4)
    return month >= pass.closedFrom || month <= pass.closedTo;
  }
  return month >= pass.closedFrom && month <= pass.closedTo;
}

/**
 * Build a Leaflet divIcon for a pass marker.
 */
function _passIcon(closed) {
  const color = closed ? '#e94560' : '#1d9e75';
  const icon  = closed ? '⛔' : '🏔';
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};
      color:#fff;
      font-size:11px;
      padding:2px 5px;
      border-radius:10px;
      border:2px solid rgba(255,255,255,0.7);
      box-shadow:0 2px 6px rgba(0,0,0,0.5);
      white-space:nowrap;
      font-weight:600;
      line-height:1.4;
    ">${icon}</div>`,
    iconSize:   [26, 22],
    iconAnchor: [13, 11],
  });
}

// ── Public API ────────────────────────────────────────────

/**
 * Toggle pass markers on the map.
 */
function togglePassMarkers() {
  if (!State.map) return;
  const btn = document.getElementById('btn-passes');

  if (_passMarkersVisible && _passMarkerGroup) {
    State.map.removeLayer(_passMarkerGroup);
    _passMarkerGroup = null;
    _passMarkersVisible = false;
    if (btn) btn.classList.remove('active');
    showToast('Pässe ausgeblendet');
    return;
  }

  _passMarkerGroup = L.layerGroup();

  for (const pass of ALPINE_PASSES) {
    const closed = _isCurrentlyClosed(pass);
    const marker = L.marker([pass.lat, pass.lng], { icon: _passIcon(closed) });

    const statusColor = closed ? '#e94560' : '#1d9e75';
    const statusText  = closed ? '⛔ Aktuell gesperrt' : '✅ Geöffnet';
    marker.bindPopup(`
      <div style="font-family:system-ui,sans-serif;font-size:13px;color:#e0e0e0;line-height:1.7;min-width:180px">
        <b style="font-size:14px">🏔 ${pass.name}</b><br>
        <span style="color:#8a8a9a">Höhe: ${pass.alt} m</span><br>
        <span style="color:${statusColor}">${statusText}</span><br>
        <span style="font-size:11px;color:#8a8a9a">${pass.note}</span>
      </div>
    `);
    _passMarkerGroup.addLayer(marker);
  }

  _passMarkerGroup.addTo(State.map);
  _passMarkersVisible = true;
  if (btn) btn.classList.add('active');

  const closedCount = ALPINE_PASSES.filter(_isCurrentlyClosed).length;
  showToast(`🏔 ${ALPINE_PASSES.length} Pässe · ${closedCount} gesperrt`);
}

/**
 * Check whether a route (array of L.LatLng) passes within `thresholdKm`
 * of any currently-closed pass. Returns an array of warning strings.
 *
 * @param {L.LatLng[]} latLngs
 * @param {number}     thresholdKm  default 15 km
 * @returns {string[]}
 */
function checkPassWarnings(latLngs, thresholdKm = 15) {
  if (!latLngs.length) return [];

  // Compute route bounding box for fast pre-filter (1° ≈ 111 km)
  const pad    = thresholdKm / 111;
  let minLat =  Infinity, maxLat = -Infinity;
  let minLng =  Infinity, maxLng = -Infinity;
  for (const p of latLngs) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  minLat -= pad; maxLat += pad;
  minLng -= pad; maxLng += pad;

  const warnings = [];

  for (const pass of ALPINE_PASSES) {
    if (!_isCurrentlyClosed(pass)) continue;
    // Bounding-box pre-filter — skip turf.distance if clearly outside
    if (pass.lat < minLat || pass.lat > maxLat ||
        pass.lng < minLng || pass.lng > maxLng) continue;

    const passPt = turf.point([pass.lng, pass.lat]);
    const near   = latLngs.some(p =>
      turf.distance(turf.point([p.lng, p.lat]), passPt, { units: 'kilometers' }) <= thresholdKm
    );
    if (near) warnings.push(`⛔ ${pass.name} (${pass.alt} m) aktuell gesperrt – ${pass.note}`);
  }

  return warnings;
}

/**
 * Show pass warnings inside #route-pass-warnings (create it if needed).
 * @param {string[]} warnings
 */
function showPassWarnings(warnings) {
  let el = document.getElementById('route-pass-warnings');
  if (!el) return;

  if (!warnings.length) {
    el.innerHTML = '';     // clear content first
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  el.innerHTML = warnings.map(w =>
    `<div style="color:#e94560;font-size:11px;margin-bottom:2px">${w}</div>`
  ).join('');
}
