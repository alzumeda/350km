// ── elevation.js ───────────────────────────────────────────
// Elevation profile with SVG chart + stats.
// Primary: Open-Elevation API  |  Fallback: open-meteo

const ELEVATION_API_PRIMARY  = 'https://api.open-elevation.com/api/v1/lookup';
const ELEVATION_API_FALLBACK = 'https://api.open-meteo.com/v1/elevation';
const ELEVATION_LIMIT        = 100; // sample points per request

// Chart dimensions
const EL_W  = 260;
const EL_H  = 64;
const EL_PX = 6;   // horizontal padding
const EL_PY = 4;   // vertical padding

// ── Sampling ──────────────────────────────────────────────

function _sampleRoute(latLngs, n) {
  if (!latLngs.length) return [];
  if (latLngs.length <= n)
    return latLngs.map(p => ({ latitude: p.lat, longitude: p.lng }));
  const step = (latLngs.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const idx = Math.min(Math.round(i * step), latLngs.length - 1); // Fix 4: clamp
    const pt  = latLngs[idx];
    return { latitude: pt.lat, longitude: pt.lng };
  });
}

// ── API calls ─────────────────────────────────────────────

async function _fetchOpenElevation(locations) {
  try {
    const resp = await fetch(ELEVATION_API_PRIMARY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ locations }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.results?.length) return null;
    return data.results.map(r => r.elevation ?? 0);
  } catch { return null; }
}

