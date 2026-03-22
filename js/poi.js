// ── poi.js ────────────────────────────────────────────────
// POI search via Overpass API.

// Fix 3: AbortController so only the latest search request is active
let _poiAbortCtrl = null;

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

  // Fix 3: cancel any in-flight Overpass request
  if (_poiAbortCtrl) _poiAbortCtrl.abort();
  _poiAbortCtrl = new AbortController();
  const signal = _poiAbortCtrl.signal;

  // Overpass bbox covers Germany + generous buffer
  const bbox = '44.0,1.5,58.0,19.5';
  // For EV chargers request more results (filtered client-side by kW)
  const limit = type.minKw != null ? 200 : 40;
  const q     = `[out:json][timeout:25];node[${type.query}](${bbox});out ${limit};`;

  try {
    let elements = [];
    let source   = 'Overpass';

    // EV charger: OCM if key available, else Overpass directly (no blocking)
    if (type.minKw != null) {
      if (State.ocmKey) {
        const ocmResults = await _fetchOcm(type, signal);
        if (ocmResults && ocmResults.length) {
          elements = ocmResults;
          source   = 'OpenChargeMap';
        } else {
          // OCM failed or returned nothing — fall back to Overpass
          showToast('OCM nicht verfügbar — lade OSM-Daten…');
          elements = await _fetchOverpassEv(type, signal);
        }
      } else {
        // No key — use Overpass silently
        elements = await _fetchOverpassEv(type, signal);
      }
    } else {
      const q   = `[out:json][timeout:25];node[${type.query}](${'44.0,1.5,58.0,19.5'});out 40;`;
      const res  = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { signal });
      const data = await res.json();
      elements   = data.elements || [];
    }

    if (!elements.length) { list.innerHTML = _loadingMsg('Keine Ergebnisse gefunden'); return; }

    const center   = State.userPos || GERMANY_CENTER;
    const filtered = elements
      .filter(el => _isInsideBorderRadius(el.lat, el.lon))
      .map(el => ({ ...el, dist: distanceKm(el.lat, el.lon, center[0], center[1]) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 30);

    list.innerHTML = '';

    if (type.minKw != null && State.userPos) {
      // EV charger: enrich top-5 by aerial with OSRM drive time, then re-sort
      filtered.forEach(el => _renderPoiItem(el, type, panel, true)); // show immediately
      showToast(`${filtered.length} ${type.label} gefunden (${source}) – berechne Fahrzeit…`);
      _enrichEvWithDriveTime(filtered, type, panel);
    } else {
      filtered.forEach(el => _renderPoiItem(el, type, panel, false));
      showToast(`${filtered.length} ${type.label} gefunden (${source})`);
    }

  } catch (err) {
    if (err.name === 'AbortError') return; // Fix 3: silently ignore cancelled requests
    list.innerHTML = _loadingMsg('Fehler beim Laden');
  }
}

// ── OpenChargeMap integration ─────────────────────────────

function showOcmKeyPanel(pendingType) {
  document.getElementById('ocm-overlay').style.display = 'block';
  document.getElementById('ocm-panel').style.display   = 'flex';
  if (State.ocmKey) document.getElementById('ocm-key-input').value = State.ocmKey;
  // Store pending type so save-btn can re-trigger search
  document.getElementById('ocm-panel').dataset.pendingType = JSON.stringify(pendingType);
}

function hideOcmKeyPanel() {
  document.getElementById('ocm-overlay').style.display = 'none';
  document.getElementById('ocm-panel').style.display   = 'none';
}

/**
 * Fetch EV chargers from Overpass API and filter by kW tier.
 * Returns normalised elements array (compatible with OCM shape).
 */
