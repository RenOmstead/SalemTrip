import { PLACES, CATEGORIES, SALEM_CENTER, SALEM_BOUNDS } from './places.js';
import {
  buildItinerary, toMin, toHHMM, fmtTime, fmtDuration, fmtDistance, walkMeters, walkMinutes, PACES,
} from './planner.js';
import { TZ, zonedNow, zonedToDate, tzOffsetMin, sunTimes, buildICS, daysBetween, fmtDate } from './time.js';

/* global L */

// ---------------------------------------------------------------- state ----

const STORE = 'salemtrip.v1';
const PHOTO = 'salemtrip.parkphoto';
const NOTIFIED = 'salemtrip.notified';

function defaults() {
  return {
    v: 1,
    tripDate: '2026-11-01',
    settings: {
      dayStart: '10:00', dayEnd: '20:00', pace: 'normal', buffer: 5,
      startFrom: 'parking', endAtStart: true, mapsApp: 'auto', tiles: 'osm', mapLook: 'haunted',
      mapFilter: 'all', practice: false,
    },
    custom: [],   // places we added: {id, name, cat:'custom', lat, lng, addr, mins, open, close}
    edits: {},    // placeId -> overrides {mins, open, close, lat, lng}
    stops: [],    // places we want to see: {id, priority:'must'|'nice'}
    appts: [],    // fixed times: {id, title, placeId?, lat?, lng?, time:'HH:MM', mins, note}
    breaks: [],   // meals and rests: {id, title, from, to, mins}
    done: [],     // keys of stops/appointments/breaks we've finished
    parking: null, // {lat, lng, at, note, meterUntil (min), placeId}
    replan: null,  // {time:'HH:MM', lat, lng} when re-planned during the day
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* fall through to a fresh plan */ }
  return defaults();
}

function normalize(s) {
  const d = defaults();
  const out = { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
  for (const k of ['custom', 'stops', 'appts', 'breaks', 'done']) if (!Array.isArray(out[k])) out[k] = [];
  if (!out.edits || typeof out.edits !== 'object') out.edits = {};
  // Older saves may name a map style that needs an API key now.
  if (!['osm', 'hot'].includes(out.settings.tiles)) out.settings.tiles = 'osm';
  if (!['haunted', 'daylight'].includes(out.settings.mapLook)) out.settings.mapLook = 'haunted';
  return out;
}

let state = load();
let plan = null;
let lastPlanKey = '';
let fix = null;           // latest GPS fix {lat, lng, acc, at}
let watchId = null;
const ui = {
  tab: 'today', cat: 'all', results: null, searching: false, route: null, pick: null,
  sheet: 'half', alerts: [],
};
let notified = new Set();
try { notified = new Set(JSON.parse(localStorage.getItem(NOTIFIED) || '[]')); } catch { /* ignore */ }

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { toast('Couldn’t save on this device.'); }
}

function update(fn, opts = {}) {
  fn(state);
  save();
  refresh(opts);
}

// -------------------------------------------------------------- helpers ----

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = '') => p + Math.random().toString(36).slice(2, 9);
const placeMap = new Map(PLACES.map(p => [p.id, p]));

function getPlace(id) {
  const base = placeMap.get(id) || state.custom.find(p => p.id === id);
  if (!base) return null;
  const e = state.edits[id];
  return e ? { ...base, ...e } : base;
}
const allPlaces = () => [...PLACES, ...state.custom].map(p => getPlace(p.id));
const inPlan = id => state.stops.some(s => s.id === id);
const nowInfo = () => zonedNow();
const isTripDay = () => state.settings.practice || nowInfo().dateStr === state.tripDate;
const sun = () => sunTimes(state.tripDate, SALEM_CENTER[0], SALEM_CENTER[1]);
const pace = () => PACES[state.settings.pace] || PACES.normal;

function hoursText(p) {
  if (p.open == null && p.close == null) return p.daylight ? 'Best in daylight' : 'Always open';
  return `${fmtTime(toMin(p.open ?? '00:00'))}–${fmtTime(toMin(p.close ?? '23:59'))}`;
}

function homeBase() {
  const s = state.settings;
  if (s.startFrom === 'parking') {
    if (state.parking) return { lat: state.parking.lat, lng: state.parking.lng, name: 'Car', car: true };
    const g = getPlace('museum-place-garage');
    return { lat: g.lat, lng: g.lng, name: 'Car (Museum Place Garage)', car: true, assumed: true };
  }
  const p = getPlace(s.startFrom) || getPlace('museum-place-garage');
  return { lat: p.lat, lng: p.lng, name: p.name, id: p.id };
}

// Where a directions link should point. Curated places use their name and
// street address, so the maps app finds the actual door. Anything else uses
// the coordinates.
function targetFor(key) {
  if (key === 'car' || key === 'base') {
    const b = key === 'car' && state.parking ? { ...state.parking, name: 'Car' } : homeBase();
    return { lat: b.lat, lng: b.lng, name: b.name, exact: true };
  }
  const appt = state.appts.find(a => a.id === key);
  if (appt) {
    if (appt.placeId) return targetFor(appt.placeId);
    return { lat: appt.lat, lng: appt.lng, name: appt.title, exact: true };
  }
  const p = getPlace(key);
  if (!p) return null;
  const exact = p.cat === 'custom' || !p.addr || state.edits[key]?.lat != null;
  return { lat: p.lat, lng: p.lng, name: p.name, addr: p.addr, exact };
}

function mapsApp() {
  const m = state.settings.mapsApp;
  if (m !== 'auto') return m;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios ? 'apple' : 'google';
}

function dirUrl(t, app = mapsApp()) {
  if (!t) return '#';
  if (app === 'apple') {
    const d = t.exact ? `${t.lat},${t.lng}` : encodeURIComponent(t.addr);
    return `https://maps.apple.com/?daddr=${d}&dirflg=w`;
  }
  const d = t.exact ? `${t.lat},${t.lng}` : encodeURIComponent(`${t.name}, ${t.addr}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=walking`;
}

function dirLink(key, label = 'Directions', cls = 'btn small') {
  return `<a class="${cls}" href="${esc(dirUrl(targetFor(key)))}" target="_blank" rel="noopener">${label}</a>`;
}

// ----------------------------------------------------------- the plan ----

function computePlan() {
  const s = state.settings;
  const base = homeBase();
  const { sunset } = sun();
  const live = state.replan;
  const done = new Set(state.done);
  const skip = key => live && done.has(key);

  const stops = [];
  for (const x of state.stops) {
    const p = getPlace(x.id);
    if (!p || skip(p.id)) continue;
    let close = toMin(p.close);
    if (p.daylight) close = Math.min(close ?? 1440, sunset + 20);
    stops.push({
      key: p.id, name: p.name, lat: p.lat, lng: p.lng, mins: Number(p.mins) || 0,
      open: toMin(p.open), close, priority: x.priority || 'nice',
    });
  }
  for (const b of state.breaks) {
    if (skip(b.id)) continue;
    stops.push({
      key: b.id, name: b.title || 'Break', anywhere: true, lat: base.lat, lng: base.lng,
      mins: Number(b.mins) || 30, open: toMin(b.from), close: toMin(b.to), priority: 'must',
    });
  }
  const appointments = [];
  for (const a of state.appts) {
    if (skip(a.id) || (live && toMin(a.time) < toMin(live.time))) continue;
    const p = a.placeId ? getPlace(a.placeId) : null;
    const lat = a.lat ?? p?.lat, lng = a.lng ?? p?.lng;
    if (lat == null || !a.time) continue;
    appointments.push({
      key: a.id, name: a.title || p?.name || 'Appointment', lat, lng,
      start: toMin(a.time), mins: Number(a.mins) || 0, placeId: a.placeId,
    });
  }
  const start = live
    ? { lat: live.lat, lng: live.lng, name: 'You', live: true }
    : base;
  const args = {
    start, end: s.endAtStart ? base : null,
    startTime: live ? toMin(live.time) : toMin(s.dayStart),
    endTime: toMin(s.dayEnd),
    stops, appointments, pace: pace(), buffer: Number(s.buffer) || 0,
  };
  // Only rebuild when something the planner uses has changed.
  const key = JSON.stringify(args);
  if (plan && key === lastPlanKey) return;
  lastPlanKey = key;
  plan = buildItinerary(args);
  plan.base = base;
  plan.live = !!live;
  // Number the stops in order, and give each place pin its number.
  plan.order = new Map();
  let n = 0;
  for (const it of plan.items) {
    if (it.type !== 'stop' && it.type !== 'appt') continue;
    it.n = it.anywhere ? null : ++n;
    plan.order.set(it.key, it);
    const a = it.type === 'appt' && state.appts.find(x => x.id === it.key);
    if (a?.placeId) plan.order.set(a.placeId, it);
  }
}

// The next thing on the list that isn't done yet.
function nextItem() {
  if (!plan || !isTripDay()) return null;
  const t = nowInfo().minutes;
  const done = new Set(state.done);
  return plan.items.find(it => (it.type === 'stop' || it.type === 'appt') && !done.has(it.key) && it.depart > t) || null;
}

function nextAppt() {
  if (!plan || !isTripDay()) return null;
  const t = nowInfo().minutes;
  const done = new Set(state.done);
  return plan.items.find(it => it.type === 'appt' && !done.has(it.key) && it.begin >= t) || null;
}

// ------------------------------------------------------------------ map ----

// Both map styles are free and need no API key.
const TILES = {
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', sub: 'abc', max: 19,
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  hot: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', sub: 'abc', max: 19,
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, style by <a href="https://www.hotosm.org/">HOT</a>, hosted by <a href="https://openstreetmap.fr/">OSM France</a>',
  },
};
const BACKUP_TILES = { osm: 'hot', hot: 'osm' };