async function _fetchOpenMeteoElevation(locations) {
  try {
    const lats = locations.map(l => l.latitude).join(',');
    const lngs = locations.map(l => l.longitude).join(',');
    const resp = await fetch(`${ELEVATION_API_FALLBACK}?latitude=${lats}&longitude=${lngs}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data.elevation) || !data.elevation.length) return null;
    return data.elevation;
  } catch { return null; }
}

async function fetchElevations(locations) {
  const primary = await _fetchOpenElevation(locations);
  if (primary) return primary;
  return _fetchOpenMeteoElevation(locations);
}

// ── Stats ─────────────────────────────────────────────────

function _elevationStats(elevations) {
  let ascent = 0, descent = 0, maxAlt = -Infinity, minAlt = Infinity;
  for (let i = 0; i < elevations.length; i++) {
    const e = elevations[i];
    if (e > maxAlt) maxAlt = e;
    if (e < minAlt) minAlt = e;
    if (i > 0) {
      const diff = e - elevations[i - 1];
      if (diff > 0) ascent  += diff;
      else          descent += -diff;
    }
  }
  return {
    ascent:  Math.round(ascent),
    descent: Math.round(descent),
    maxAlt:  Math.round(maxAlt),
    minAlt:  Math.round(minAlt),
  };
}

// ── SVG chart ─────────────────────────────────────────────

function _buildSvgChart(elevations) {
  const n    = elevations.length;
  if (n < 2) return ''; // Fix 2: need at least 2 points to draw a meaningful chart
  const minE   = elevations.reduce((a, b) => b < a ? b : a, Infinity);
  const maxE   = elevations.reduce((a, b) => b > a ? b : a, -Infinity);
  const rangeE = maxE - minE || 1;

  const innerW = EL_W - EL_PX * 2;
  const innerH = EL_H - EL_PY * 2;

  // Map elevation → SVG coords
  const pts = elevations.map((e, i) => {
    const x = EL_PX + (i / (n - 1)) * innerW;
    const y = EL_PY + innerH - ((e - minE) / rangeE) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Closed polygon for fill (down to bottom)
  const firstX = EL_PX;
  const lastX  = EL_PX + innerW;
  const bottom = EL_PY + innerH;
  const poly   = `${firstX},${bottom} ${pts.join(' ')} ${lastX},${bottom}`;

  // Y-axis labels
  const midE  = Math.round((minE + maxE) / 2);
  const yMid  = EL_PY + innerH / 2;
  const yTop  = EL_PY + 5;
  const yBot  = EL_PY + innerH - 2;

  // Hover crosshair data embedded as JSON in a <title>
  const hoverData = JSON.stringify(elevations.map((e, i) => ({
    x: +(EL_PX + (i / (n - 1)) * innerW).toFixed(1),
    e,
  })));

  return `
<svg id="elev-svg" viewBox="0 0 ${EL_W} ${EL_H}" xmlns="http://www.w3.org/2000/svg"
     style="width:100%;height:${EL_H}px;display:block;cursor:crosshair;touch-action:none">
  <defs>
    <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#e94560" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#e94560" stop-opacity="0.04"/>
    </linearGradient>
  </defs>
  <!-- Grid lines -->
  <line x1="${EL_PX}" y1="${yTop}"  x2="${EL_PX + innerW}" y2="${yTop}"  stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
  <line x1="${EL_PX}" y1="${yMid}"  x2="${EL_PX + innerW}" y2="${yMid}"  stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
  <line x1="${EL_PX}" y1="${bottom}"x2="${EL_PX + innerW}" y2="${bottom}" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>
  <!-- Fill -->
  <polygon points="${poly}" fill="url(#elev-grad)"/>
  <!-- Line -->
  <polyline points="${pts.join(' ')}" fill="none" stroke="#e94560" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- Y labels -->
  <text x="${EL_PX - 2}" y="${yTop + 3}"  font-size="8" fill="rgba(255,255,255,0.35)" text-anchor="end">${Math.round(maxE)}m</text>
  <text x="${EL_PX - 2}" y="${yMid + 3}"  font-size="8" fill="rgba(255,255,255,0.25)" text-anchor="end">${midE}m</text>
  <text x="${EL_PX - 2}" y="${yBot}"       font-size="8" fill="rgba(255,255,255,0.25)" text-anchor="end">${Math.round(minE)}m</text>
  <!-- Hover crosshair (initially hidden) -->
  <line id="elev-cross" x1="0" y1="${EL_PY}" x2="0" y2="${bottom}" stroke="#ffffff" stroke-width="1" stroke-dasharray="3,2" opacity="0"/>
  <circle id="elev-dot" cx="0" cy="0" r="3" fill="#e94560" stroke="white" stroke-width="1.5" opacity="0"/>
  <rect id="elev-tip-bg" x="0" y="0" width="36" height="14" rx="3" fill="rgba(30,30,40,0.85)" opacity="0"/>
  <text id="elev-tip"    x="0" y="0" font-size="9" fill="#ffffff" text-anchor="middle" opacity="0">0m</text>
  <!-- Invisible hit area + data -->
  <rect id="elev-hit" x="${EL_PX}" y="${EL_PY}" width="${innerW}" height="${innerH}"
        fill="transparent" data-pts='${hoverData}'/>
</svg>`;
}

// ── Hover interaction ─────────────────────────────────────

let _elevAbortController = null;

function _attachHoverEvents() {
  const svg = document.getElementById('elev-svg');
  const hit = document.getElementById('elev-hit');
  if (!svg || !hit) return;

  // Remove any previously attached listeners
  if (_elevAbortController) _elevAbortController.abort();
  _elevAbortController = new AbortController();
  const { signal } = _elevAbortController;

  const cross = document.getElementById('elev-cross');
  const dot   = document.getElementById('elev-dot');
  const tipBg = document.getElementById('elev-tip-bg');
  const tip   = document.getElementById('elev-tip');
  const pts   = JSON.parse(hit.dataset.pts);

  function showAt(svgX) {
    let best = pts[0], bestD = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.x - svgX);
      if (d < bestD) { bestD = d; best = p; }
    }
    const minE   = pts.reduce((a, p) => p.e < a ? p.e : a, Infinity);
    const maxE   = pts.reduce((a, p) => p.e > a ? p.e : a, -Infinity);
    const rangeE = maxE - minE || 1;
    const innerH = EL_H - EL_PY * 2;
    const cy     = EL_PY + innerH - ((best.e - minE) / rangeE) * innerH;

    cross.setAttribute('x1', best.x); cross.setAttribute('x2', best.x);
    cross.setAttribute('opacity', '0.7');
    dot.setAttribute('cx', best.x); dot.setAttribute('cy', cy);
    dot.setAttribute('opacity', '1');

    const label = `${Math.round(best.e)}m`;
    tip.textContent = label;
    const tipX = best.x > EL_W - 45 ? best.x - 20 : best.x + 20;
    const tipY = Math.max(EL_PY + 10, cy - 6);
    tip.setAttribute('x', tipX); tip.setAttribute('y', tipY);
    tipBg.setAttribute('x', tipX - 18); tipBg.setAttribute('y', tipY - 11);
    tip.setAttribute('opacity', '1');
    tipBg.setAttribute('opacity', '1');
  }

  function hide() {
    cross.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
    tip.setAttribute('opacity', '0');
    tipBg.setAttribute('opacity', '0');
  }

  function svgXFromEvent(e) {
    const rect    = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return EL_PX + ((clientX - rect.left) / rect.width) * (EL_W - EL_PX * 2);
  }

  hit.addEventListener('mousemove',  e => showAt(svgXFromEvent(e)), { signal });
  hit.addEventListener('mouseleave', hide,                           { signal });
  hit.addEventListener('touchmove',  e => { e.preventDefault(); showAt(svgXFromEvent(e)); },
    { signal, passive: false });
  hit.addEventListener('touchend', hide, { signal });
}

// ── Public API ────────────────────────────────────────────

async function fetchAndShowElevation(latLngs) {
  const el = document.getElementById('route-elevation');
  if (!el) return;

  el.style.display = 'block';
  el.innerHTML = '<span style="color:#8a8a9a;font-size:11px;display:block;padding:4px 0">↕ Höhenprofil wird geladen…</span>';

  const samples    = _sampleRoute(latLngs, ELEVATION_LIMIT);
  const elevations = await fetchElevations(samples);

  if (!elevations) {
    el.innerHTML = '<span style="color:#8a8a9a;font-size:11px">↕ Höhendaten nicht verfügbar</span>';
    return;
  }

  // Store for GPX export
  State.lastElevations = elevations;
  State.lastElevSamples = samples;

  const { ascent, descent, maxAlt, minAlt } = _elevationStats(elevations);

  const chartSvg = _buildSvgChart(elevations);
  el.innerHTML = `
    <div style="margin-bottom:5px">
      ${chartSvg || '<span style="color:#8a8a9a;font-size:11px">Zu wenige Höhenpunkte für Chart</span>'}
    </div>
    <div style="display:flex;gap:14px;font-size:11px;color:#c0c0c0;font-family:system-ui,sans-serif">
      <span title="Gesamtanstieg">⬆ ${ascent} m</span>
      <span title="Gesamtgefälle">⬇ ${descent} m</span>
      <span title="Höchster Punkt">▲ ${maxAlt} m</span>
      <span title="Tiefster Punkt" style="color:#8a8a9a">▼ ${minAlt} m</span>
    </div>`;

  _attachHoverEvents();
}

function clearElevation() {
  const el = document.getElementById('route-elevation');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  State.lastElevations  = null;
  State.lastElevSamples = null;
}