async function _fetchOverpassEv(type, signal) {
  const bbox = '44.0,1.5,58.0,19.5';
  const q    = `[out:json][timeout:25];node[amenity=charging_station](${bbox});out 200;`;
  try {
    const res  = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`, { signal });
    const data = await res.json();
    return (data.elements || []).filter(el => {
      const kw = _extractKw(el.tags);
      if (kw === null) return false;
      return kw >= type.minKw && (type.maxKw === null || kw < type.maxKw);
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return [];
  }
}

/**
 * Fetch EV chargers from OpenChargeMap API.
 * Returns array of normalised elements compatible with the existing render pipeline,
 * or null on failure.
 *
 * OCM API docs: https://openchargemap.org/site/developerinfo
 */
async function _fetchOcm(type, signal) {
  if (!State.ocmKey) return null;

  // Build bounding box: rough Europe bounding box matching Overpass bbox
  const params = new URLSearchParams({
    output:          'json',
    key:             State.ocmKey,
    maxresults:      200,
    compact:         true,
    verbose:         false,
    boundingbox:     true,
    latitude:        51.0,
    longitude:       10.0,
    distance:        2000,   // km radius from DE centre — large enough to cover all allowed countries
    distanceunit:    'km',
    minpowerkw:      type.minKw,
    ...(type.maxKw !== null ? { maxpowerkw: type.maxKw - 1 } : {}),
    statustypeid:    0, // 0 = all statuses (include available + unknown)
  });

  try {
    const resp = await fetch(
      `https://api.openchargemap.io/v3/poi?${params}`,
      { signal, headers: { 'X-API-Key': State.ocmKey } }
    );
    if (resp.status === 401) {
      showToast('⚠ OCM API-Key ungültig');
      State.ocmKey = '';
      localStorage.removeItem('ocm-key');
      return null;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data) || !data.length) return null;

    // Normalise to same shape as Overpass elements
    return data
      .filter(p => p.AddressInfo?.Latitude && p.AddressInfo?.Longitude)
      .map(p => {
        const lat   = p.AddressInfo.Latitude;
        const lon   = p.AddressInfo.Longitude;
        const name  = p.AddressInfo.Title || p.OperatorInfo?.Title || 'Ladestation';
        // Max kW across all connections
        const conns = p.Connections || [];
        const maxKw = conns.reduce((max, c) => {
          const kw = c.PowerKW || (c.Amps && c.Voltage ? (c.Amps * c.Voltage) / 1000 : 0);
          return kw > max ? kw : max;
        }, 0);
        // Socket types
        const socketTypes = [...new Set(
          conns.map(c => c.ConnectionType?.Title).filter(Boolean)
        )];
        // Status
        const statusId   = p.StatusType?.ID;
        const statusText = p.StatusType?.Title || '';
        const isAvailable = statusId === 50; // 50 = Operational

        return {
          lat, lon,
          // mimic OSM element shape
          tags: {
            name,
            'charging_station:output': maxKw ? `${maxKw} kW` : '',
            _ocmSockets:   socketTypes.join(', '),
            _ocmStatus:    statusText,
            _ocmAvailable: isAvailable,
            _ocmConnCount: conns.length,
            _ocmId:        p.ID,
          },
          _fromOcm: true,
        };
      });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    return null;
  }
}

/**
 * Build socket summary for OCM-sourced elements (uses pre-normalised tag).
 */
function _ocmSocketSummary(tags) {
  return tags._ocmSockets || '';
}

/**
 * Build status badge HTML for OCM elements.
 */
function _ocmStatusBadge(tags) {
  if (!tags._ocmStatus) return '';
  const color = tags._ocmAvailable ? '#1d9e75' : '#8a8a9a';
  return `<span style="color:${color};font-size:10px"> · ${tags._ocmStatus}</span>`;
}

/**
 * Fetch OSRM drive times for top-5 EV results, re-sort list by drive time,
 * update the panel, and route to the nearest one.
 */
