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
  try {
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
      const inRadius = _isInRadius(lat, lon);
      // Show distance from user position if available, else from DE center
      const refLat = State.userPos ? State.userPos[0] : GERMANY_CENTER[0];
      const refLng = State.userPos ? State.userPos[1] : GERMANY_CENTER[1];
      const dist   = distanceKm(lat, lon, refLat, refLng);
      const distLabel = State.userPos ? 'von dir' : 'von DE-Mitte';

      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.innerHTML = `
        <div class="sri-name">${inRadius ? '✓ ' : ''}${item.display_name.split(',')[0]}</div>
        <div class="sri-detail">${item.display_name.split(',').slice(1, 3).join(',')} · ${Math.round(dist)} km ${distLabel}</div>`;
      div.addEventListener('click', () => {
        State.map.flyTo([lat, lon], 12);
        document.getElementById('search-input').value = item.display_name.split(',')[0];
        results.style.display = 'none';

        // Show route button if GPS available — user can tap to route there
        if (State.userPos) {
          _showSearchRouteButton(lat, lon, item.display_name.split(',')[0]);
        }
      });
      results.appendChild(div);
    });
  } catch (err) {
    if (err.name === 'AbortError') return; // Fix 6: silently drop cancelled requests
    results.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);font-size:13px;font-family:system-ui,sans-serif">Fehler bei der Suche</div>';
  }
  } catch(e) { if (e.name !== 'AbortError') console.warn('[search]', e.message); }
}

/**
 * Show a "Route berechnen" toast button after a search result is selected.
 * Tapping it directly starts routing to that location.
 */
function _showSearchRouteButton(lat, lon, name) {
  // Reuse showToast but extend with a callback via a temporary element
  const toast = document.getElementById('toast');
  toast.innerHTML = `📍 ${name} <span id="toast-route-btn" style="color:#e94560;font-weight:700;cursor:pointer;text-decoration:underline;margin-left:6px">Route →</span>`;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast.textContent = ''; // reset
  }, 5000); // longer timeout so user can tap

  const btn = document.getElementById('toast-route-btn');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.classList.remove('show');
      if (!State.userPos) { showToast('Erst GPS-Standort aktivieren (◎)'); return; }
      _placeDestination(L.latLng(lat, lon));
    });
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