const map = L.map('map', { zoomControl: false, tap: false }).setView(SALEM_CENTER, 16);
map.attributionControl.setPrefix('');
if (innerWidth >= 900) L.control.zoom({ position: 'bottomright' }).addTo(map);
let tileLayer = null;
let tilesLoaded = 0;
let tilesSwitched = false;
function setTiles(name) {
  if (!TILES[name]) name = 'osm';
  const t = TILES[name];
  if (tileLayer) tileLayer.remove();
  let ok = 0, bad = 0;
  tileLayer = L.tileLayer(t.url, { subdomains: t.sub, maxZoom: t.max, maxNativeZoom: Math.min(t.max, 19), attribution: t.attr })
    .on('tileload', () => {
      ok++;
      if (!tilesLoaded++) $('#alertbar[data-kind="tiles"]')?.setAttribute('hidden', '');
    })
    .on('tileerror', () => {
      // If this tile server is down, switch to the other one (once).
      if (++bad > 6 && ok === 0 && !tilesSwitched) {
        tilesSwitched = true;
        setTiles(BACKUP_TILES[name]);
        toast('Switched to the backup map.');
      }
    })
    .addTo(map);
}
setTiles(state.settings.tiles);
// The haunted look is a color filter over the normal map, so it needs no extra service.
const setLook = look => map.getContainer().classList.toggle('map-haunted', look !== 'daylight');
setLook(state.settings.mapLook);

// If no street map has loaded after a while, say so instead of showing a blank map.
setTimeout(() => {
  if (tilesLoaded) return;
  const bar = $('#alertbar');
  const why = navigator.onLine === false
    ? 'This device looks offline.'
    : 'The map server can\u2019t be reached. A content blocker, VPN or private DNS setting can cause this.';
  bar.dataset.kind = 'tiles';
  bar.innerHTML = `<div class="grow"><b>The street map isn\u2019t loading</b><span class="small">${why} Pins, directions and the plan still work.</span></div>
    <button data-act="reload">Try again</button>`;
  bar.hidden = false;
}, 12000);

const placesLayer = L.layerGroup().addTo(map);
const planLine = L.polyline([], { color: '#e8711a', weight: 4, opacity: .75, dashArray: '2 8', lineCap: 'round' }).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let carMarker = null, meMarker = null, meCircle = null;
const markerById = new Map();

function pinIcon(p, it, opts = {}) {
  const color = CATEGORIES[p.cat]?.color || '#666';
  const done = it && state.done.includes(it.key);
  const cls = ['pin', it ? '' : 'small', done ? 'done' : '', opts.next ? 'next' : '', it?.type === 'appt' ? 'appt' : ''].join(' ');
  const label = it ? (done ? '✓' : it.n) : (CATEGORIES[p.cat]?.icon || '•');
  const size = it ? 30 : 22;
  return L.divIcon({
    className: it || opts.keep ? 'pin-wrap' : 'pin-wrap pin-minor',
    html: `<div class="${cls}" style="--c:${color}"><span>${label}</span></div>`,
    iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size + 2],
  });
}

function renderMap() {
  placesLayer.clearLayers();
  markerById.clear();
  const nxt = nextItem();
  const planned = new Set([...state.stops.map(s => s.id), ...state.appts.map(a => a.placeId).filter(Boolean)]);
  for (const p of allPlaces()) {
    const it = plan.order.get(p.id);
    if (state.settings.mapFilter === 'plan' && !planned.has(p.id)) continue;
    const m = L.marker([p.lat, p.lng], {
      icon: pinIcon(p, it, { next: nxt && it && nxt.key === it.key, keep: planned.has(p.id) }),
      title: p.name, zIndexOffset: it ? 600 : (planned.has(p.id) ? 300 : 0), riseOnHover: true,
    }).bindPopup(() => popupHtml(p.id), { maxWidth: 290, autoPanPaddingTopLeft: [10, 70] });
    m.addTo(placesLayer);
    markerById.set(p.id, m);
  }
  // Appointments that were dropped on the map rather than tied to a place.
  for (const a of state.appts) {
    if (a.placeId || a.lat == null) continue;
    const it = plan.order.get(a.id);
    const m = L.marker([a.lat, a.lng], { icon: pinIcon({ cat: 'custom' }, it || { n: '⏰', type: 'appt', key: a.id }), zIndexOffset: 700 })
      .bindPopup(() => apptPopupHtml(a.id), { maxWidth: 290 });
    m.addTo(placesLayer);
    markerById.set(a.id, m);
  }
  // Dashed line through the day's stops.
  const pts = plan.items.filter(i => !i.anywhere && i.lat != null).map(i => [i.lat, i.lng]);
  planLine.setLatLngs(pts.length > 1 ? pts : []);
  declutter();
  // The car.
  if (state.parking) {
    const ll = [state.parking.lat, state.parking.lng];
    if (!carMarker) {
      carMarker = L.marker(ll, {
        icon: L.divIcon({ className: 'pin-wrap', html: '<div class="car-pin">🚗</div>', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18] }),
        zIndexOffset: 900, draggable: true,
      }).bindPopup(carPopupHtml).addTo(map);
      carMarker.on('dragend', e => {
        const { lat, lng } = e.target.getLatLng();
        update(s => { s.parking = { ...s.parking, lat, lng }; });
        toast('Moved the car pin.');
      });
    } else {
      carMarker.setLatLng(ll);
    }
  } else if (carMarker) {
    carMarker.remove();
    carMarker = null;
  }
}

// With a plan on the map, hide the other places until you zoom in.
function declutter() {
  const hide = plan.items.length > 2 && map.getZoom() < 17;
  map.getContainer().classList.toggle('declutter', hide);
}
map.on('zoomend', declutter);

function popupHtml(id) {
  const p = getPlace(id);
  if (!p) return '';
  const cat = CATEGORIES[p.cat] || CATEGORIES.custom;
  const it = plan.order.get(id);
  const stop = state.stops.find(s => s.id === id);
  const sched = it ? `<div class="small"><b>#${it.n}</b> · ${fmtTime(it.begin)}–${fmtTime(it.depart)}</div>` : '';
  const dist = fix ? `<div class="small muted">${fmtDistance(walkMeters(fix, p))} from you · ~${walkMinutes(fix, p, pace())} min walk</div>` : '';
  return `
    <h4>${esc(p.name)}</h4>
    <div class="small muted">${cat.icon} ${esc(cat.label)}${p.addr ? ` · ${esc(p.addr.replace(/, Salem, MA$/, ''))}` : ''}</div>
    ${p.cat !== 'parking' && p.cat !== 'transit' ? `<div class="small">${esc(hoursText(p))}${p.mins ? ` · about ${fmtDuration(p.mins)} here` : ''}</div>` : ''}
    ${sched}${dist}
    ${p.tip ? `<div class="small" style="margin-top:6px">${esc(p.tip)}</div>` : ''}
    <div class="btns">
      ${p.cat === 'parking' ? `<button class="btn small primary" data-act="park-at" data-id="${id}">🚗 We parked here</button>`
        : stop ? `<button class="btn small" data-act="toggle-stop" data-id="${id}">Remove from plan</button>
                  <button class="btn small ${stop.priority === 'must' ? 'primary' : ''}" data-act="toggle-must" data-id="${id}">★ Must-see</button>`
        : `<button class="btn small primary" data-act="toggle-stop" data-id="${id}">+ Add to plan</button>`}
      ${dirLink(id)}
      <button class="btn small" data-act="route-to" data-id="${id}">Show route</button>
      ${p.cat !== 'parking' ? `<button class="btn small" data-act="appt-at" data-id="${id}">⏰ Set a time</button>` : ''}
      ${p.cat === 'custom' ? `<button class="btn small danger" data-act="del-custom" data-id="${id}">Delete</button>` : ''}
    </div>`;
}

function apptPopupHtml(id) {
  const a = state.appts.find(x => x.id === id);
  if (!a) return '';
  return `<h4>⏰ ${esc(a.title)}</h4><div class="small">${fmtTime(toMin(a.time))} · ${fmtDuration(+a.mins || 0)}</div>
    ${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}
    <div class="btns">${dirLink(id)}<button class="btn small" data-act="route-to" data-id="${id}">Show route</button>
    <button class="btn small" data-act="tab" data-tab="times">Edit</button></div>`;
}

function carPopupHtml() {
  const p = state.parking;
  if (!p) return '';
  return `<h4>🚗 Our car</h4>
    <div class="small">Parked at ${new Date(p.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}${p.note ? ` · ${esc(p.note)}` : ''}</div>
    ${p.meterUntil != null ? `<div class="small"><b>Parking runs out at ${fmtTime(p.meterUntil)}</b></div>` : ''}
    <div class="small muted">Drag the pin if it's in the wrong spot.</div>
    <div class="btns">${dirLink('car', 'Walk to car', 'btn small primary')}<button class="btn small" data-act="route-to" data-id="car">Show route</button>
    <button class="btn small" data-act="tab" data-tab="car">Details</button></div>`;
}

function fitPlan() {
  const pts = plan.items.filter(i => !i.anywhere && i.lat != null).map(i => [i.lat, i.lng]);
  if (fix) pts.push([fix.lat, fix.lng]);
  if (pts.length < 2) { map.setView(pts[0] || SALEM_CENTER, 16); return; }
  map.fitBounds(pts, { paddingTopLeft: [30, 80], paddingBottomRight: [70, sheetPx() + 20], maxZoom: 17 });
}

