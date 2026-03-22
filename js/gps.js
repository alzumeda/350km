// ── gps.js ────────────────────────────────────────────────
// GPS location tracking and user marker.

// Fix 3: uses getSharedRadiusBuffer() from map.js — no local duplicate

function locateUser() {
  const btn = document.getElementById('fab-locate');
  btn.innerHTML = '<span class="spin">◎</span>';

  if (!navigator.geolocation) {
    showToast('GPS nicht verfügbar');
    btn.innerHTML = '◎';
    return;
  }

  // Fix 5: prevent double _onPosition if locateUser is called twice quickly
  let _called = false;
  navigator.geolocation.getCurrentPosition(
    pos => { if (_called) return; _called = true; _onPosition(pos, btn); },
    ()  => { if (_called) return; _called = true; showToast('GPS-Zugriff verweigert'); btn.innerHTML = '◎'; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function _onPosition(pos, btn) {
  State.userPos = [pos.coords.latitude, pos.coords.longitude];
  _updateUserMarker(State.userPos);
  State.map.flyTo(State.userPos, 9, { duration: 1.5 });
  btn.innerHTML = '◉';

  // Location chip
  State.chips.location.classList.add('visible');
  document.getElementById('chip-loc-text').textContent =
    `${State.userPos[0].toFixed(2)}°N ${State.userPos[1].toFixed(2)}°E`;

  // Border distance chip — aerial first, then driving
  State.chips.dist.classList.add('visible');
  const { km: bKm } = aerialDistToBorder(State.userPos[0], State.userPos[1]);
  const aerialTxt = bKm === null ? '–'
    : bKm < 0 ? `${Math.round(-bKm)} km in DE`
    : `+${Math.round(bKm)} km außerhalb`;
  document.getElementById('chip-dist-text').textContent = aerialTxt;

  const inside = _isInsideRadius(State.userPos);
  showToast(inside ? `✓ Im Radius — ${aerialTxt}` : `✗ Außerhalb — ${aerialTxt}`);

  // Async: update chip with driving distance
  drivingDistToBorder(State.userPos[0], State.userPos[1]).then(d => {
    if (!d) return;
    const el = document.getElementById('chip-dist-text');
    if (el) el.textContent = `${d.driveKm.toFixed(1)} km · ${d.driveMin}min zur Grenze`;
  }).catch(e => console.warn('[gps] border dist:', e.message));

  // Fix 5: always clear old watch before starting new one
  if (State.watchId !== null) {
    navigator.geolocation.clearWatch(State.watchId);
    State.watchId = null;
  }
  let _lastRadiusCheck = 0;
  State.watchId = navigator.geolocation.watchPosition(
    p => {
      State.userPos = [p.coords.latitude, p.coords.longitude];
      _updateUserMarker(State.userPos);
      // Debounce expensive radius check to max once per 3s
      const now = Date.now();
      if (now - _lastRadiusCheck > 3000) {
        _lastRadiusCheck = now;
        const inside = _isInsideRadius(State.userPos);
        const chip = document.getElementById('chip-radius');
        if (chip) chip.style.borderColor = inside ? '#1d9e75' : '#e94560';
      }
    },
    null,
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

function _isInsideRadius([lat, lng]) {
  try {
    const pt  = turf.point([lng, lat]);
    const buf = getSharedRadiusBuffer(); // Fix 3: shared buffer
    if (!buf) throw new Error('no buffer');
    return turf.booleanPointInPolygon(pt, buf);
  } catch {
    return distanceKm(lat, lng, GERMANY_CENTER[0], GERMANY_CENTER[1]) <= State.radiusKm + 200;
  }
}

function _updateUserMarker(pos) {
  if (State.userMarker) State.map.removeLayer(State.userMarker);
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:20px;height:20px;background:#e94560;border-radius:50%;border:3px solid white;box-shadow:0 0 0 4px rgba(233,69,96,0.3);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  State.userMarker = L.marker(pos, { icon }).addTo(State.map);
  State.userMarker.bindPopup('<b>Dein Standort</b>');
}
