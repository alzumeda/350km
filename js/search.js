// ── search.js ─────────────────────────────────────────────
// Nominatim geocoding / place search.

// Fix 3: uses getSharedRadiusBuffer() from map.js — no local duplicate

let _searchTimer;

function initSearch() {
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(_searchTimer);
    const q = e.target.value.trim();
    if (q.length < 3) { document.getElementById('search-results').style.display = 'none'; return; }
    _searchTimer = setTimeout(() => _doSearch(q), 400);
  });

  document.getElementById('search-btn').addEventListener('click', () => {
    const q = document.getElementById('search-input').value.trim();
    if (q.length >= 3) _doSearch(q);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!document.getElementById('search-wrap').contains(e.target)) {
      document.getElementById('search-results').style.display = 'none';
    }
  });
}

// Fix 6: abort in-flight forward search to avoid parallel Nominatim hits
let _searchAbortCtrl = null;

async function _doSearch(query) {
  const results = document.getElementById('search-results');
  results.style.display = 'block';
  results.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);font-size:13px;font-family:system-ui,sans-serif">Suche…</div>';

  if (_searchAbortCtrl) _searchAbortCtrl.abort(); // Fix 6: cancel previous request
  _searchAbortCtrl = new AbortController();
  const signal = _searchAbortCtrl.signal;

  try {
    const url  = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1&accept-language=de`;
    const data = await (await fetch(url, { headers: { 'Accept-Language': 'de' }, signal })).json();

    if (!data.length) { results.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);font-size:13px;font-family:system-ui,sans-serif">Keine Ergebnisse</div>'; return; }

    results.innerHTML = '';
    data.forEach(item => {
      const lat      = parseFloat(item.lat);
      const lon      = parseFloat(item.lon);
      const dist     = distanceKm(lat, lon, GERMANY_CENTER[0], GERMANY_CENTER[1]);
      const inRadius = _isInRadius(lat, lon);

      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `
        <div class="sri-name">${inRadius ? '✓ ' : ''}${item.display_name.split(',')[0]}</div>
        <div class="sri-detail">${item.display_name.split(',').slice(1, 3).join(',')} · ${Math.round(dist)} km</div>`;
      div.addEventListener('click', () => {
        State.map.flyTo([lat, lon], 12);
        document.getElementById('search-input').value = item.display_name.split(',')[0];
        results.style.display = 'none';
      });
      results.appendChild(div);
    });
  } catch (err) {
    if (err.name === 'AbortError') return; // Fix 6: silently drop cancelled requests
    results.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);font-size:13px;font-family:system-ui,sans-serif">Fehler bei der Suche</div>';
  }
}

function _isInRadius(lat, lon) {
  try {
    const buf = getSharedRadiusBuffer(); // Fix 3: shared buffer
    if (!buf) throw new Error('no buffer');
    return turf.booleanPointInPolygon(turf.point([lon, lat]), buf);
  } catch {
    return distanceKm(lat, lon, GERMANY_CENTER[0], GERMANY_CENTER[1]) <= State.radiusKm + 200;
  }
}
