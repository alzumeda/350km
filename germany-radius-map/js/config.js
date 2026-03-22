// ── config.js ─────────────────────────────────────────────
// All app-wide constants. Change values here, nowhere else.

const GERMANY_CENTER = [51.1657, 10.4515];

const GERMANY_BORDER = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[
  [6.865,47.271],[7.589,47.596],[8.229,47.956],[8.521,47.809],
  [9.531,47.523],[10.443,47.393],[10.178,47.271],[10.454,46.860],
  [11.133,46.924],[12.154,47.094],[13.032,47.468],[13.841,48.773],
  [13.031,48.975],[12.753,49.412],[14.459,50.888],[14.307,51.016],
  [15.043,51.282],[14.993,51.846],[14.439,53.248],[14.122,53.757],
  [13.476,54.076],[12.369,54.469],[11.011,54.635],[10.312,55.056],
  [9.921,54.981],[9.282,54.830],[8.526,54.963],[8.334,55.058],
  [8.070,54.916],[8.012,54.402],[8.569,53.956],[8.665,53.544],
  [7.924,53.481],[7.100,53.693],[6.906,53.482],[7.036,52.382],
  [6.158,51.892],[5.988,51.832],[6.226,51.360],[6.832,51.966],
  [7.123,51.106],[6.387,50.323],[6.404,49.997],[6.531,49.441],
  [6.359,49.150],[6.173,49.503],[5.898,49.443],[6.002,48.558],
  [6.831,47.982],[6.865,47.271]
]] }};

// ── Allowed countries (ISO 3166-1 alpha-2) ────────────────
// Only fully-coloured countries from the reference map.
// Clicks on any other country show a "not in allowed area" toast.
const ALLOWED_COUNTRIES_LIST = [
  'IS', // Island
  'IE', // Irland
  'GB', // Vereinigtes Königreich
  'NO', // Norwegen
  'SE', // Schweden
  'DK', // Dänemark
  'NL', // Niederlande
  'BE', // Belgien
  'LU', // Luxemburg
  'DE', // Deutschland
  'PL', // Polen
  'FR', // Frankreich
  'CH', // Schweiz
  'LI', // Liechtenstein
  'AT', // Österreich
  'CZ', // Tschechien
  'SI', // Slowenien
  'HR', // Kroatien
  'IT', // Italien
  'SM', // San Marino
  'MC', // Monaco
  'AD', // Andorra
  'VA', // Vatikanstadt
  'ES', // Spanien
  'PT', // Portugal
];
// Fix 4: Set built here so all modules can use it without depending on routing.js load order
const ALLOWED_COUNTRIES = new Set(ALLOWED_COUNTRIES_LIST);

const TILE_LAYERS = {
  standard:     { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',      attr: '© OpenStreetMap contributors',       label: 'Standard' },
  topo:         { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',         attr: '© OpenTopoMap contributors',          label: 'Topo' },
  humanitarian: { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',   attr: '© OpenStreetMap contributors, HOT',   label: 'Humanitarian' },
};

// Number of border points sampled for ORS isochrone requests.
// Free tier: 500 req/day → keep low. 20pts / 5 per batch = 4 requests per calculation.
const ORS_BORDER_SAMPLE_POINTS = 20;
// Points per ORS batch request (free tier limit: 5)
const ORS_BATCH_SIZE = 5;
// Delay between ORS batches in ms (free tier: 40 req/min = 1500ms min)
const ORS_BATCH_DELAY_MS = 1600;
// ORS isochrone cache duration (ms) — avoids re-fetching same radius
const ORS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const POI_TYPES = [
  { query: 'amenity=fuel',        icon: '⛽', label: 'Tankstellen' },
  { query: 'amenity=restaurant',  icon: '🍽', label: 'Restaurants' },
  { query: 'tourism=hotel',       icon: '🏨', label: 'Hotels' },
  { query: 'amenity=hospital',    icon: '🏥', label: 'Krankenhäuser' },
  { query: 'tourism=attraction',  icon: '⭐', label: 'Sehenswürdigkeiten' },
  { query: 'amenity=supermarket', icon: '🛒', label: 'Supermärkte' },
  // EV charging — each tier has minKw for client-side filtering
  { query: 'amenity=charging_station', icon: '⚡', label: 'Lader ≥50 kW',  minKw: 50,  maxKw: 149, color: '#1d9e75' },
  { query: 'amenity=charging_station', icon: '⚡', label: 'Lader ≥150 kW', minKw: 150, maxKw: 349, color: '#e9a020' },
  { query: 'amenity=charging_station', icon: '⚡', label: 'Lader ≥350 kW', minKw: 350, maxKw: null, color: '#e94560' },
];
