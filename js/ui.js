// ── ui.js ─────────────────────────────────────────────────
// Toast notifications, chip updates, iOS install banner.

let _toastTimer;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m > 0 ? ' ' + m + 'min' : ''}` : `${m}min`;
}

function updateRadiusLabels() {
  const km   = State.radiusKm;
  const secs = Math.round(km / 100 * 3600);
  const mode = State.radiusMode;

  const chipText =
    mode === 'aerial' ? `${km} km Luftlinie` :
    mode === 'road'   ? `${km} km Straße`    :
    `${formatTime(secs)} Fahrzeit`;

  document.getElementById('chip-radius-val').textContent = chipText;

  const roadLbl = document.getElementById('rmode-road-label');
  const timeLbl = document.getElementById('rmode-time-label');
  if (roadLbl) roadLbl.textContent = `${km}km`;
  if (timeLbl) timeLbl.textContent = formatTime(secs);

  const btnLbl = document.getElementById('btn-radius-label');
  if (btnLbl) btnLbl.textContent =
    mode === 'aerial' ? 'Luftlinie' :
    mode === 'road'   ? 'Straße'    : 'Fahrzeit';
}

function initIosBanner() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = ('standalone' in navigator) && navigator.standalone;

  if (isIOS && !isStandalone && !localStorage.getItem('ios-banner-dismissed')) {
    setTimeout(() => {
      document.getElementById('ios-banner').style.display = 'flex';
    }, 2000);
  }

  if (isIOS && location.protocol !== 'https:' && location.hostname !== 'localhost') {
    setTimeout(() => showToast('⚠ HTTPS erforderlich für GPS auf iOS'), 1500);
  }

  document.getElementById('ios-banner-close').addEventListener('click', () => {
    document.getElementById('ios-banner').style.display = 'none';
    localStorage.setItem('ios-banner-dismissed', '1');
  });
}
