// ── poi.js ────────────────────────────────────────────────
// POI search via Overpass API.

function showPoiMenu() {
  const panel = document.getElementById('poi-panel');
  const list  = document.getElementById('poi-list');
  document.getElementById('poi-title').textContent = 'Kategorie wählen';
  list.innerHTML = '';

  POI_TYPES.forEach(type => {
    const item = document.createElement('div');
    item.className = 'poi-item';
    item.innerHTML = `
      <div class="poi-icon">${type.icon}</div>
      <div>
        <div class="poi-name">${type.label}</div>
        <div class="poi-dist">im <span class="poi-radius-val">${State.radiusKm}</span>km Radius</div>
      </div>`;
    item.addEventListener('click', () => searchPOI(type));
    list.appendChild(item);
  });

  panel.style.display = 'flex';
  document.getElementById('btn-poi').classList.add('active');
}

async function searchPOI(type) {
  const panel = document.getElementById('poi-panel');
  const list  = document.getElementById('poi-list');
  document.getElementById('poi-title').textContent = `${type.icon} ${type.label}`;
  list.innerHTML = _loadingMsg('Wird gesucht…');
  clearPoiMarkers();

  // Overpass bbox covers Germany + generous buffer
  const bbox = '44.0,1.5,58.0,19.5';
  const q    = `[out:json][timeout:15];node[${type.query}](${bbox});out 40;`;

  try {
    const res      = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
    const data     = await res.json();
    const elements = data.elements || [];

    if (!elements.length) { list.innerHTML = _loadingMsg('Keine Ergebnisse gefunden'); return; }

    const center   = State.userPos || GERMANY_CENTER;
    const filtered = elements
      .filter(el => _isInsideBorderRadius(el.lat, el.lon))
      .map(el => ({ ...el, dist: distanceKm(el.lat, el.lon, center[0], center[1]) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 30);

    list.innerHTML = '';
    filtered.forEach(el => _renderPoiItem(el, type, panel));
    showToast(`${filtered.length} ${type.label} gefunden`);

  } catch {
    list.innerHTML = _loadingMsg('Fehler beim Laden');
  }
}

function _isInsideBorderRadius(lat, lon) {
  try {
    const pt      = turf.point([lon, lat]);
    const nearest = turf.nearestPointOnLine(turf.polygonToLine(GERMANY_BORDER), pt, { units: 'kilometers' });
    const inside  = turf.booleanPointInPolygon(pt, GERMANY_BORDER);
    return inside || nearest.properties.dist <= State.radiusKm;
  } catch {
    return distanceKm(lat, lon, GERMANY_CENTER[0], GERMANY_CENTER[1]) <= State.radiusKm + 200;
  }
}

function _renderPoiItem(el, type, panel) {
  const name = el.tags?.name || el.tags?.['name:de'] || type.label;
  const item = document.createElement('div');
  item.className = 'poi-item';
  item.innerHTML = `
    <div class="poi-icon">${type.icon}</div>
    <div>
      <div class="poi-name">${name}</div>
      <div class="poi-dist">${Math.round(el.dist)} km entfernt</div>
    </div>`;
  item.addEventListener('click', () => {
    State.map.flyTo([el.lat, el.lon], 14);
    panel.style.display = 'none';
    document.getElementById('btn-poi').classList.remove('active');
  });
  document.getElementById('poi-list').appendChild(item);

  const icon = L.divIcon({
    className: '',
    html: `<div style="background:#1a1a2e;border:2px solid #533483;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">${type.icon}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  });
  const m = L.marker([el.lat, el.lon], { icon })
    .addTo(State.map)
    .bindPopup(`<b>${name}</b><br><small>${Math.round(el.dist)} km entfernt</small>`);
  State.poiMarkers.push(m);
}

function clearPoiMarkers() {
  State.poiMarkers.forEach(m => State.map.removeLayer(m));
  State.poiMarkers = [];
}

function _loadingMsg(text) {
  return `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;font-family:system-ui,sans-serif">${text}</div>`;
}