async function _enrichEvWithDriveTime(filtered, type, panel) {
  if (!State.userPos) return;
  const [uLat, uLng] = State.userPos;

  // Take top 5 by aerial, fetch drive times in parallel
  const top5    = filtered.slice(0, 5);
  const times   = await Promise.all(top5.map(el => _osrmDuration(uLat, uLng, el.lat, el.lon)));

  // Attach drive time; keep aerial dist as fallback
  top5.forEach((el, i) => { el.driveMin = times[i]; });

  // Sort: stations with drive time first (by time), then remaining by aerial
  const withTime    = top5.filter(el => el.driveMin !== null).sort((a, b) => a.driveMin - b.driveMin);
  const withoutTime = top5.filter(el => el.driveMin === null);
  const rest        = filtered.slice(5);
  const sorted      = [...withTime, ...withoutTime, ...rest];

  // Re-render top 3 with drive time, rest without
  const list = document.getElementById('poi-list');
  if (!list) return;
  list.innerHTML = '';
  sorted.slice(0, 3).forEach(el  => _renderPoiItem(el, type, panel, false, true));
  sorted.slice(3, 30).forEach(el => _renderPoiItem(el, type, panel, false, false));

  if (withTime.length) {
    const nearest = withTime[0];
    const t = nearest.driveMin;
    const timeStr = t >= 60 ? `${Math.floor(t/60)}h ${t%60}min` : `${t}min`;
    showToast(`Nächste: ${Math.round(nearest.dist)} km · ${timeStr} – Route wird berechnet…`);
    _routeToEv(nearest);
  }
}

/**
 * OSRM duration-only request (no overview, fast).
 * Returns drive time in minutes or null on error.
 */
async function _osrmDuration(fromLat, fromLng, toLat, toLng) {
  try {
    const url  = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 6000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.code !== 'Ok' || !data.routes?.length) return null;
      return Math.round(data.routes[0].duration / 60);
    } finally {
      clearTimeout(tid);
    }
  } catch {
    return null;
  }
}

/**
 * Draw an OSRM route from user position to the given EV charger element.
 * Reuses the existing routing infrastructure.
 */
function _routeToEv(el) {
  if (!State.userPos || !State.map) return;
  // Clear any existing route first
  clearRoute();
  // Use the standard _placeDestination flow
  _placeDestination(L.latLng(el.lat, el.lon));
}

/**
 * Extract max kW output from OSM charging_station tags.
 * OSM uses various tag schemes — we check the most common ones.
 * Returns the highest kW value found, or null if not determinable.
 */
function _extractKw(tags) {
  if (!tags) return null;

  // 1. Direct output tag: charging_station:output = "50 kW" or "50000 W"
  const directOutput = tags['charging_station:output'] || tags['socket:output'];
  if (directOutput) {
    const kw = _parseKwString(directOutput);
    if (kw !== null) return kw;
  }

  // 2. Per-socket output tags: socket:type2:output, socket:ccs:output, etc.
  const socketKeys = Object.keys(tags).filter(k =>
    k.startsWith('socket:') && k.endsWith(':output')
  );
  if (socketKeys.length) {
    const values = socketKeys.map(k => _parseKwString(tags[k])).filter(v => v !== null);
    if (values.length) return Math.max(...values);
  }

  // 3. maxpower tag (some mappers use this)
  if (tags.maxpower) {
    const kw = _parseKwString(tags.maxpower);
    if (kw !== null) return kw;
  }

  return null;
}

function _parseKwString(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  // e.g. "350 kw", "350kw", "350000 w", "350000w"
  const kwMatch = s.match(/^([\d.]+)\s*kw/);
  if (kwMatch) return parseFloat(kwMatch[1]);
  const wMatch  = s.match(/^([\d.]+)\s*w/);
  if (wMatch)  return parseFloat(wMatch[1]) / 1000;
  return null;
}

// Fix 4: use shared buffer instead of per-point turf.nearestPointOnLine+polygonToLine
function _isInsideBorderRadius(lat, lon) {
  try {
    const buf = getSharedRadiusBuffer();
    if (!buf) throw new Error('no buf');
    return turf.booleanPointInPolygon(turf.point([lon, lat]), buf);
  } catch {
    return distanceKm(lat, lon, GERMANY_CENTER[0], GERMANY_CENTER[1]) <= State.radiusKm + 200;
  }
}

