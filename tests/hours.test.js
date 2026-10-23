import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursOn } from '../js/hours.js';

const SUN = '2026-11-01'; // a Sunday
const t = (h, m = 0) => h * 60 + m;

test('common opening hours on Sunday Nov 1', () => {
  assert.deepEqual(hoursOn('Mo-Su 10:00-18:00', SUN), { open: t(10), close: t(18) });
  assert.deepEqual(hoursOn('Mo-Sa 10:00-18:00; Su 12:00-17:00', SUN), { open: t(12), close: t(17) });
  assert.deepEqual(hoursOn('Mo-Sa 10:00-18:00, Su 11:30-16:00', SUN), { open: t(11, 30), close: t(16) });
  assert.deepEqual(hoursOn('Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off', SUN), { closed: true });
  assert.deepEqual(hoursOn('Mo-Sa 09:00-17:00', SUN), { closed: true });
  assert.deepEqual(hoursOn('24/7', SUN), { open: 0, close: 1440 });
  assert.deepEqual(hoursOn('11:00-22:00', SUN), { open: t(11), close: t(22) });
  assert.deepEqual(hoursOn('Fr-Su 17:00-02:00', SUN), { open: t(17), close: 1440 });
  assert.deepEqual(hoursOn('Mo-Su 07:00-11:00,17:00-21:00', SUN), { open: t(7), close: t(21) });
  assert.deepEqual(hoursOn('Th-Mo 10:00-17:00', SUN), { open: t(10), close: t(17) });
  assert.deepEqual(hoursOn('Su,Mo 12:00-16:00; Tu-Sa 10:00-18:00', SUN), { open: t(12), close: t(16) });
});

test('month ranges and things it cannot read', () => {
  assert.deepEqual(hoursOn('Apr-Oct Mo-Su 10:00-17:00; Nov-Mar Sa,Su 11:00-15:00', SUN), { open: t(11), close: t(15) });
  assert.deepEqual(hoursOn('May-Oct Mo-Su 10:00-17:00', SUN), { closed: true });
  assert.equal(hoursOn('sunrise-sunset', SUN), null);
  assert.equal(hoursOn('by appointment', SUN), null);
  assert.equal(hoursOn('', SUN), null);
});
