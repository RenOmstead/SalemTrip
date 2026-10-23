import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToDate, zonedNow, tzOffsetMin, sunTimes, buildICS, daysBetween } from '../js/time.js';

test('Nov 1 2026 in Salem is Eastern Standard Time after 2 AM', () => {
  const d = zonedToDate('2026-11-01', 19 * 60);
  assert.equal(d.toISOString(), '2026-11-02T00:00:00.000Z');
  assert.equal(tzOffsetMin(d), -300);
  assert.equal(zonedToDate('2026-10-31', 12 * 60).toISOString(), '2026-10-31T16:00:00.000Z');
  assert.deepEqual(zonedNow(new Date('2026-11-01T15:30:00Z')), { dateStr: '2026-11-01', minutes: 10 * 60 + 30 });
});

test('sunset in Salem on Nov 1 is around 4:35 PM', () => {
  const { sunrise, sunset } = sunTimes('2026-11-01', 42.5215, -70.8925);
  assert.ok(sunset >= 16 * 60 + 30 && sunset <= 16 * 60 + 40, `sunset ${sunset}`);
  assert.ok(sunrise >= 6 * 60 + 15 && sunrise <= 6 * 60 + 25, `sunrise ${sunrise}`);
});

test('daysBetween', () => {
  assert.equal(daysBetween('2026-10-23', '2026-11-01'), 9);
});

test('calendar export has events and leave-by alarms', () => {
  const ics = buildICS({
    dateStr: '2026-11-01',
    items: [
      { type: 'start' },
      { type: 'appt', key: 'tour', name: 'Ghost tour, Salem', lat: 42.52, lng: -70.89, begin: 1140, depart: 1230, leaveBy: 1125, walk: 10 },
    ],
    parking: { lat: 42.5, lng: -70.9, meterUntil: 1200, note: 'Level 2' },
  });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20261102T000000Z/);
  assert.match(ics, /SUMMARY:.*Ghost tour\\, Salem/);
  assert.match(ics, /TRIGGER:-PT20M/);
  assert.match(ics, /Parking runs out/);
  assert.ok(ics.includes('\r\n'));
});

test('calendar export covers several days', () => {
  const day = (dateStr, key, begin) => ({ dateStr, parking: null, items: [{ type: 'stop', key, name: key, lat: 42.6, lng: -70.6, begin, depart: begin + 60, leaveBy: begin - 10, walk: 10, by: 'drive' }] });
  const ics = buildICS({ days: [day('2026-10-31', 'castle', 600), day('2026-11-01', 'museum', 600)] });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.match(ics, /castle-2026-10-31@salemtrip/);
  assert.match(ics, /DTSTART:20261031T140000Z/); // 10 AM EDT
  assert.match(ics, /DTSTART:20261101T150000Z/); // 10 AM EST, after the clocks change
  assert.match(ics, /min drive from the previous stop/);
});
