// ── gpx.js ────────────────────────────────────────────────
// GPX export of the current route (with elevation data if available).

/**
 * Format a Date as GPX timestamp: 2024-06-01T12:00:00Z
 */
function _gpxTime(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build a GPX XML string from route coordinates and optional elevations.
 *
 * @param {L.LatLng[]} latLngs       - Route coordinates
 * @param {{ latitude, longitude }[]} [elevSamples] - Sampled positions matching elevations[]
 * @param {number[]}   [elevations]  - Elevation values in metres
 * @param {string}     [routeName]   - Track name
 * @returns {string} GPX XML
 */
function buildGpx(latLngs, elevSamples, elevations, routeName) {
  const name = routeName || 'Route';
  const now  = _gpxTime(new Date());

  // Build elevation lookup: for each latLng find closest sample index
  function elevForIndex(i) {
    if (!elevations || !elevSamples || elevations.length === 0) return null;
    // Map latLng index → sample index proportionally
    const sampleIdx = Math.round((i / (latLngs.length - 1)) * (elevations.length - 1));
    return elevations[Math.min(sampleIdx, elevations.length - 1)];
  }

  const trkpts = latLngs.map((p, i) => {
    const elev = elevForIndex(i);
    const elevTag = elev !== null ? `\n        <ele>${elev.toFixed(1)}</ele>` : '';
    return `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${elevTag}
      </trkpt>`;
  }).join('\n');

  // Build GPX using string concatenation to avoid tag-name corruption in template literals
  const nameTag = '<name>' + _escXml(name) + '</name>';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Germany-350km-Map"',
    '     xmlns="http://www.topografix.com/GPX/1/1"',
    '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    '  <metadata>',
    '    ' + nameTag,
    '    <time>' + now + '</time>',
    '  </metadata>',
    '  <trk>',
    '    ' + nameTag,
    '    <trkseg>',
    trkpts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ];
  return lines.join('\n');
}

function _escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Trigger a browser download of the GPX file.
 */
function downloadGpx(gpxString, filename) {
  const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename || 'route.gpx';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

/**
 * Main export entry point — called from the GPX button in the route panel.
 * Reads the current route from State and elevation data from window globals.
 */
function exportGpx() {
  if (!State.lastRouteCoords || !State.lastRouteCoords.length) {
    showToast('Keine Route zum Exportieren');
    return;
  }

  const latLngs     = State.lastRouteCoords;
  const elevSamples = State.lastElevSamples || null;
  const elevations  = State.lastElevations  || null;

  // Route name: "Route <destination lat,lng>"
  const last   = latLngs[latLngs.length - 1];
  const name   = `Route ${last.lat.toFixed(3)}N ${last.lng.toFixed(3)}E`;
  const gpxStr = buildGpx(latLngs, elevSamples, elevations, name);
  const date   = new Date().toISOString().slice(0, 10);
  downloadGpx(gpxStr, `route-${date}.gpx`);
  // Fix 6: inform user if no elevation data was available
  const msg = elevations
    ? 'GPX exportiert (mit Höhenprofil)'
    : 'GPX exportiert (ohne Höhendaten — API nicht erreichbar)';
  showToast(msg);
}
