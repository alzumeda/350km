// ── routing.js ────────────────────────────────────────────
// OSRM routing + border distance + road-type breakdown.

function toggleRouteMode() {
  const btn    = document.getElementById('btn-route');
  const banner = document.getElementById('route-mode-banner');

  if (State.routeMode) {
    // Already active → deactivate
    State.routeMode = false;
    btn.classList.remove('active');
    banner.style.display = 'none';
    clearRoute();
    return;
  }

  // Fix 7: warn immediately if GPS not yet acquired
  if (!State.userPos) {
    showToast('Erst GPS-Standort aktivieren (◎)');
    return;
  }

  State.routeMode = true;
  btn.classList.add('active');
  banner.style.display = 'block';
  showToast('Ziel auf Karte tippen');
}

// ── Country whitelist check ───────────────────────────────

// ALLOWED_COUNTRIES Set is defined in config.js

// Fix 5: LRU cache — max 200 entries
const _CACHE_MAX    = 200;
const _countryCache = new Map();

function _cacheSet(key, value) {
  if (_countryCache.size >= _CACHE_MAX)
    _countryCache.delete(_countryCache.keys().next().value);
  _countryCache.set(key, value);
}

// Fix 5: in-flight dedup — concurrent requests for same key share one Promise
const _inFlight = new Map();

// Fix 1+6: iterative Nominatim queue, 1.05s rate limit, visibility-aware
let _nominatimLastCall = Date.now() - 1100; // Fix 6: no wait on first call
const _nominatimQueue  = [];
let   _nominatimTimer  = null;

function _enqueueNominatim(fn) {
  return new Promise((resolve, reject) => {
    _nominatimQueue.push({ fn, resolve, reject });
    _scheduleNominatim();
  });
}

function _scheduleNominatim() {
  if (_nominatimTimer || !_nominatimQueue.length) return;
  if (document.visibilityState === 'hidden') return; // Fix 3: pause when hidden
  const wait = Math.max(0, _nominatimLastCall + 1050 - Date.now());
  _nominatimTimer = setTimeout(async () => {
    _nominatimTimer = null;
    if (!_nominatimQueue.length) return;
    const { fn, resolve, reject } = _nominatimQueue.shift();
    _nominatimLastCall = Date.now();
    try { resolve(await fn()); } catch (e) { reject(e); }
    _scheduleNominatim(); // Fix 1: iterative, not recursive
  }, wait);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _scheduleNominatim(); // Fix 3: resume on show
});

