import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItinerary, toMin, fmtTime, walkMinutes, PACES } from '../js/planner.js';
import { PLACES } from '../js/places.js';

const P = Object.fromEntries(PLACES.map(p => [p.id, p]));
const stop = (id, extra = {}) => ({
  key: id, name: P[id].name, lat: P[id].lat, lng: P[id].lng, mins: P[id].mins,
  open: toMin(P[id].open), close: toMin(P[id].close), priority: 'nice', ...extra,
});
const car = { ...P['museum-place-garage'], name: 'Car' };
const base = { start: car, end: car, startTime: toMin('10:00'), endTime: toMin('21:00'), pace: PACES.normal, buffer: 5 };

test('time helpers', () => {
  assert.equal(toMin('19:30'), 1170);
  assert.equal(fmtTime(1170), '7:30 PM');
  assert.equal(fmtTime(0), '12:00 AM');
  assert.equal(fmtTime(720), '12:00 PM');
});

test('downtown walks are short and sensible', () => {
  const m = walkMinutes(P['witch-museum'], P['seven-gables']);
  assert.ok(m >= 8 && m <= 20, `witch museum -> seven gables was ${m} min`);
  assert.ok(walkMinutes(P['pem'], P['pem']) === 0);
});

test('schedules every stop when there is time, and starts/ends at the car', () => {
  const ids = ['witch-museum', 'seven-gables', 'burying-point', 'trials-memorial', 'witch-house'];
  const r = buildItinerary({ ...base, stops: ids.map(id => stop(id)) });
  assert.equal(r.unscheduled.length, 0);
  assert.equal(r.items[0].type, 'start');
  assert.equal(r.items.at(-1).type, 'end');
  assert.equal(r.items.filter(i => i.type === 'stop').length, ids.length);
});

test('respects opening and closing times', () => {
  const ids = ['witch-museum', 'seven-gables', 'pem', 'burying-point', 'witch-house', 'reds'];
  const r = buildItinerary({ ...base, startTime: toMin('08:00'), stops: ids.map(id => stop(id)) });
  for (const it of r.items.filter(i => i.type === 'stop')) {
    if (it.open != null) assert.ok(it.begin >= it.open, `${it.name} starts before it opens`);
    if (it.close != null) assert.ok(it.depart <= it.close, `${it.name} runs past closing`);
  }
  // Red's closes at 2 PM, so the planner should fit it into the morning.
  const reds = r.items.find(i => i.key === 'reds');
  assert.ok(reds && reds.depart <= toMin('14:00'));
});

test('fixed appointments stay at their time and stops fit around them', () => {
  const tour = { key: 'ghost-tour', name: 'Ghost tour', lat: P['hawthorne-hotel'].lat, lng: P['hawthorne-hotel'].lng, start: toMin('13:00'), mins: 90 };
  const ids = ['witch-museum', 'seven-gables', 'pem', 'witch-house', 'trials-memorial'];
  const r = buildItinerary({ ...base, appointments: [tour], stops: ids.map(id => stop(id)) });
  const appt = r.items.find(i => i.type === 'appt');
  assert.equal(appt.begin, toMin('13:00'));
  assert.ok(appt.arrive <= toMin('13:00'), 'arrives on time');
  assert.equal(appt.warnings.length, 0);
  // Nothing overlaps.
  const timed = r.items.filter(i => i.type === 'stop' || i.type === 'appt');
  for (let i = 1; i < timed.length; i++) assert.ok(timed[i].begin >= timed[i - 1].depart);
});

test('reports stops that cannot fit, with a reason', () => {
  const r = buildItinerary({ ...base, startTime: toMin('15:00'), endTime: toMin('17:00'),
    stops: [stop('pem'), stop('seven-gables'), stop('reds')] });
  const reds = r.unscheduled.find(u => u.key === 'reds');
  assert.ok(reds, 'breakfast spot that closes at 2 PM is unscheduled');
  assert.match(reds.reason, /before your day starts/);
  assert.ok(r.unscheduled.length >= 2);
});

test('must-see stops win over nice-to-have stops when time is short', () => {
  const r = buildItinerary({ ...base, startTime: toMin('14:00'), endTime: toMin('17:00'),
    stops: [stop('pem', { priority: 'nice' }), stop('seven-gables', { priority: 'must' }), stop('witch-museum', { priority: 'must' })] });
  const keys = r.items.map(i => i.key);
  assert.ok(keys.includes('seven-gables') && keys.includes('witch-museum'));
});

