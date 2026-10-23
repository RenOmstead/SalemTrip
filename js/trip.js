// The fixed parts of our trip. They're built in, so every phone has them
// without setting anything up. Bump `version` after changing anything here,
// so phones that already have a saved plan pick up the change.

import { toMin, toHHMM } from './planner.js';

export const TRIP_FACTS = {
  version: 1,
  start: '2026-10-30',
  end: '2026-11-03',
  salemDay: '2026-11-01',
  lodging: {
    name: '7 Old Harbor Rd', addr: '7 Old Harbor Rd, Rockport, MA 01966',
    lat: 42.6594233, lng: -70.6165682, checkIn: '15:00',
  },
  home: 'Endicott, NY',
  driveMiles: 350,
  driveMins: 360, // about 6 hours of driving: I-88, the Mass Pike, then Route 128
  stopMins: 30,   // one stop for gas and food
  arrive: { date: '2026-10-30', leaveHome: '10:00' },
  depart: { date: '2026-11-03', homeBy: '17:00' },
  appts: {
    '2026-10-31': [
      {
        id: 'fixed-hammond', title: 'Hammond Castle guided tour', placeId: 'hammond-castle',
        time: '10:30', mins: 75, booked: true, note: 'Guided tour at 10:30 AM.',
      },
      {
        id: 'fixed-whale', title: 'Cape Ann Whale Watch', placeId: 'cape-ann-whale-watch',
        time: '13:00', mins: 270, booked: true,
        note: 'Boat leaves at 1:30 PM. Check in by 1:00 PM. Back around 5:30 PM. Dress warmly; it’s cold on the water.',
      },
    ],
  },
};

export const travelMins = () => TRIP_FACTS.driveMins + TRIP_FACTS.stopMins;
// When we get to the house on the first day, and when we leave on the last.
export const arriveAt = () => Math.max(toMin(TRIP_FACTS.arrive.leaveHome) + travelMins(), toMin(TRIP_FACTS.lodging.checkIn));
export const leaveAt = () => toMin(TRIP_FACTS.depart.homeBy) - travelMins();

// Fill in the fixed parts on a saved plan (once per version of the facts).
export function applyTripFacts(s, ensureDays) {
  if ((s.factsV || 0) >= TRIP_FACTS.version) return s;
  s.trip = { start: TRIP_FACTS.start, end: TRIP_FACTS.end };
  ensureDays(s);
  s.lodging = { ...TRIP_FACTS.lodging };
  for (const [date, fixed] of Object.entries(TRIP_FACTS.appts)) {
    const day = s.days[date];
    if (!day) continue;
    // Replace any copy of these bookings that was added by hand.
    const placeIds = new Set(fixed.map(a => a.placeId));
    day.appts = day.appts.filter(a => !placeIds.has(a.placeId) && !String(a.id).startsWith('fixed-'));
    day.appts.push(...fixed.map(a => ({ ...a })));
  }
  const first = s.days[TRIP_FACTS.arrive.date], last = s.days[TRIP_FACTS.depart.date];
  if (first) Object.assign(first, { town: 'rockport', startFrom: 'lodging', dayStart: toHHMM(arriveAt()) });
  if (last) Object.assign(last, { town: 'rockport', startFrom: 'lodging', endAtStart: true, dayStart: '08:30', dayEnd: toHHMM(leaveAt()) });
  s.factsV = TRIP_FACTS.version;
  return s;
}
