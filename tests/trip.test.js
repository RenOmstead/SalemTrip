import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIP_FACTS, applyTripFacts, arriveAt, leaveAt } from '../js/trip.js';
import { fmtTime } from '../js/planner.js';
import { buildICS } from '../js/time.js';

const days = s => {
  for (const d of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']) {
    s.days[d] = s.days[d] || { appts: [], stops: [], breaks: [], done: [] };
  }
  return s;
};

test('arrive after the drive from Endicott, leave in time to be home by 5', () => {
  assert.equal(fmtTime(arriveAt()), '4:30 PM'); // 10:00 + 6 h drive + 30 min stop
  assert.equal(fmtTime(leaveAt()), '10:30 AM');
  assert.ok(arriveAt() >= 15 * 60, 'not before check-in');
});

test('the fixed parts are filled into a saved plan once', () => {
  const s = { trip: { start: '2026-11-01', end: '2026-11-01' }, days: {}, lodging: null };
  s.days['2026-10-31'] = { appts: [{ id: 'a1', title: 'Whale watch', placeId: 'cape-ann-whale-watch', time: '13:00', mins: 240 }, { id: 'a2', title: 'Dinner', placeId: 'x', time: '19:00', mins: 60 }], stops: [], breaks: [], done: [] };
  applyTripFacts(s, days);
  assert.deepEqual(s.trip, { start: '2026-10-30', end: '2026-11-03' });
  assert.equal(s.lodging.addr, '7 Old Harbor Rd, Rockport, MA 01966');
  const oct31 = s.days['2026-10-31'].appts;
  assert.deepEqual(oct31.map(a => a.id).sort(), ['a2', 'fixed-hammond', 'fixed-whale'], 'hand-added copy replaced, others kept');
  assert.equal(oct31.find(a => a.id === 'fixed-hammond').time, '10:30');
  assert.equal(oct31.find(a => a.id === 'fixed-whale').time, '13:15'); // be there 15 min before the 1:30 boat
  assert.equal(s.days['2026-10-30'].dayStart, '16:30');
  assert.equal(s.days['2026-11-03'].dayEnd, '10:30');
  // Running it again changes nothing (so edits made later are kept).
  s.days['2026-10-31'].appts[0].time = '12:45';
  applyTripFacts(s, days);
  assert.equal(s.days['2026-10-31'].appts[0].time, '12:45');
  assert.equal(s.factsV, TRIP_FACTS.version);
});

test('calendar includes the drives there and home', () => {
  const ics = buildICS({ days: [], extras: [{ uid: 'drive-there', dateStr: '2026-10-30', start: 600, end: 990, summary: 'Drive to Rockport', alarmMin: 30 }] });
  assert.match(ics, /DTSTART:20261030T140000Z/);
  assert.match(ics, /DTEND:20261030T203000Z/);
  assert.match(ics, /TRIGGER:-PT30M/);
});

test('Salem day: arrive at 8, breakfast, lunch, dinner, then the 6:15 tour', () => {
  const s = { trip: { start: '2026-10-30', end: '2026-11-03' }, days: {}, factsV: 1, lodging: null };
  days(s);
  s.days['2026-11-01'].appts = [{ id: 'x', title: 'Dinner at Turner’s (sample)', placeId: 'turners', time: '17:30', mins: 75, note: 'Example. Edit or delete it.' }];
  applyTripFacts(s, days);
  const d = s.days['2026-11-01'];
  assert.equal(d.dayStart, '08:00');
  assert.equal(d.town, 'salem');
  assert.deepEqual(d.appts.map(a => `${a.time} ${a.placeId}`), ['08:15 ugly-mug', '11:30 rockafellas', '16:30 ledger', '18:15 old-town-hall']);
  assert.ok(d.stops.some(x => x.id === 'witch-museum' && x.priority === 'must'));
});

test('reminders cover the Witch Museum booking and cancellation checks', async () => {
  const { REMINDERS } = await import('../js/trip.js');
  const book = REMINDERS.find(r => r.id === 'witch-book');
  assert.equal(`${book.date} ${book.time}`, '2026-10-31 22:00');
  assert.ok(REMINDERS.filter(r => /cancellations/.test(r.title)).length >= 4);
});