test('flags clashing appointments instead of hiding them', () => {
  const a = { key: 'a', name: 'A', lat: P['witch-museum'].lat, lng: P['witch-museum'].lng, start: toMin('12:00'), mins: 60 };
  const b = { key: 'b', name: 'B', lat: P['seven-gables'].lat, lng: P['seven-gables'].lng, start: toMin('12:30'), mins: 60 };
  const r = buildItinerary({ ...base, appointments: [a, b], stops: [] });
  const bi = r.items.find(i => i.key === 'b');
  assert.ok(bi.warnings.some(w => /late/.test(w)));
});

test('a reasonable full day orders stops to keep walking down', () => {
  const ids = ['witch-house', 'seven-gables', 'ropes-mansion', 'pepper-co', 'witch-museum', 'derby-wharf', 'bewitched-statue', 'custom-house'];
  const r = buildItinerary({ ...base, stops: ids.map(id => stop(id)) });
  assert.equal(r.unscheduled.length, 0);
  // The two west-end stops (Witch House, Ropes) should be next to each other,
  // and so should the two east-end ones (Seven Gables, Pepper Co).
  const order = r.items.map(i => i.key);
  const near = (x, y) => Math.abs(order.indexOf(x) - order.indexOf(y)) === 1;
  assert.ok(near('witch-house', 'ropes-mansion'), order.join(' > '));
  assert.ok(near('seven-gables', 'pepper-co'), order.join(' > '));
});

test('breaks happen wherever you are and stay inside their window', () => {
  const lunch = { key: 'lunch', name: 'Lunch', anywhere: true, lat: 0, lng: 0, mins: 60, open: toMin('11:30'), close: toMin('13:30'), priority: 'must' };
  const r = buildItinerary({ ...base, stops: [stop('witch-museum'), stop('pem'), stop('seven-gables'), lunch] });
  const l = r.items.find(i => i.key === 'lunch');
  assert.ok(l, 'lunch scheduled');
  assert.equal(l.walk, 0);
  assert.ok(l.begin >= toMin('11:30') && l.depart <= toMin('13:30'));
  assert.ok(Math.abs(l.lat) > 40, 'break takes the location of the stop before it');
});

test('fits more places rather than one long visit when the day is tight', () => {
  const tight = { ...base, startTime: toMin('13:00'), endTime: toMin('17:00') };
  const r = buildItinerary({ ...tight, stops: ['pem', 'seven-gables', 'pepper-co', 'custom-house'].map(id => stop(id)) });
  const keys = r.items.map(i => i.key);
  assert.ok(keys.includes('seven-gables') && keys.includes('pepper-co') && keys.includes('custom-house'), keys.join(' > '));
  assert.ok(r.unscheduled.some(u => u.key === 'pem'));
  // Marking the long one must-see flips the choice.
  const r2 = buildItinerary({ ...tight, stops: [stop('pem', { priority: 'must' }), ...['seven-gables', 'pepper-co', 'custom-house'].map(id => stop(id))] });
  assert.ok(r2.items.some(i => i.key === 'pem'));
});

test('places closed that day are never scheduled', () => {
  const r = buildItinerary({ ...base, stops: [stop('witch-museum'), stop('pem', { closed: true })] });
  assert.ok(!r.items.some(i => i.key === 'pem'));
  assert.equal(r.unscheduled.find(u => u.key === 'pem').reason, 'Closed that day.');
});

test('mixed mode drives the long legs and walks the short ones', () => {
  const dock = { lat: 42.6583, lng: -70.6168, name: 'Rental' };
  const halibut = { key: 'halibut', name: 'Halibut Point', lat: 42.687, lng: -70.631, mins: 60, open: null, close: null, priority: 'nice' };
  const motif = { key: 'motif', name: 'Motif No. 1', lat: 42.659257, lng: -70.614879, mins: 10, open: null, close: null, priority: 'nice' };
  const walkOnly = buildItinerary({ ...base, start: dock, end: dock, stops: [halibut, motif] });
  const mixed = buildItinerary({ ...base, start: dock, end: dock, mode: 'mixed', stops: [halibut, motif] });
  const h = mixed.items.find(i => i.key === 'halibut');
  assert.equal(h.by, 'drive');
  assert.ok(h.walk < 25, `drive to Halibut Point took ${h.walk} min`);
  const short = buildItinerary({ ...base, start: dock, end: dock, mode: 'mixed', stops: [motif] });
  assert.equal(short.items.find(i => i.key === 'motif').by, 'walk');
  assert.ok(walkOnly.items.find(i => i.key === 'halibut').warnings.some(w => /Long walk/.test(w)));
  assert.ok(!h.warnings.some(w => /Long walk/.test(w)));
});
