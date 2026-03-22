// ── state.js ──────────────────────────────────────────────
// Single source of truth for mutable app state.
// All modules read/write through this object.

const State = {
  // Map
  map: null,
  tileLayer: null,
  currentTileKey: 'standard',

  // Radius
  radiusKm: parseInt(localStorage.getItem('radius-km') || '350', 10),
  get radiusM() { return this.radiusKm * 1000; },
  radiusMode: 'aerial', // 'aerial' | 'road' | 'time'

  // Map layers
  radiusLayer: null,      // current aerial buffer polygon
  borderLine: null,       // faint Germany outline
  orsLayer: null,         // ORS isochrone polygon

  // GPS
  userPos: null,          // [lat, lng] or null
  userMarker: null,
  watchId: null,

  // Routing
  routeControl: null,
  destinationMarker: null,
  routeMode: false,
  lastRouteCoords: null,   // L.LatLng[] of current route for GPX export

  // POI
  poiMarkers: [],

  // ORS
  orsKey: localStorage.getItem('ors-key') || '',
  orsLoading: false,

  // OCM
  ocmKey: localStorage.getItem('ocm-key') || '',

  // OpenChargeMap
  ocmKey: localStorage.getItem('ocm-key') || '',

  // UI chips (set after DOM ready)
  chips: {},
};