// Long-press (or right-click) the map to drop a pin.
map.on('contextmenu', e => {
  if (ui.pick) return;
  const { lat, lng } = e.latlng;
  L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent(`
    <h4>This spot</h4><div class="small muted">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
    <div class="btns">
      <button class="btn small primary" data-act="custom-here" data-lat="${lat}" data-lng="${lng}">📍 Add a place here</button>
      <button class="btn small" data-act="park-pin" data-lat="${lat}" data-lng="${lng}">🚗 We parked here</button>
    </div>`).openOn(map);
});

map.on('click', e => {
  if (!ui.pick) return;
  const pick = ui.pick;
  endPick();
  pick.done(e.latlng);
});

function startPick(message, done) {
  ui.pick = { done };
  const bar = $('#pickbar');
  bar.innerHTML = `<div class="grow"><b>${esc(message)}</b><span class="small">Tap the map.</span></div><button data-act="cancel-pick">Cancel</button>`;
  bar.hidden = false;
  setSheet('peek');
}
function endPick() { ui.pick = null; $('#pickbar').hidden = true; }

// ------------------------------------------------------------- location ----

function startWatch(center = false) {
  if (!('geolocation' in navigator)) { toast('This browser can’t share your location.'); return; }
  if (watchId != null) { if (center && fix) map.flyTo([fix.lat, fix.lng], Math.max(map.getZoom(), 17)); return; }
  let first = true;
  watchId = navigator.geolocation.watchPosition(pos => {
    fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() };
    const ll = [fix.lat, fix.lng];
    if (!meMarker) {
      meCircle = L.circle(ll, { radius: fix.acc, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: L.divIcon({ className: 'pin-wrap', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 1000, interactive: false }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meCircle.setLatLng(ll).setRadius(fix.acc);
    }
    $('#btn-locate').classList.add('on');
    if (first && center) map.flyTo(ll, Math.max(map.getZoom(), 17));
    first = false;
    updateRouteProgress();
    if (ui.tab === 'car') renderPane();
  }, err => {
    if (err.code === err.PERMISSION_DENIED) {
      toast('Location is off. Turn it on for this site in your phone’s settings.');
      stopWatch();
    }
  }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}
function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  $('#btn-locate').classList.remove('on');
}

function currentPosition() {
  return new Promise((resolve, reject) => {
    if (fix && Date.now() - fix.at < 60000 && fix.acc < 150) return resolve(fix);
    if (!('geolocation' in navigator)) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(
      pos => {
        fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() };
        resolve(fix);
      },
      reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
  });
}

// --------------------------------------------------------- walking route ----

const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';

function dirWord(b) {
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(((b % 360) + 360) % 360 / 45) % 8];
}
function stepText(s) {
  const m = s.maneuver || {}, name = s.name || '', mod = m.modifier || '';
  const onto = name ? ` onto ${name}` : '';
  const turn = {
    left: 'Turn left', right: 'Turn right', 'slight left': 'Bear left', 'slight right': 'Bear right',
    'sharp left': 'Turn sharp left', 'sharp right': 'Turn sharp right', straight: 'Go straight', uturn: 'Turn around',
  }[mod] || 'Continue';
  switch (m.type) {
    case 'depart': return `Head ${dirWord(m.bearing_after || 0)}${name ? ` on ${name}` : ''}`;
    case 'arrive': return 'Arrive';
    case 'continue': case 'new name': return `Continue${name ? ` on ${name}` : ''}`;
    case 'roundabout': case 'rotary': return `Take the roundabout${onto}`;
    default: return `${turn}${onto}`;
  }
}

async function routeTo(key) {
  const t = targetFor(key);
  if (!t) return;
  map.closePopup();
  let from = fix;
  if (!from) {
    try { from = await currentPosition(); startWatch(); } catch { from = null; }
  }
  if (!from) {
    // No GPS: route from the stop before this one in the plan.
    const idx = plan.items.findIndex(i => i.key === key);
    const prev = idx > 0 ? plan.items[idx - 1] : plan.items[0];
    from = { lat: prev.lat, lng: prev.lng };
  }
  ui.route = { key, target: t, from, steps: null, dist: walkMeters(from, t), loading: true };
  drawRoute([[from.lat, from.lng], [t.lat, t.lng]], true);
  renderRouteBar();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(`${ROUTER}${from.lng},${from.lat};${t.lng},${t.lat}?overview=full&geometries=geojson&steps=true`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = await res.json();
    const r = data.routes && data.routes[0];
    if (!r || ui.route?.key !== key) throw new Error('no route');
    const line = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    drawRoute(line, false);
    ui.route.dist = r.distance;
    ui.route.steps = r.legs[0].steps.map(s => ({ text: stepText(s), dist: s.distance }));
  } catch {
    if (ui.route) ui.route.offline = true;
  }
  if (ui.route) { ui.route.loading = false; renderRouteBar(); }
}

function drawRoute(latlngs, rough) {
  routeLayer.clearLayers();
  L.polyline(latlngs, { color: '#fff', weight: 9, opacity: .9 }).addTo(routeLayer);
  L.polyline(latlngs, { color: '#1a73e8', weight: 5, opacity: .95, dashArray: rough ? '6 8' : null }).addTo(routeLayer);
  map.fitBounds(latlngs, { paddingTopLeft: [30, 170], paddingBottomRight: [70, sheetPx() + 20], maxZoom: 18 });
}

function renderRouteBar() {
  const bar = $('#routebar');
  const r = ui.route;
  if (!r) { bar.hidden = true; routeLayer.clearLayers(); return; }
  const left = fix ? walkMeters(fix, r.target) : r.dist;
  const mins = Math.max(1, Math.round(left / pace()));
  bar.innerHTML = `
    <div class="routebar-body">
      <b>🚶 ${mins} min · ${fmtDistance(left)} to ${esc(r.target.name)}</b>
      <span class="small">${r.loading ? 'Finding a walking route…' : r.offline ? 'Straight line shown. No route service, maybe no signal.' : fix ? 'Follow the blue line.' : 'Turn on location to follow along.'}</span>
      ${r.steps ? `<ul class="steps" id="route-steps" hidden>${r.steps.map(s => `<li><span>${esc(s.text)}</span><span>${s.dist ? fmtDistance(s.dist) : ''}</span></li>`).join('')}</ul>` : ''}
      <div class="routebar-actions">
        <a class="btn small" style="background:rgba(255,255,255,.2);color:#fff;border:0" href="${esc(dirUrl(r.target))}" target="_blank" rel="noopener">Open in ${mapsApp() === 'apple' ? 'Apple' : 'Google'} Maps</a>
        ${r.steps ? '<button data-act="toggle-steps">Turn list</button>' : ''}
      </div>
    </div>
    <button data-act="close-route" aria-label="Close route">✕</button>`;
  bar.hidden = false;
}

function updateRouteProgress() {
  if (!ui.route || !fix) return;
  const left = walkMeters(fix, ui.route.target);
  if (left < 35) {
    toast(`You've arrived at ${ui.route.target.name}.`);
    ui.route = null;
    renderRouteBar();
    return;
  }
  const b = $('#routebar b');
  if (b) b.textContent = `🚶 ${Math.max(1, Math.round(left / pace()))} min · ${fmtDistance(left)} to ${ui.route.target.name}`;
}

// --------------------------------------------------------------- sheet ----

const SHEET = { peek: () => 132, half: () => Math.round(innerHeight * .5), full: () => Math.round(innerHeight * .9) };
function sheetPx() { return innerWidth >= 900 ? 0 : SHEET[ui.sheet](); }
function setSheet(name) {
  ui.sheet = name;
  document.documentElement.style.setProperty('--sheet-h', `${SHEET[name]()}px`);
}
(function sheetDrag() {
  const handle = $('#sheet-handle'), sheet = $('#sheet');
  let y0 = null, h0 = 0, moved = false;
  handle.addEventListener('pointerdown', e => {
    y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; moved = false;
    sheet.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', e => {
    if (y0 == null) return;
    const h = Math.max(100, Math.min(innerHeight * .94, h0 + (y0 - e.clientY)));
    if (Math.abs(y0 - e.clientY) > 4) moved = true;
    document.documentElement.style.setProperty('--sheet-h', `${h}px`);
  });
  const end = e => {
    if (y0 == null) return;
    sheet.classList.remove('dragging');
    const h = sheet.getBoundingClientRect().height;
    y0 = null;
    if (!moved) { setSheet(ui.sheet === 'peek' ? 'half' : ui.sheet === 'half' ? 'full' : 'peek'); return; }
    const best = Object.keys(SHEET).sort((a, b) => Math.abs(SHEET[a]() - h) - Math.abs(SHEET[b]() - h))[0];
    setSheet(best);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  addEventListener('resize', () => setSheet(ui.sheet));
})();

// --------------------------------------------------------------- panes ----

function renderChips() {
  const { sunset } = sun();
  const n = nowInfo();
  const days = daysBetween(n.dateStr, state.tripDate);
  const when = isTripDay() ? `Now ${fmtTime(n.minutes)}` : days > 0 ? `${fmtDate(state.tripDate)} · in ${days} day${days === 1 ? '' : 's'}` : fmtDate(state.tripDate);
  $('#chips').innerHTML = `<span class="chip">${esc(when)}</span><span class="chip">🌘 Dark at ${fmtTime(sunset)}</span>`;
}

function tl(item, opts = {}) {
  const done = state.done.includes(item.key);
  const color = item.type === 'appt' ? 'var(--plum)' : item.anywhere ? '#2e7d5b' : (CATEGORIES[getPlace(item.key)?.cat]?.color || 'var(--ink-3)');
  const p = getPlace(item.key);
  const sub = [];
  if (item.type === 'appt') sub.push('<span class="pill appt">Fixed time</span>');
  else if (item.priority === 'must' && !item.anywhere) sub.push('<span class="pill must">★ Must-see</span>');
  if (done) sub.push('<span class="pill done">Done</span>');
  sub.push(`<span>${fmtDuration(item.depart - item.begin)}</span>`);
  if (p?.tickets) sub.push('<span>🎟️ book ahead</span>');
  return `
    <li class="tl-item ${done ? 'is-done' : ''}">
      <div class="tl-time">${fmtTime(item.begin)}<small>to ${fmtTime(item.depart)}</small></div>
      <div class="tl-dot ${item.type === 'appt' ? 'appt' : ''} ${done ? 'done' : ''}" style="--c:${color}">${done ? '✓' : item.anywhere ? '☕' : item.n}</div>
      <div class="tl-body">
        <button class="tl-name" data-act="focus" data-id="${esc(item.key)}">${esc(item.name)}</button>
        <div class="tl-meta row wrap">${sub.join(' ')}</div>
        ${item.warnings.map(w => `<div class="warnline">⚠️ ${esc(w)}</div>`).join('')}
        ${opts.actions !== false && isTripDay() && !done ? `<div class="btns" style="margin-top:6px">
          <button class="btn small" data-act="done" data-id="${esc(item.key)}">✓ Done</button>
          ${item.type === 'stop' && !item.anywhere ? `<button class="btn small ghost" data-act="skip" data-id="${esc(item.key)}">Skip</button>` : ''}
        </div>` : ''}
      </div>
    </li>`;
}

function leg(item, prevName) {
  if (item.anywhere) return '';
  const free = item.wait >= 15 ? `<span class="tl-free">🦇 ${fmtDuration(item.wait)} to wander${item.type === 'appt' ? ' before this' : ''}</span>` : '';
  const walk = item.walk > 0 ? `🚶 ${item.walk} min · ${fmtDistance(item.dist)}` : '🚶 Right here';
  const key = item.type === 'end' ? (plan.base.car ? 'car' : 'base') : item.key;
  return `
    <li class="tl-leg">
      <div class="tl-time small muted">${item.type === 'appt' && item.walk > 0 ? `leave ${fmtTime(item.leaveBy)}` : ''}</div>
      <div class="line"></div>
      <div class="walk">${walk} ${item.walk > 0 ? dirLink(key, 'Go', 'btn small') : ''} ${free}</div>
    </li>`;
}

function renderToday() {
  const n = nowInfo();
  const trip = isTripDay();
  const items = plan.items;
  const stopsCount = items.filter(i => i.type === 'stop' || i.type === 'appt').length;
  const empty = !state.stops.length && !state.appts.length && !state.breaks.length;
  let html = '';

  if (trip) {
    const nxt = nextItem();
    const appt = nextAppt();
    if (nxt) {
      const late = n.minutes > nxt.leaveBy + 10 && nxt.type === 'appt';
      html += `<div class="card next">
        <div class="eyebrow">🕯️ ${nxt.begin <= n.minutes ? 'Now' : 'Up next'}</div>
        <div class="big">${esc(nxt.name)}</div>
        <div class="small">${fmtTime(nxt.begin)}–${fmtTime(nxt.depart)}${!nxt.anywhere && fix ? ` · ${walkMinutes(fix, nxt, pace())} min walk from you` : ''}</div>
        ${late ? '<div class="warnline">You may be running late.</div>' : ''}
        <div class="btns">
          ${nxt.anywhere ? '' : dirLink(nxt.key, 'Directions', 'btn primary')}
          ${nxt.anywhere ? '' : `<button class="btn" data-act="route-to" data-id="${esc(nxt.key)}">Show route</button>`}
          <button class="btn" data-act="done" data-id="${esc(nxt.key)}">✓ Done</button>
        </div></div>`;
    } else if (stopsCount) {
      html += `<div class="card good"><div class="big">You survived Salem 🎃</div><p class="small">That's everything on the list.</p>
        <div class="btns">${dirLink(plan.base.car ? 'car' : 'base', plan.base.car ? 'Walk to car' : 'Directions back', 'btn primary')}</div></div>`;
    }
    if (appt && (!nxt || appt.key !== nxt.key)) {
      const leaveIn = appt.leaveBy - n.minutes;
      html += `<div class="card ${leaveIn < 15 ? 'warn' : ''}"><div class="eyebrow">⏰ Next fixed time</div>
        <div><b>${esc(appt.name)}</b> at ${fmtTime(appt.begin)}</div>
        <div class="small">Leave by ${fmtTime(appt.leaveBy)} (${leaveIn > 0 ? `in ${fmtDuration(leaveIn)}` : 'now'})</div></div>`;
    }
    if (state.parking?.meterUntil != null) {
      const left = state.parking.meterUntil - n.minutes;
      if (left > -60) {
        html += `<div class="card ${left < 30 ? 'warn' : ''}"><div class="eyebrow">🚗 Parking</div>
          Runs out at <b>${fmtTime(state.parking.meterUntil)}</b>${left > 0 ? ` (in ${fmtDuration(left)})` : ' — it has run out'}</div>`;
      }
    }
    if (stopsCount) {
      html += `<div class="btns" style="margin:0 0 12px">
        <button class="btn plum" data-act="replan">↻ Re-plan from here &amp; now</button>
        ${state.replan ? '<button class="btn ghost" data-act="unreplan">Show the full day</button>' : ''}
      </div>`;
    }
  } else {
    const days = daysBetween(n.dateStr, state.tripDate);
    html += `<h2>${days > 0 ? `${days} night${days === 1 ? '' : 's'} until Salem` : 'The haunting begins'}</h2>
      <p class="muted small">${fmtDate(state.tripDate)} · ${fmtTime(toMin(state.settings.dayStart))} to ${fmtTime(toMin(state.settings.dayEnd))}. Sunset is at ${fmtTime(sun().sunset)}.${clockChangeNote()}</p>`;
  }

  if (empty) {
    html += `<div class="empty card">
      <div class="big">Plan your haunting</div>
      <p>Pick places in <b>Places</b> (or tap pins on the map). Add anything with a set time, like a tour or a dinner booking, in <b>Times</b>. The plan builds itself around them.</p>
      <div class="btns" style="justify-content:center">
        <button class="btn primary" data-act="tab" data-tab="places">Pick places</button>
        <button class="btn" data-act="tab" data-tab="times">Add a fixed time</button>
        <button class="btn ghost" data-act="sample">Load a sample day</button>
      </div></div>`;
    return html;
  }

  if (plan.base.assumed && !plan.live) {
    html += `<div class="card small">Starting from <b>Museum Place Garage</b> for now. Tap <b>🚗 Parked here</b> when you arrive and the plan will start from your car.</div>`;
  }

  const t = plan.totals;
  html += `<div class="row small muted" style="margin-bottom:8px">
      <span class="grow">${t.stops} stop${t.stops === 1 ? '' : 's'} · ${fmtDistance(t.walkMeters)} on foot (~${fmtDuration(t.walkMin)})</span>
      <span>${plan.items[plan.items.length - 1].type === 'end' ? `back ${fmtTime(t.finish)}` : `done ${fmtTime(t.finish)}`}</span>
    </div>`;
  if (plan.live && state.done.length) {
    html += `<p class="small muted">✓ ${state.done.length} done already. Re-planned at ${fmtTime(toMin(state.replan.time))}.</p>`;
  }

  html += '<ul class="timeline">';
  const start = items[0];
  html += `<li class="tl-item"><div class="tl-time">${fmtTime(start.depart)}</div>
    <div class="tl-dot" style="--c:#1f5fa8">${plan.live ? '📍' : plan.base.car ? '🚗' : '🏁'}</div>
    <div class="tl-body"><b>${plan.live ? 'Start from where you are' : `Start at ${esc(start.name)}`}</b></div></li>`;
  for (const it of items.slice(1)) {
    html += leg(it);
    if (it.type === 'end') {
      html += `<li class="tl-item"><div class="tl-time">${fmtTime(it.arrive)}</div>
        <div class="tl-dot" style="--c:#1f5fa8">${plan.base.car ? '🚗' : '🏁'}</div>
        <div class="tl-body"><b>Back at ${esc(plan.base.car ? 'the car' : it.name)}</b>
        ${it.warnings.map(w => `<div class="warnline">⚠️ ${esc(w)}</div>`).join('')}</div></li>`;
    } else {
      html += tl(it);
    }
  }
  html += '</ul>';

  if (plan.unscheduled.length) {
    html += `<h3>Lost in the fog (didn't fit)</h3><ul class="list">${plan.unscheduled.map(u => `
      <li><div class="grow"><div class="li-title">${esc(u.name)}</div><div class="small muted" style="white-space:normal">${esc(u.reason)}</div></div>
      ${state.stops.some(s => s.id === u.key && s.priority !== 'must') ? `<button class="btn small" data-act="toggle-must" data-id="${esc(u.key)}">★ Must-see</button>` : ''}
      </li>`).join('')}</ul>`;
  }

  html += `<div class="btns" style="margin-top:16px">
    <button class="btn" data-act="ics">📅 Add to calendar</button>
    <button class="btn" data-act="share-plan">🔗 Share plan</button>
    <button class="btn ghost" data-act="fit">Show on map</button>
  </div>
  <p class="small muted" style="margin-top:10px">Hours are typical for early November. Check anything important before you go. Walking times assume a ${state.settings.pace} pace plus ${state.settings.buffer} min per stop for getting in and out.</p>`;
  return html;
}

function clockChangeNote() {
  const a = tzOffsetMin(zonedToDate(state.tripDate, 60));
  const b = tzOffsetMin(zonedToDate(state.tripDate, 12 * 60));
  if (a === b) return '';
  return b < a ? ' Clocks fall back an hour at 2 AM that morning. Phones change on their own.' : ' Clocks spring forward an hour at 2 AM that morning.';
}

function renderPlaces() {
  const cats = Object.entries(CATEGORIES).filter(([k]) => k !== 'custom' || state.custom.length);
  const list = allPlaces().filter(p => ui.cat === 'all' ? true : ui.cat === 'plan' ? inPlan(p.id) : p.cat === ui.cat);
  let html = `
    <form class="searchbar" data-form="search">
      <input type="search" name="q" placeholder="Search Salem: a restaurant, shop, address…" enterkeyhint="search" autocomplete="off">
      <button class="btn" type="submit">${ui.searching ? '…' : 'Search'}</button>
    </form>`;
  if (ui.results) {
    html += `<div class="card"><div class="row"><b class="grow">Search results</b><button class="btn small ghost" data-act="clear-search">Clear</button></div>
      ${ui.results.length ? `<ul class="list">${ui.results.map((r, i) => `
        <li><div class="grow"><div class="li-title">${esc(r.name)}</div><div class="li-sub">${esc(r.addr)}</div></div>
        <button class="btn small primary" data-act="add-result" data-i="${i}">+ Add</button></li>`).join('')}</ul>`
        : '<p class="small muted">Nothing found near Salem. Try another name, or press and hold on the map to drop a pin.</p>'}
    </div>`;
  }
  html += `<div class="chiprow">
    <button class="fchip" data-act="cat" data-cat="all" aria-pressed="${ui.cat === 'all'}">All</button>
    <button class="fchip" data-act="cat" data-cat="plan" aria-pressed="${ui.cat === 'plan'}">✓ In plan (${state.stops.length})</button>
    ${cats.map(([k, c]) => `<button class="fchip" data-act="cat" data-cat="${k}" aria-pressed="${ui.cat === k}">${c.icon} ${esc(c.label)}</button>`).join('')}
  </div>`;
  if (!list.length) {
    html += `<p class="muted">${ui.cat === 'plan' ? 'Nothing in the plan yet. Tap + Add on any place.' : 'No places here yet.'}</p>`;
  }
  html += `<ul class="list">${list.map(p => {
    const c = CATEGORIES[p.cat] || CATEGORIES.custom;
    const s = state.stops.find(x => x.id === p.id);
    const it = plan.order.get(p.id);
    const canPlan = p.cat !== 'parking' && p.cat !== 'transit';
    return `<li style="flex-wrap:wrap">
      <div class="ico" style="color:${c.color}">${it ? `<b>${it.n}</b>` : c.icon}</div>
      <button class="li-main" data-act="focus" data-id="${p.id}">
        <div class="li-title">${esc(p.name)}</div>
        <div class="li-sub">${canPlan ? `${esc(hoursText(p))}${p.mins ? ` · ${fmtDuration(p.mins)}` : ''}` : esc(p.tip || p.addr)}${p.tickets ? ' · 🎟️' : ''}</div>
      </button>
      ${canPlan ? `<button class="btn small toggle-add ${s ? 'on' : ''}" data-act="toggle-stop" data-id="${p.id}">${s ? '✓ Added' : '+ Add'}</button>` :
        p.cat === 'parking' ? `<button class="btn small" data-act="park-at" data-id="${p.id}">Parked here</button>` : ''}
      ${s ? `<div style="flex-basis:100%;padding-left:44px" class="row wrap">
        <button class="btn small ${s.priority === 'must' ? 'primary' : ''}" data-act="toggle-must" data-id="${p.id}">★ ${s.priority === 'must' ? 'Must-see' : 'Make must-see'}</button>
        ${editPlaceForm(p)}
      </div>` : ''}
    </li>`;
  }).join('')}</ul>
  <p class="small muted" style="margin-top:12px">Tip: press and hold anywhere on the map to add your own place, like your hotel or a shop you spotted.</p>`;
  return html;
}

function editPlaceForm(p) {
  return `<details class="edit grow" ${ui.openEdit === p.id ? 'open' : ''}><summary>Visit length &amp; hours</summary>
    <div class="grid2" style="margin-top:8px">
      <label class="field"><span>Minutes here</span><input type="number" min="0" step="5" value="${+p.mins || 0}" data-edit="mins" data-id="${p.id}"></label>
      <span></span>
      <label class="field"><span>Opens</span><input type="time" value="${esc(p.open || '')}" data-edit="open" data-id="${p.id}"></label>
      <label class="field"><span>Closes</span><input type="time" value="${esc(p.close || '')}" data-edit="close" data-id="${p.id}"></label>
    </div>
    <div class="small muted">Leave both times blank if it's always open.</div>
    ${state.edits[p.id] ? `<button class="btn small ghost" data-act="reset-edit" data-id="${p.id}">Reset to defaults</button>` : ''}
  </details>`;
}

function placeOptions(selected) {
  const groups = {};
  for (const p of allPlaces()) (groups[p.cat] ||= []).push(p);
  return Object.entries(groups).map(([cat, ps]) => `<optgroup label="${esc(CATEGORIES[cat]?.label || cat)}">${
    ps.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
}

function renderTimes() {
  const appts = state.appts.slice().sort((a, b) => toMin(a.time) - toMin(b.time));
  let html = `<h2>Fixed times</h2>
    <p class="small muted">Anything you have to be at on time: tours, timed tickets, dinner bookings, the train home. The plan fits everything else around these.</p>`;
  if (appts.length) {
    html += `<ul class="list">${appts.map(a => {
      const p = a.placeId ? getPlace(a.placeId) : null;
      const it = plan.order.get(a.id);
      return `<li style="flex-wrap:wrap">
        <div class="ico" style="color:var(--plum)"><b>${fmtTime(toMin(a.time)).replace(/ (AM|PM)/, '')}</b></div>
        <button class="li-main" data-act="focus" data-id="${a.id}">
          <div class="li-title">${esc(a.title)}</div>
          <div class="li-sub">${fmtTime(toMin(a.time))} · ${fmtDuration(+a.mins || 0)} · ${esc(p ? p.name : 'Pin on map')}</div>
        </button>
        <button class="btn small ghost" data-act="del-appt" data-id="${a.id}" aria-label="Delete">✕</button>
        ${it?.warnings.length ? `<div style="flex-basis:100%;padding-left:44px">${it.warnings.map(w => `<div class="warnline">⚠️ ${esc(w)}</div>`).join('')}</div>` : ''}
        ${it && it.walk ? `<div style="flex-basis:100%;padding-left:44px" class="small muted">Leave by ${fmtTime(it.leaveBy)} · ${it.walk} min walk from the stop before</div>` : ''}
        ${a.note ? `<div style="flex-basis:100%;padding-left:44px" class="small">${esc(a.note)}</div>` : ''}
      </li>`;
    }).join('')}</ul>`;
  }
  const pre = ui.apptDraft || {};
  html += `<div class="card" style="margin-top:12px"><form data-form="appt">
    <div class="eyebrow">Add a fixed time</div>
    <label class="field"><span>What</span><input type="text" name="title" placeholder="Ghost tour, dinner at Turner's, train home…" value="${esc(pre.title || '')}" required></label>
    <div class="grid2">
      <label class="field"><span>Starts at</span><input type="time" name="time" value="${esc(pre.time || '19:00')}" required></label>
      <label class="field"><span>Lasts (min)</span><input type="number" name="mins" min="0" step="5" value="${esc(pre.mins ?? 60)}"></label>
    </div>
    <label class="field"><span>Where</span><select name="placeId">
      <option value="">— Pick a place —</option>
      <option value="__map" ${pre.lat != null ? 'selected' : ''}>${pre.lat != null ? '📍 Spot picked on the map' : '📍 Pick a spot on the map…'}</option>
      ${placeOptions(pre.placeId)}
    </select></label>
    <label class="field"><span>Note (optional)</span><input type="text" name="note" placeholder="Confirmation #, meet at the door…" value="${esc(pre.note || '')}"></label>
    <button class="btn primary block" type="submit">Add fixed time</button>
  </form></div>`;

  html += `<h3>Meals &amp; breaks</h3>
    <p class="small muted">A break happens wherever you are when it's time, so there's no walking to it.</p>`;
  if (state.breaks.length) {
    html += `<ul class="list">${state.breaks.map(b => {
      const it = plan.order.get(b.id);
      return `<li><div class="ico">☕</div><div class="grow"><div class="li-title">${esc(b.title)}</div>
        <div class="li-sub">${fmtDuration(+b.mins)} sometime ${fmtTime(toMin(b.from))}–${fmtTime(toMin(b.to))}${it ? ` · planned ${fmtTime(it.begin)}` : ' · not fitted'}</div></div>
        <button class="btn small ghost" data-act="del-break" data-id="${b.id}" aria-label="Delete">✕</button></li>`;
    }).join('')}</ul>`;
  }
  html += `<div class="card"><form data-form="break">
    <div class="eyebrow">Add a break</div>
    <label class="field"><span>What</span><input type="text" name="title" value="Lunch" required></label>
    <div class="grid2">
      <label class="field"><span>Between</span><input type="time" name="from" value="11:30" required></label>
      <label class="field"><span>and</span><input type="time" name="to" value="13:30" required></label>
    </div>
    <label class="field"><span>How long (min)</span><input type="number" name="mins" min="5" step="5" value="45"></label>
    <button class="btn block" type="submit">Add break</button>
  </form>
  <p class="small muted" style="margin:8px 0 0">Want to eat somewhere specific? Add the restaurant in Places, or as a fixed time if you have a booking.</p></div>`;
  return html;
}

function renderCar() {
  const p = state.parking;
  let html = '<h2>Where we parked</h2>';
  if (p) {
    const away = fix ? walkMeters(fix, p) : null;
    let photo = null;
    try { photo = localStorage.getItem(PHOTO); } catch { /* ignore */ }
    html += `<div class="card">
      <div class="big">🚗 ${p.placeId ? esc(getPlace(p.placeId)?.name || 'Car') : 'Car'}</div>
      <div class="small">Saved at ${new Date(p.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}${away != null ? ` · ${fmtDistance(away)} away, about ${Math.max(1, Math.round(away / pace()))} min walk` : ''}</div>
      <div class="btns">
        ${dirLink('car', 'Walk to car', 'btn primary')}
        <button class="btn" data-act="route-to" data-id="car">Show route</button>
        <button class="btn" data-act="focus" data-id="car">On map</button>
        <button class="btn" data-act="share-car">Share</button>
      </div>
    </div>
    <label class="field"><span>Note (level, row, landmark)</span>
      <input type="text" data-bind="parking.note" value="${esc(p.note || '')}" placeholder="Level 3, near the stairs"></label>
    <label class="field"><span>Parking runs out at (optional)</span>
      <input type="time" data-bind="parking.meterUntil" value="${p.meterUntil != null ? toHHMM(p.meterUntil) : ''}"></label>
    <p class="small muted">We'll remind you 15 minutes before, while the app is open. <button class="btn small ghost" data-act="ics">Add the reminder to your calendar</button></p>
    <div class="row wrap">
      <label class="btn">📷 ${photo ? 'Replace photo' : 'Add a photo of the spot'}<input type="file" accept="image/*" capture="environment" data-act-change="photo" hidden></label>
      ${photo ? '<button class="btn ghost" data-act="del-photo">Remove photo</button>' : ''}
    </div>
    ${photo ? `<img class="photo" src="${photo}" alt="Photo of where we parked">` : ''}
    <div class="btns" style="margin-top:16px">
      <button class="btn" data-act="park-here">Update to where I am</button>
      <button class="btn danger ghost" data-act="clear-parking">Clear</button>
    </div>
    <p class="small muted">The car pin can be dragged on the map if GPS put it in the wrong place.</p>`;
  } else {
    html += `<p>When you park, tap the button. Your phone saves the spot so you can walk back to it later.</p>
      <button class="btn primary block" data-act="park-here">🚗 We parked here (use my location)</button>
      <div class="btns"><button class="btn" data-act="park-pick">Pick the spot on the map</button></div>`;
  }
  html += `<h3>Parking garages</h3><ul class="list">${PLACES.filter(x => x.cat === 'parking').map(g => `
    <li><div class="ico">🅿️</div><button class="li-main" data-act="focus" data-id="${g.id}"><div class="li-title">${esc(g.name)}</div><div class="li-sub">${esc(g.addr.replace(/, Salem, MA$/, ''))}</div></button>
    <button class="btn small" data-act="park-at" data-id="${g.id}">Parked here</button></li>`).join('')}</ul>
    <p class="small muted">City garages take card or the Passport Parking app. Rates change, and they're higher on busy weekends.</p>`;
  return html;
}

function renderMore() {
  const s = state.settings;
  const startOpts = `<option value="parking" ${s.startFrom === 'parking' ? 'selected' : ''}>🚗 Where we parked</option>${placeOptions(s.startFrom)}`;
  return `<h2>Settings</h2>
    <label class="field"><span>Trip date</span><input type="date" data-bind="tripDate" value="${esc(state.tripDate)}"></label>
    <div class="grid2">
      <label class="field"><span>Day starts</span><input type="time" data-bind="settings.dayStart" value="${esc(s.dayStart)}"></label>
      <label class="field"><span>Day ends</span><input type="time" data-bind="settings.dayEnd" value="${esc(s.dayEnd)}"></label>
    </div>
    <label class="field"><span>Start the day from</span><select data-bind="settings.startFrom">${startOpts}</select></label>
    <label class="check"><input type="checkbox" data-bind="settings.endAtStart" ${s.endAtStart ? 'checked' : ''}> Finish the day back where we started</label>
    <div class="grid2">
      <label class="field"><span>Walking pace</span><select data-bind="settings.pace">
        ${['slow', 'normal', 'fast'].map(v => `<option value="${v}" ${s.pace === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Extra min per stop</span><input type="number" min="0" max="30" data-bind="settings.buffer" value="${esc(s.buffer)}"></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Open directions in</span><select data-bind="settings.mapsApp">
        <option value="auto" ${s.mapsApp === 'auto' ? 'selected' : ''}>Automatic</option>
        <option value="apple" ${s.mapsApp === 'apple' ? 'selected' : ''}>Apple Maps</option>
        <option value="google" ${s.mapsApp === 'google' ? 'selected' : ''}>Google Maps</option>
      </select></label>
      <label class="field"><span>Map style</span><select data-bind="settings.mapLook">
        <option value="haunted" ${s.mapLook !== 'daylight' ? 'selected' : ''}>🦇 Haunted night</option>
        <option value="daylight" ${s.mapLook === 'daylight' ? 'selected' : ''}>☀️ Daylight (easier in bright sun)</option>
      </select></label>
    </div>
    <label class="check"><input type="checkbox" data-bind="settings.mapFilter" ${s.mapFilter === 'plan' ? 'checked' : ''}> Only show places in our plan on the map</label>
    <label class="check"><input type="checkbox" data-bind="settings.practice" ${s.practice ? 'checked' : ''}> Practice mode: treat today as the trip day</label>

    <h3>Share &amp; back up</h3>
    <p class="small muted">Everything is saved on this phone. Send the plan to whoever you're traveling with, and when they open the link it loads on their phone.</p>
    <div class="btns">
      <button class="btn" data-act="share-plan">🔗 Share plan link</button>
      <button class="btn" data-act="ics">📅 Add to calendar</button>
    </div>
    <div class="btns">
      <button class="btn ghost" data-act="sample">Load the sample day</button>
      <button class="btn ghost danger" data-act="reset">Start over</button>
    </div>

    <h3>Before you go</h3>
    <ul class="small" style="padding-left:18px;margin:0">
      <li>Add this page to your home screen. In Safari, tap Share, then <b>Add to Home Screen</b>. It opens like an app and works with a weak signal.</li>
      <li>Open the map once over Wi-Fi and zoom around downtown. The map tiles you've seen are saved for when the signal's bad.</li>
      <li>Allow location when asked. That's how "Parked here" and "Show route" work.</li>
      <li>Reminders only pop up while the app is open. For alerts you can count on, use <b>Add to calendar</b>.</li>
    </ul>
    <p class="small muted" style="margin-top:14px">Map data © OpenStreetMap contributors. Walking routes by FOSSGIS/OSRM. Place search by Nominatim.</p>`;
}

const PANES = { today: renderToday, places: renderPlaces, times: renderTimes, car: renderCar, more: renderMore };

function renderPane() {
  for (const k of Object.keys(PANES)) {
    const el = $(`#pane-${k}`);
    el.hidden = k !== ui.tab;
  }
  const el = $(`#pane-${ui.tab}`);
  const scroll = el.scrollTop;
  el.innerHTML = PANES[ui.tab]();
  el.scrollTop = scroll;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
}

function refresh() {
  computePlan();
  renderChips();
  renderPane();
  renderMap();
}

// --------------------------------------------------------------- toast ----

let toastTimer = null;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toast-action">${esc(action.label)}</button>` : ''}`;
  el.hidden = false;
  ui.toastAction = action?.run;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3200);
}

function modal(html) {
  const el = $('#modal');
  el.innerHTML = `<div class="modal-card">${html}</div>`;
  el.hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

// ------------------------------------------------------------- actions ----

function focusOn(id) {
  if (id === 'car' && state.parking) {
    if (innerWidth < 900) setSheet('peek');
    map.flyTo([state.parking.lat, state.parking.lng], 18);
    setTimeout(() => carMarker?.openPopup(), 400);
    return;
  }
  const appt = state.appts.find(a => a.id === id);
  const m = markerById.get(id) || (appt?.placeId && markerById.get(appt.placeId));
  const it = plan.items.find(i => i.key === id);
  if (!m && it?.anywhere) return;
  const p = getPlace(id);
  const ll = m ? m.getLatLng() : it ? [it.lat, it.lng] : p ? [p.lat, p.lng] : null;
  if (!ll) return;
  if (innerWidth < 900) setSheet('peek');
  map.flyTo(ll, Math.max(map.getZoom(), 17));
  if (m) setTimeout(() => m.openPopup(), 400);
}

async function parkHere() {
  toast('Finding your location…');
  try {
    const f = await currentPosition();
    savePark({ lat: f.lat, lng: f.lng });
    startWatch();
    toast(`Saved where you parked (within ${Math.round(f.acc)} m).`);
  } catch {
    toast('Couldn’t get your location. Tap the spot on the map instead.');
    startPick('Where did you park?', ll => { savePark({ lat: ll.lat, lng: ll.lng }); toast('Saved the parking spot.'); });
  }
}

function savePark({ lat, lng, placeId = null }) {
  update(s => {
    const prev = s.parking;
    s.parking = { lat, lng, at: new Date().toISOString(), note: prev?.note || '', meterUntil: prev?.meterUntil ?? null, placeId };
  });
  map.flyTo([lat, lng], 17);
}

function toggleStop(id) {
  const had = inPlan(id);
  update(s => {
    if (had) s.stops = s.stops.filter(x => x.id !== id);
    else s.stops.push({ id, priority: 'nice' });
  });
  map.closePopup();
  const p = getPlace(id);
  if (!had) {
    const it = plan.order.get(id);
    toast(it ? `Added ${p.name}: stop #${it.n} at ${fmtTime(it.begin)}` : `Added ${p.name}, but it doesn't fit the day yet.`);
  }
}

function toggleMust(id) {
  update(s => {
    const x = s.stops.find(y => y.id === id);
    if (x) x.priority = x.priority === 'must' ? 'nice' : 'must';
  });
  map.closePopup();
}

function markDone(key) {
  update(s => { if (!s.done.includes(key)) s.done.push(key); });
  const nxt = nextItem();
  toast(nxt ? `Next up: ${nxt.name}` : 'All done. You survived! 🎃', { label: 'Undo', run: () => update(s => { s.done = s.done.filter(k => k !== key); }) });
}

function skipStop(key) {
  const prev = state.stops.find(s => s.id === key);
  update(s => { s.stops = s.stops.filter(x => x.id !== key); });
  toast('Skipped. The plan has been updated.', { label: 'Undo', run: () => update(s => { if (prev) s.stops.push(prev); }) });
}

async function replan() {
  const n = nowInfo();
  let where = null;
  try { where = await currentPosition(); } catch { /* fall back below */ }
  if (!where) {
    // No GPS: assume we're at the last place we finished.
    const last = plan.items.filter(i => state.done.includes(i.key) && !i.anywhere).pop();
    where = last ? { lat: last.lat, lng: last.lng } : plan.base;
    toast('No location, so re-planning from your last stop.');
  }
  update(s => { s.replan = { time: toHHMM(n.minutes), lat: where.lat, lng: where.lng }; });
  ui.tab = 'today';
  renderPane();
  const nxt = nextItem();
  if (nxt) toast(`Re-planned. Next: ${nxt.name} at ${fmtTime(nxt.begin)}`);
}

function loadSample() {
  update(s => {
    s.stops = [
      { id: 'witch-museum', priority: 'must' }, { id: 'burying-point', priority: 'must' },
      { id: 'trials-memorial', priority: 'nice' }, { id: 'witch-house', priority: 'must' },
      { id: 'ropes-mansion', priority: 'nice' }, { id: 'bewitched-statue', priority: 'nice' },
      { id: 'seven-gables', priority: 'nice' }, { id: 'pepper-co', priority: 'nice' },
      { id: 'derby-wharf', priority: 'nice' }, { id: 'kakawa', priority: 'nice' },
    ];
    s.appts = [{ id: uid('a-'), title: 'Dinner at Turner’s (sample)', placeId: 'turners', time: '17:30', mins: 75, note: 'Example booking. Edit or delete it.' }];
    s.breaks = [{ id: uid('b-'), title: 'Lunch', from: '12:00', to: '13:30', mins: 45 }];
    s.done = [];
    s.replan = null;
  });
  ui.tab = 'today';
  renderPane();
  fitPlan();
  toast('Summoned a sample day. Change anything you like.');
}

// Share links put the whole plan in the URL after "#plan=", so nothing goes
// to a server. The other phone saves it when the link is opened.
function encodePlan() {
  const { tripDate, settings, custom, edits, stops, appts, breaks, parking } = state;
  const json = JSON.stringify({ v: 1, tripDate, settings: { ...settings, practice: false }, custom, edits, stops, appts, breaks, parking });
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodePlan(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function shareText(title, text, url) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
    toast('Copied. Paste it into a text.');
  } catch {
    modal(`<h2>Share</h2><p class="small">Copy this link:</p><textarea readonly style="width:100%;min-height:120px">${esc(url || text)}</textarea>
      <div class="btns"><button class="btn primary" data-act="close-modal">Done</button></div>`);
  }
}

function downloadICS() {
  const places = Object.fromEntries(allPlaces().map(p => [p.id, p]));
  for (const a of state.appts) if (a.placeId) places[a.id] = places[a.placeId];
  const ics = buildICS({
    dateStr: state.tripDate, items: plan.items, places, parking: state.parking,
    mapsLink: it => dirUrl(targetFor(it.key)),
  });
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `salem-${state.tripDate}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Calendar file ready. Open it to add the events.');
}

async function search(q) {
  ui.searching = true;
  renderPane();
  const [[s, w], [n, e]] = SALEM_BOUNDS;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&bounded=1&viewbox=${w},${n},${e},${s}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    ui.results = data.map(r => ({
      name: r.name || r.display_name.split(',')[0],
      addr: r.display_name.split(',').slice(0, 3).join(',').trim(),
      lat: +r.lat, lng: +r.lon,
    }));
  } catch {
    ui.results = [];
    toast('Search needs a signal. Press and hold on the map to drop a pin instead.');
  }
  ui.searching = false;
  renderPane();
  if (ui.results.length) {
    routeLayer.clearLayers();
    ui.results.forEach((r, i) => L.circleMarker([r.lat, r.lng], { radius: 8, color: '#e8711a', fillOpacity: .8 })
      .bindTooltip(r.name).on('click', () => addCustom({ ...r }, i)).addTo(routeLayer));
    map.fitBounds(ui.results.map(r => [r.lat, r.lng]), { paddingBottomRight: [40, sheetPx() + 20], paddingTopLeft: [30, 80], maxZoom: 17 });
  }
}

function addCustom({ name, lat, lng, addr = '' }) {
  const id = uid('c-');
  update(s => {
    s.custom.push({ id, name: name || 'My place', cat: 'custom', lat, lng, addr, mins: 30, open: null, close: null });
    s.stops.push({ id, priority: 'nice' });
  });
  routeLayer.clearLayers();
  ui.results = null;
  renderPane();
  map.closePopup();
  toast(`Added ${name || 'your place'} to the plan.`);
  return id;
}

function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

const ACTIONS = {
  tab: el => { ui.tab = el.dataset.tab; if (ui.sheet === 'peek') setSheet('half'); map.closePopup(); renderPane(); },
  locate: () => { if (watchId == null) { toast('Finding you…'); startWatch(true); } else if (fix) map.flyTo([fix.lat, fix.lng], Math.max(map.getZoom(), 17)); },
  fit: () => fitPlan(),
  'park-here': () => parkHere(),
  'park-pick': () => startPick('Where did you park?', ll => { savePark({ lat: ll.lat, lng: ll.lng }); toast('Saved the parking spot.'); }),
  'park-at': el => { const g = getPlace(el.dataset.id); map.closePopup(); savePark({ lat: g.lat, lng: g.lng, placeId: g.id }); toast(`Saved: parked at ${g.name}.`); },
  'park-pin': el => { map.closePopup(); savePark({ lat: +el.dataset.lat, lng: +el.dataset.lng }); toast('Saved the parking spot.'); },
  'clear-parking': () => {
    const prev = state.parking;
    update(s => { s.parking = null; });
    toast('Parking spot cleared.', { label: 'Undo', run: () => update(s => { s.parking = prev; }) });
  },
  'share-car': () => {
    const p = state.parking;
    shareText('Our car', `Our car is here${p.note ? ` (${p.note})` : ''}:`, `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`);
  },
  'del-photo': () => { try { localStorage.removeItem(PHOTO); } catch { /* ignore */ } renderPane(); },
  'toggle-stop': el => toggleStop(el.dataset.id),
  'toggle-must': el => toggleMust(el.dataset.id),
  'reset-edit': el => { ui.openEdit = el.dataset.id; update(s => { delete s.edits[el.dataset.id]; }); },
  focus: el => focusOn(el.dataset.id),
  'route-to': el => routeTo(el.dataset.id),
  'close-route': () => { ui.route = null; renderRouteBar(); },
  'toggle-steps': () => { const s = $('#route-steps'); if (s) s.hidden = !s.hidden; },
  'appt-at': el => {
    const p = getPlace(el.dataset.id);
    ui.apptDraft = { title: p.name, placeId: p.id, time: '19:00', mins: p.mins || 60 };
    map.closePopup();
    ui.tab = 'times';
    setSheet('full');
    renderPane();
    $('#pane-times form[data-form="appt"] input[name="time"]')?.focus();
  },
  'del-appt': el => {
    const prev = state.appts.find(a => a.id === el.dataset.id);
    update(s => { s.appts = s.appts.filter(a => a.id !== el.dataset.id); });
    toast('Removed.', { label: 'Undo', run: () => update(s => { s.appts.push(prev); }) });
  },
  'del-break': el => update(s => { s.breaks = s.breaks.filter(b => b.id !== el.dataset.id); }),
  'del-custom': el => {
    const id = el.dataset.id;
    map.closePopup();
    update(s => { s.custom = s.custom.filter(c => c.id !== id); s.stops = s.stops.filter(x => x.id !== id); });
  },
  'custom-here': el => {
    const lat = +el.dataset.lat, lng = +el.dataset.lng;
    map.closePopup();
    modal(`<h2>Add a place</h2><form data-form="custom" data-lat="${lat}" data-lng="${lng}">
      <label class="field"><span>Name</span><input type="text" name="name" placeholder="Our hotel, that bookshop…" required></label>
      <label class="field"><span>Minutes there</span><input type="number" name="mins" value="30" min="0" step="5"></label>
      <div class="btns"><button class="btn primary" type="submit">Add to plan</button><button class="btn ghost" type="button" data-act="close-modal">Cancel</button></div>
    </form>`);
    $('#modal input[name="name"]').focus();
  },
  'add-result': el => addCustom(ui.results[+el.dataset.i]),
  'clear-search': () => { ui.results = null; routeLayer.clearLayers(); renderPane(); },
  cat: el => { ui.cat = el.dataset.cat; renderPane(); },
  done: el => markDone(el.dataset.id),
  skip: el => skipStop(el.dataset.id),
  replan: () => replan(),
  unreplan: () => update(s => { s.replan = null; }),
  sample: () => {
    if (state.stops.length || state.appts.length) {
      modal(`<h2>Replace your plan?</h2><p>The sample day replaces the places and times you've picked.</p>
        <div class="btns"><button class="btn primary" data-act="sample-yes">Load sample</button><button class="btn ghost" data-act="close-modal">Cancel</button></div>`);
    } else loadSample();
  },
  'sample-yes': () => { closeModal(); loadSample(); },
  reset: () => modal(`<h2>Start over?</h2><p>This clears your places, times, parking spot and settings on this phone.</p>
    <div class="btns"><button class="btn primary danger" data-act="reset-yes">Clear everything</button><button class="btn ghost" data-act="close-modal">Cancel</button></div>`),
  'reset-yes': () => {
    closeModal();
    try { localStorage.removeItem(PHOTO); } catch { /* ignore */ }
    state = defaults();
    save();
    refresh();
  },
  'share-plan': () => {
    const url = `${location.origin}${location.pathname}#plan=${encodePlan()}`;
    shareText('Our Salem plan', 'Here’s our Salem day plan:', url);
  },
  ics: () => downloadICS(),
  'import-yes': () => {
    try {
      const incoming = normalize(decodePlan(ui.pendingImport));
      incoming.done = [];
      incoming.replan = null;
      state = incoming;
      save();
      closeModal();
      refresh();
      fitPlan();
      toast('Plan loaded.');
    } catch {
      closeModal();
      toast('That link didn’t work. Ask for a new one.');
    }
  },
  'close-modal': () => closeModal(),
  'cancel-pick': () => endPick(),
  'toast-action': () => { $('#toast').hidden = true; ui.toastAction?.(); },
  'dismiss-alert': () => { $('#alertbar').hidden = true; },
  reload: () => location.reload(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName !== 'A') e.preventDefault();
  fn(el, e);
});
document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) ACTIONS.tab(b);
});