async function _getCountryCode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_countryCache.has(key)) return _countryCache.get(key);
  if (_inFlight.has(key))     return _inFlight.get(key); // Fix 5: dedup

  const p = _enqueueNominatim(async () => {
    if (_countryCache.has(key)) { _inFlight.delete(key); return _countryCache.get(key); }
    try {
      const url  = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=5`;
      const resp = await fetch(url, { headers: { 'Accept-Language': 'de' } });
      if (!resp.ok) { _cacheSet(key, null); _inFlight.delete(key); return null; }
      const data = await resp.json();
      const code = data.address?.country_code?.toUpperCase() || null;
      _cacheSet(key, code);
      return code;
    } catch {
      _cacheSet(key, null);
      return null;
    } finally {
      _inFlight.delete(key); // Fix 1: always remove after result is cached
    }
  });
  _inFlight.set(key, p);
  return p;
}

async function _checkCountry(lat, lng) {
  const code = await _getCountryCode(lat, lng);
  if (code === null) return 'unknown';
  return ALLOWED_COUNTRIES.has(code) ? 'allowed' : 'blocked';
}

// Fix 2+7: only show loading toast when a real network request is needed
function _needsNominatim(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  return !_countryCache.has(key) && !_inFlight.has(key);
}

// ── Map click handler ─────────────────────────────────────

function onMapClick(e) {
  const lat     = e.latlng.lat;
  const lng     = e.latlng.lng;
  const modeNow = State.routeMode;

  if (modeNow) {
    if (!State.userPos) { showToast('Erst GPS-Standort aktivieren (◎)'); return; }
    if (_needsNominatim(lat, lng)) showToast('Prüfe Land…'); // Fix 2+7
    _checkCountry(lat, lng).then(status => {
      if (!State.routeMode) return; // Fix 3: race guard
      if (status === 'blocked') { showToast('⛔ Land nicht im erlaubten Bereich'); return; }
      _placeDestination(e.latlng);
    });
    return;
  }

  if (_needsNominatim(lat, lng)) showToast('Prüfe Land…'); // Fix 2+7
  _checkCountry(lat, lng).then(status => {
    if (State.routeMode) return; // Fix 3: race guard
    if (status === 'blocked') { showToast('⛔ Land nicht im erlaubten Bereich'); return; }

    let popupOpen = true;
    const popup = L.popup({ closeButton: true, maxWidth: 280 })
      .setLatLng(e.latlng)
      .setContent(_popupHtml({ lat, lng, aerialLabel: '…', driving: null, aerialKm: null }))
      .openOn(State.map);
    popup.on('remove', () => { popupOpen = false; });

    borderDistWithCallback(lat, lng, ({ aerialLabel, km, driving }, done) => {
      if (!popupOpen) return;
      popup.setContent(_popupHtml({ lat, lng, aerialLabel, driving, aerialKm: km }));
      if (done && document.getElementById('route-panel').style.display === 'block') {
        const lbl = driving
          ? `${driving.driveKm.toFixed(1)} km ${driving.driveKm <= State.radiusKm ? '✓' : '✗'}`
          : aerialLabel;
        document.getElementById('route-border-dist').textContent = lbl;
      }
    });
  });
}

function _placeDestination(destLatLng) {
  const lat = destLatLng.lat;
  const lng = destLatLng.lng;

  // always clean up previous marker before placing a new one
  if (State.destinationMarker) {
    State.destinationMarker.remove();
    State.destinationMarker = null;
  }

  State.destinationMarker = L.marker(destLatLng, {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;background:#533483;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.5);"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8],
    }),
  }).addTo(State.map);

  if (State.routeControl) {
    try { State.routeControl.getPlan?.().setWaypoints([]); } catch { /* ignore */ }
    State.map.removeControl(State.routeControl);
    State.routeControl = null;
  }
  showToast('Route wird berechnet…');

  // Show aerial estimate immediately, update after route + crossing detected
  if (State.userPos) {
    const { km: bKm } = aerialDistToBorder(State.userPos[0], State.userPos[1]);
    const nearC = _topNCrossings(State.userPos[0], State.userPos[1], 1)[0] || null;
    let distTxt = '…';
    if (bKm !== null) {
      let dirPart = '';
      if (nearC) {
        try {
          const b = _bearing(State.userPos[0], State.userPos[1], nearC.lat, nearC.lng);
          const {arrow} = _bearingToDirection(b);
          const flag = _countryFlag(nearC.neighbor);
          dirPart = ` ${arrow}${flag ? flag : ''}`;
        } catch { /* skip */ }
      }
      distTxt = bKm < 0 ? `${Math.round(-bKm)} km${dirPart}` : `~${Math.round(bKm)} km${dirPart}`;
    }
    const bdEl = document.getElementById('route-border-dist');
    if (bdEl) bdEl.textContent = distTxt;
  } else {
    const bdEl = document.getElementById('route-border-dist');
    if (bdEl) bdEl.textContent = '…';
  }

  State.routeControl = L.Routing.control({
    waypoints: [L.latLng(...State.userPos), L.latLng(lat, lng)],
    routeWhileDragging: false,
    showAlternatives: false,
    lineOptions: {
      styles: [
        { color: '#e94560', weight: 4, opacity: 0.85 },
        { color: 'rgba(233,69,96,0.2)', weight: 8, opacity: 1 },
      ],
    },
    createMarker: () => null,
    router: L.Routing.osrmv1({
      serviceUrl: 'https://router.project-osrm.org/route/v1',
      routingOptions: { geometries: 'geojson', overview: 'full' },
    }),
  }).addTo(State.map);

  State.routeControl.on('routesfound', ev => {
    const r   = ev.routes[0];
    const km  = (r.summary.totalDistance / 1000).toFixed(1);
    // OSRM gives raw driving time — use it directly for display
    const osrmMins = Math.round(r.summary.totalTime / 60);

    document.getElementById('route-dist').textContent    = `${km} km`;
    document.getElementById('route-time').textContent    = _fmtMin(osrmMins);
    document.getElementById('route-panel').style.display = 'block';
    document.getElementById('fab-clear').style.display   = 'flex';
    document.getElementById('btn-gpx-export').style.display = 'inline-block';
    showToast(`Route: ${km} km`);

    // Robust coordinate extraction
    const latLngs = _extractRouteCoords(r);
    State.lastRouteCoords = latLngs;

    // Mountain context: detect alpine fraction immediately
    const fraction = alpineFraction(latLngs);
    if (fraction > 0.15) {
      const pct = Math.round(fraction * 100);
      showToast(`🏔 ${pct}% der Route im Alpenraum — Fahrzeit kann abweichen`);
    }

    // Elevation profile — also used for speed correction
    if (latLngs.length) {
      fetchAndShowElevation(latLngs).then(() => {
        _showCorrectedTime(latLngs, parseFloat(km), osrmMins);
      }).catch(e => console.warn('[routing] elevation:', e.message));
    }

    // Pass warnings with tunnel alternatives
    const passResults = checkPassWarningsWithAlternatives(latLngs);
    _showPassWarningsWithAlternatives(passResults);
    if (passResults.length) {
      showToast(`⚠ ${passResults.length} gesperrter Pass auf der Route — Alternativen beachten`);
    }

    // Detect which border crossing the route uses
    const routeCrossing = detectRouteCrossing(latLngs, State.crossingMaxDistKm);
    _showRouteCrossing(latLngs);

    // Fix 2: update 'ab Grenze' to show distance from user to the ROUTE crossing
    if (routeCrossing && State.userPos) {
      const [uLat, uLng] = State.userPos;
      // Aerial distance from user to the crossing used
      const aerialToC = turf.distance(
        turf.point([uLng, uLat]),
        turf.point([routeCrossing.lng, routeCrossing.lat]),
        { units: 'kilometers' }
      );
      document.getElementById('route-border-dist').textContent =
        `${Math.round(aerialToC)} km`;
      // Then async driving distance to that crossing
      _osrmDistToPoint(uLat, uLng, routeCrossing.lat, routeCrossing.lng)
        .then(res => {
          if (!res) return;
          const within = res.driveKm <= State.radiusKm;
          const bdEl = document.getElementById('route-border-dist');
          if (bdEl) bdEl.textContent = `${res.driveKm.toFixed(1)} km ${within ? '✓' : '✗'}`;
        }).catch(e => console.warn('[routing] border dist:', e.message));
    }
  });

  State.routeControl.on('routingerror', () => showToast('Route konnte nicht berechnet werden'));

  State.routeMode = false;
  document.getElementById('btn-route').classList.remove('active');
  document.getElementById('route-mode-banner').style.display = 'none';
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Robustly extract an array of L.LatLng from a Leaflet-Routing-Machine route.
 * LRM may expose coords as r.coordinates, r.inputWaypoints, or via legs.
 */
function _extractRouteCoords(route) {
  // Best case: r.coordinates is populated (LRM >= 3.x with OSRM overview)
  if (Array.isArray(route.coordinates) && route.coordinates.length > 1) {
    return route.coordinates;
  }
  // Fallback: flatten leg coordinates
  const legs = route.legs || [];
  const pts  = [];
  for (const leg of legs) {
    const steps = leg.steps || [];
    for (const step of steps) {
      if (Array.isArray(step.geometry?.coordinates)) {
        for (const [lng, lat] of step.geometry.coordinates) {
          pts.push(L.latLng(lat, lng)); // GeoJSON is [lng,lat] → L.latLng(lat,lng) ✓
        }
      }
    }
  }
  if (pts.length > 1) return pts;
  // Last resort: just the waypoints
  return (route.inputWaypoints || route.waypoints || [])
    .map(w => w.latLng)
    .filter(Boolean);
}



function _popupHtml({ lat, lng, aerialLabel, driving, aerialKm }) {
  const limit   = State.radiusKm;
  const driveKm = driving ? driving.driveKm : null;

  // Verdict
  const aerialIn  = aerialKm !== null && aerialKm < 0;
  const driveIn   = driveKm !== null ? driveKm <= limit : null;
  const verdict   = driveIn !== null ? driveIn : (aerialIn || (aerialKm !== null && aerialKm <= limit));
  const color     = verdict ? '#1d9e75' : '#e94560';
  const statusTxt = verdict ? `✓ Innerhalb ${limit} km` : `✗ Außerhalb ${limit} km`;

  // Difference from limit
  let diffHtml = '';
  if (driveKm !== null) {
    const diff = Math.abs(driveKm - limit).toFixed(1);
    diffHtml = driveIn
      ? `<span style="color:#1d9e75;font-size:11px">noch ${diff} km Puffer</span>`
      : `<span style="color:#e94560;font-size:11px">${diff} km über Limit</span>`;
  }

  // Road breakdown
  let breakdownHtml = '';
  if (driving?.roadBreakdown?.length) {
    const rows = driving.roadBreakdown.map(r =>
      `<tr>
        <td style="padding:1px 6px 1px 0;color:#c0c0c0">${r.label}</td>
        <td style="padding:1px 0;text-align:right;color:#e0e0e0">${r.km.toFixed(0)} km</td>
        <td style="padding:1px 0 1px 6px;color:#8a8a9a;font-size:11px">${r.pct}%</td>
      </tr>`
    ).join('');
    breakdownHtml = `
      <div style="border-top:1px solid rgba(255,255,255,0.1);margin-top:6px;padding-top:6px">
        <div style="font-size:11px;color:#8a8a9a;margin-bottom:3px">Straßentypen zur Grenze:</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">${rows}</table>
      </div>`;
  }

  // Driving label
  const candidatesTxt = driving?.candidatesUsed > 1
    ? `<span style="font-size:10px;color:#666"> (beste von ${driving.candidatesUsed} Grenzpunkten)</span>`
    : '';
  const crossingHtml = driving?.crossingName
    ? `<span style="font-size:10px;color:#8a8a9a"> via ${driving.crossingName}</span>`
    : '';
  const driveHtml = driving
    ? `🚗 Fahrweg: <b>${driving.driveKm.toFixed(1)} km · ${_fmtMin(driving.driveMin)}</b>${candidatesTxt}${crossingHtml}<br>${diffHtml}`
    : `<span style="color:#8a8a9a;font-size:11px">🚗 Fahrweg wird berechnet…</span>`;

  return `
    <div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.8;min-width:210px;color:#e0e0e0">
      <b style="color:${color};font-size:14px">${statusTxt}</b><br>
      ✈ Luftlinie: <b>${aerialLabel}</b><br>
      ${driveHtml}
      ${breakdownHtml}
      <div style="margin-top:5px;font-size:11px;color:#666">${lat.toFixed(4)}°N · ${lng.toFixed(4)}°E</div>
    </div>`;
}

function _fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? ' ' + m + 'min' : ''}` : `${min}min`;
}

/**
 * After elevation data loads: compute terrain-corrected travel time
 * and show it alongside the OSRM time in the route panel.
 */
function _showCorrectedTime(latLngs, km, osrmMins) {
  const elevations = State.lastElevations;
  const speed      = estimateRouteSpeed(latLngs, elevations);
  const corrMins   = Math.round((km / speed) * 60);

  // Only show correction if meaningfully different from OSRM (>5%)
  const diff = Math.abs(corrMins - osrmMins);
  if (diff < osrmMins * 0.05 || !elevations) return;

  const timeEl = document.getElementById('route-time');
  if (!timeEl) return;

  const osrmStr = _fmtMin(osrmMins);
  const corrStr = _fmtMin(corrMins);
  const icon    = speed <= 65 ? '🏔' : speed <= 72 ? '⛰' : '';

  // Show both: OSRM (GPS-nav) and terrain-corrected estimate
  timeEl.innerHTML = `
    <span title="OSRM-Navigationszeit">${osrmStr}</span>
    <br><span style="font-size:11px;color:#8a8a9a" title="Terrainkorrigierte Schätzung (${speed}km/h)">${icon} ~${corrStr} inkl. Terrain</span>`;
}

/**
 * Show pass warnings with tunnel alternatives in the route panel.
 */
function _showPassWarningsWithAlternatives(results) {
  const el = document.getElementById('route-pass-warnings');
  if (!el) return;

  if (!results.length) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }

  el.style.display = 'block';
  el.innerHTML = results.map(r => {
    const altHtml = r.alternative
      ? `<div style="color:#8a8a9a;font-size:10px;margin-top:1px">${r.alternative}</div>`
      : '';
    return `<div style="margin-bottom:4px">
      <div style="color:#e94560;font-size:11px">${r.warning}</div>
      ${altHtml}
    </div>`;
  }).join('');
}

/**
 * Detect and display the border crossing used by the route.
 * Uses State.crossingMaxDistKm as the proximity threshold.
 */
/**
 * OSRM driving distance from (fromLat,fromLng) to (toLat,toLng).
 * Returns { driveKm, driveMin } or null.
 */
async function _osrmDistToPoint(fromLat, fromLng, toLat, toLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/` +
      `${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.code !== 'Ok' || !data.routes?.length) return null;
      return {
        driveKm:  data.routes[0].distance / 1000,
        driveMin: Math.round(data.routes[0].duration / 60),
      };
    } finally { clearTimeout(tid); }
  } catch { return null; }
}