function _renderPoiItem(el, type, panel, pending = false, showDriveTime = false) {
  const name    = el.tags?.name || el.tags?.['name:de'] || type.label;
  const isEv    = type.minKw != null;
  const kw      = isEv ? _extractKw(el.tags) : null;
  const kwStr   = kw !== null ? `${Math.round(kw)} kW` : '';
  const color   = type.color || '#533483';
  const sockets = isEv
    ? (el._fromOcm ? _ocmSocketSummary(el.tags) : _evSocketSummary(el.tags))
    : '';
  const statusBadge = el._fromOcm ? _ocmStatusBadge(el.tags) : '';

  // Drive time badge
  let driveStr = '';
  if (showDriveTime && el.driveMin !== null && el.driveMin !== undefined) {
    const t = el.driveMin;
    driveStr = t >= 60 ? `${Math.floor(t/60)}h ${t%60}min` : `${t}min`;
  } else if (pending && isEv) {
    driveStr = '…';
  }

  const item = document.createElement('div');
  item.className = 'poi-item';
  item.innerHTML = `
    <div class="poi-icon" style="${isEv ? `color:${color}` : ''}">${type.icon}</div>
    <div style="flex:1">
      <div class="poi-name">${name}${kwStr ? ` <span style="color:${color};font-size:11px;font-weight:700">${kwStr}</span>` : ''}</div>
      <div class="poi-dist">
        ${Math.round(el.dist)} km
        ${driveStr ? `· <span style="color:${color};font-weight:600">🚗 ${driveStr}</span>` : ''}
        ${sockets ? '· ' + sockets : ''}
        ${statusBadge}
      </div>
    </div>`;
  item.addEventListener('click', () => {
    State.map.flyTo([el.lat, el.lon], 14);
    panel.style.display = 'none';
    document.getElementById('btn-poi').classList.remove('active');
  });
  document.getElementById('poi-list').appendChild(item);

  // Map marker — EV chargers use tier colour
  const borderColor = color;
  const icon = L.divIcon({
    className: '',
    html: `<div style="background:#1a1a2e;border:2px solid ${borderColor};border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">${type.icon}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  });

  const popupContent = isEv
    ? `<div style="font-family:system-ui,sans-serif;font-size:13px;color:#e0e0e0;line-height:1.7">
        <b>${name}</b><br>
        ${kwStr ? `<span style="color:${color};font-weight:700">⚡ ${kwStr}</span><br>` : ''}
        ${sockets ? `<span style="font-size:11px;color:#8a8a9a">${sockets}</span><br>` : ''}
        ${el._fromOcm && el.tags._ocmStatus ? `<span style="font-size:11px;color:${el.tags._ocmAvailable ? '#1d9e75' : '#8a8a9a'}">${el.tags._ocmStatus}</span><br>` : ''}
        ${el._fromOcm && el.tags._ocmConnCount ? `<span style="font-size:11px;color:#8a8a9a">${el.tags._ocmConnCount} Anschlüsse</span><br>` : ''}
        <small>${Math.round(el.dist)} km entfernt</small>
       </div>`
    : `<b>${name}</b><br><small>${Math.round(el.dist)} km entfernt</small>`;

  const m = L.marker([el.lat, el.lon], { icon })
    .addTo(State.map)
    .bindPopup(popupContent);
  State.poiMarkers.push(m);
}

/** Summarise available socket types from OSM tags */
function _evSocketSummary(tags) {
  if (!tags) return '';
  const SOCKET_LABELS = {
    'socket:type2':       'Type 2',
    'socket:type2_combo': 'CCS',
    'socket:chademo':     'CHAdeMO',
    'socket:tesla_supercharger': 'Tesla',
    'socket:type1':       'Type 1',
  };
  const found = [];
  for (const [key, label] of Object.entries(SOCKET_LABELS)) {
    const count = parseInt(tags[key] || '0', 10);
    if (count > 0) found.push(`${label}×${count}`);
  }
  return found.join(' · ');
}

function clearPoiMarkers() {
  State.poiMarkers.forEach(m => m.remove()); // Fix 7: consistent with marker cleanup elsewhere
  State.poiMarkers = [];
}

function _loadingMsg(text) {
  return `<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center;font-family:system-ui,sans-serif">${text}</div>`;
}