// Settings and edit fields save as soon as they change.
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.actChange === 'photo') {
    const file = el.files?.[0];
    if (!file) return;
    try {
      const data = await resizePhoto(file);
      localStorage.setItem(PHOTO, data);
      toast('Photo saved.');
    } catch {
      toast('Couldn’t save that photo. Try a smaller one.');
    }
    renderPane();
    return;
  }
  if (el.dataset.edit) {
    const id = el.dataset.id, field = el.dataset.edit;
    ui.openEdit = id;
    update(s => {
      const cur = { ...(s.edits[id] || {}) };
      cur[field] = field === 'mins' ? Math.max(0, Number(el.value) || 0) : (el.value || null);
      s.edits[id] = cur;
    });
    return;
  }
  if (el.dataset.form === undefined && el.closest('form[data-form="appt"]') && el.name === 'placeId' && el.value === '__map') {
    const f = el.form;
    ui.apptDraft = { title: f.title.value, time: f.time.value, mins: f.mins.value, note: f.note.value };
    startPick('Where is it?', ll => {
      ui.apptDraft = { ...ui.apptDraft, lat: ll.lat, lng: ll.lng, placeId: null };
      ui.tab = 'times';
      setSheet('full');
      renderPane();
    });
    return;
  }
  const bind = el.dataset.bind;
  if (!bind) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  update(s => {
    if (bind === 'tripDate') { if (v) { s.tripDate = v; s.replan = null; s.done = []; } return; }
    if (bind === 'parking.note') { s.parking.note = v; return; }
    if (bind === 'parking.meterUntil') { s.parking.meterUntil = v ? toMin(v) : null; return; }
    const key = bind.split('.')[1];
    if (key === 'mapFilter') v = v ? 'plan' : 'all';
    if (key === 'buffer') v = Math.max(0, Math.min(30, Number(v) || 0));
    if ((key === 'dayStart' || key === 'dayEnd') && !v) return;
    s.settings[key] = v;
    if (key === 'tiles') setTiles(v);
    if (key === 'mapLook') setLook(v);
  });
});