function _showRouteCrossing(latLngs) {
  const el = document.getElementById('route-crossing');
  if (!el) return;

  const crossing = detectRouteCrossing(latLngs, State.crossingMaxDistKm);

  if (!crossing) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const neighborFlag = {
    NL: '🇳🇱', BE: '🇧🇪', LU: '🇱🇺', FR: '🇫🇷',
    CH: '🇨🇭', AT: '🇦🇹', CZ: '🇨🇿', PL: '🇵🇱', DK: '🇩🇰',
  };
  const flag = crossing.neighbor ? (neighborFlag[crossing.neighbor] || '🏁') : '🏁';

  // Direction from user to crossing
  let dirStr = '';
  if (State.userPos) {
    try {
      const b = _bearing(State.userPos[0], State.userPos[1], crossing.lat, crossing.lng);
      const {arrow, compass} = _bearingToDirection(b);
      dirStr = ` · ${arrow} ${compass}`;
    } catch { /* skip */ }
  }

  el.style.display = 'block';
  el.innerHTML = `
    <span style="color:var(--text-muted)">Grenzübergang:</span>
    <span style="color:var(--text);font-weight:500;margin-left:4px">${flag} ${crossing.name}${dirStr}</span>
    ${crossing.distKm >= 2 ? `<span style="color:var(--text-muted);font-size:10px"> (~${crossing.distKm}km von Route)</span>` : ''}`;
}

function clearRoute() {
  if (State.routeControl)      { State.map.removeControl(State.routeControl);    State.routeControl      = null; }
  if (State.destinationMarker) {
    State.destinationMarker.remove(); // removes from map + internal layer registry
    State.destinationMarker = null;
  }
  State.lastRouteCoords = null;
  document.getElementById('route-panel').style.display = 'none';
  document.getElementById('fab-clear').style.display   = 'none';
  document.getElementById('btn-gpx-export').style.display = 'none';
  const crossEl = document.getElementById('route-crossing');
  if (crossEl) { crossEl.style.display = 'none'; crossEl.innerHTML = ''; }
  clearElevation();
  showPassWarnings([]);
}

/**
 * Reset the passes button visual state (call when markers are removed externally).
 */
function resetPassesButton() {
  const btn = document.getElementById('btn-passes');
  if (btn) btn.classList.remove('active');
}
