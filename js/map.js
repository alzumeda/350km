// ── map.js ────────────────────────────────────────────────
// Leaflet map init and tile layer management.

// Fix 3: single shared turf.buffer cache used by gps.js, search.js, poi.js
let _sharedRadiusBuffer   = null;
let _sharedRadiusBufferKm = null;

function getSharedRadiusBuffer() {
  if (_sharedRadiusBuffer && _sharedRadiusBufferKm === State.radiusKm)
    return _sharedRadiusBuffer;
  try {
    _sharedRadiusBuffer   = turf.buffer(GERMANY_BORDER, State.radiusKm, { units: 'kilometers', steps: 32 });
    _sharedRadiusBufferKm = State.radiusKm;
  } catch {
    _sharedRadiusBuffer   = null;
    _sharedRadiusBufferKm = null;
  }
  return _sharedRadiusBuffer;
}

function initMap() {
  State.map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
  }).setView(GERMANY_CENTER, 5);

  State.tileLayer = L.tileLayer(TILE_LAYERS.standard.url, {
    attribution: TILE_LAYERS.standard.attr,
    maxZoom: 18,
  }).addTo(State.map);

  // Draw initial radius
  drawRadius();

  // Init chips
  State.chips.radius   = document.getElementById('chip-radius');
  State.chips.location = document.getElementById('chip-location');
  State.chips.dist     = document.getElementById('chip-dist');

  State.chips.radius.classList.add('visible');
  State.chips.radius.style.cursor = 'pointer';
  State.chips.radius.title = 'Radius ändern';
  State.chips.radius.addEventListener('click', openRadiusSlider);

  updateRadiusLabels();

  // Hide loading screen
  setTimeout(() => document.getElementById('loading').classList.add('hidden'), 600);

  // Map click → routing
  State.map.on('click', (e) => {
    document.getElementById('search-results').style.display = 'none';
    onMapClick(e);
  });
}

function toggleTileLayer() {
  const keys = Object.keys(TILE_LAYERS);
  const next = keys[(keys.indexOf(State.currentTileKey) + 1) % keys.length];
  State.currentTileKey = next;
  State.tileLayer.setUrl(TILE_LAYERS[next].url);
  showToast('Layer: ' + TILE_LAYERS[next].label);
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