document.addEventListener('submit', e => {
  const f = e.target;
  const kind = f.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  if (kind === 'search') {
    if (d.q.trim()) search(d.q.trim());
  } else if (kind === 'appt') {
    const draft = ui.apptDraft || {};
    let placeId = d.placeId && d.placeId !== '__map' ? d.placeId : null;
    const lat = placeId ? null : draft.lat ?? null, lng = placeId ? null : draft.lng ?? null;
    if (!placeId && lat == null) { toast('Pick where it is first.'); return; }
    update(s => {
      s.appts.push({ id: uid('a-'), title: d.title.trim(), placeId, lat, lng, time: d.time, mins: Math.max(0, Number(d.mins) || 0), note: d.note.trim() });
    });
    ui.apptDraft = null;
    renderPane();
    const it = plan.items.find(i => i.type === 'appt' && i.name === d.title.trim());
    toast(it?.warnings.length ? `Added, but: ${it.warnings[0]}` : `Added ${d.title.trim()} at ${fmtTime(toMin(d.time))}.`);
  } else if (kind === 'break') {
    if (toMin(d.to) - toMin(d.from) < Number(d.mins)) { toast('That window is shorter than the break.'); return; }
    update(s => { s.breaks.push({ id: uid('b-'), title: d.title.trim() || 'Break', from: d.from, to: d.to, mins: Number(d.mins) || 30 }); });
    toast('Break added.');
  } else if (kind === 'custom') {
    closeModal();
    const id = addCustom({ name: d.name.trim(), lat: +f.dataset.lat, lng: +f.dataset.lng });
    if (Number(d.mins) !== 30) update(s => { s.edits[id] = { mins: Math.max(0, Number(d.mins) || 0) }; });
  }
});

$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ------------------------------------------------------------ reminders ----

function alertOnce(key, title, body) {
  if (notified.has(key)) return;
  notified.add(key);
  try { localStorage.setItem(NOTIFIED, JSON.stringify([...notified])); } catch { /* ignore */ }
  const bar = $('#alertbar');
  bar.dataset.kind = 'reminder';
  bar.innerHTML = `<div class="grow"><b>${esc(title)}</b><span class="small">${esc(body)}</span></div><button data-act="dismiss-alert">OK</button>`;
  bar.hidden = false;
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
  if ('Notification' in window && Notification.permission === 'granted') {
    navigator.serviceWorker?.ready.then(reg => reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: key }))
      .catch(() => { try { new Notification(title, { body }); } catch { /* ignore */ } });
  }
}

function tick() {
  renderChips();
  if (!isTripDay() || !plan) return;
  const t = nowInfo().minutes;
  const done = new Set(state.done);
  for (const it of plan.items) {
    if (it.type !== 'appt' || done.has(it.key)) continue;
    const day = `${state.tripDate}:${it.key}:${it.begin}`;
    if (t >= it.leaveBy - 10 && t < it.leaveBy) alertOnce(`soon:${day}`, `Leave in ${it.leaveBy - t} min`, `${it.name} starts at ${fmtTime(it.begin)}.`);
    if (t >= it.leaveBy && t < it.begin) alertOnce(`now:${day}`, `🧹 Time to fly to ${it.name}`, `It starts at ${fmtTime(it.begin)}, a ${it.walk} min walk.`);
  }
  const m = state.parking?.meterUntil;
  if (m != null && t >= m - 15 && t < m + 5) alertOnce(`meter:${state.tripDate}:${m}`, 'Parking runs out soon', `At ${fmtTime(m)}.`);
  if (ui.tab === 'today') renderPane();
}

// --------------------------------------------------------------- start ----

function boot() {
  setSheet('half');
  const hash = location.hash;
  if (hash.startsWith('#plan=')) {
    ui.pendingImport = hash.slice(6);
    history.replaceState(null, '', location.pathname + location.search);
    modal(`<h2>Open this shared plan?</h2><p>It replaces the plan saved on this phone. Your parking spot comes along too, if one was saved.</p>
      <div class="btns"><button class="btn primary" data-act="import-yes">Use this plan</button><button class="btn ghost" data-act="close-modal">Keep mine</button></div>`);
  }
  refresh();
  if (state.stops.length || state.appts.length) fitPlan();
  // If location was allowed before, show the blue dot straight away.
  navigator.permissions?.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') startWatch(); }).catch(() => {});
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  // Ask for notification permission the first time a fixed time is added on the trip day.
  if (isTripDay() && state.appts.length && 'Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission().catch(() => {}), { once: true });
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
