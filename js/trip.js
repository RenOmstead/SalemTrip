// The fixed parts of our trip. They're built in, so every phone has them
// without setting anything up. Bump `version` after changing anything here,
// so phones that already have a saved plan pick up the change.

import { toMin, toHHMM } from './planner.js';

export const TRIP_FACTS = {
  version: 4,
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
  // Day settings that are part of the plan.
  days: {
    '2026-11-01': { town: 'salem', startFrom: 'parking', mode: 'walk', dayStart: '08:00', dayEnd: '21:00', endAtStart: true },
  },
  stops: {
    // Booking for the next day opens at 10 PM the night before; once booked, add the time under Times.
    '2026-11-01': [{ id: 'witch-museum', priority: 'must' }],
    // Quick lunch between the castle tour and the whale watch.
    '2026-10-31': [{
      id: 'virgilios', priority: 'must', mins: 40, from: '11:45', to: '13:15',
      when: 'Between Hammond Castle and Cape Ann Whale Watch',
    }],
  },
  // Taken out of the plan (Topside Bistro: swapped for Virgilio's).
  remove: { '2026-10-31': ['osm-w213328523'] },
  appts: {
    '2026-11-01': [
      {
        id: 'fixed-breakfast', title: 'Breakfast at the Ugly Mug Diner', placeId: 'ugly-mug',
        time: '08:15', mins: 60, note: 'Right after parking. They open at 8:00 AM.',
      },
      {
        id: 'fixed-lunch', title: 'Lunch at Rockafellas', placeId: 'rockafellas',
        time: '11:30', mins: 75, status: 'waitlist',
        note: 'The Vault is fully booked, so ask about cancellations. Either way, try for a table when they open at 11:30.',
      },
      {
        id: 'fixed-dinner', title: 'Dinner at Ledger', placeId: 'ledger',
        time: '16:30', mins: 85, status: 'waitlist',
        note: 'Fully booked, so use OpenTable\u2019s Notify me. Otherwise walk in at 4:30 when dinner starts. Old Town Hall is a 2-minute walk.',
      },
      {
        id: 'fixed-tour', title: 'Haunted history walking tour', placeId: 'old-town-hall',
        time: '18:15', mins: 75, booked: true, note: 'Meet at Old Town Hall, 32 Derby Square, by 6:15 PM.',
      },
    ],
    '2026-10-31': [
      {
        id: 'fixed-hammond', title: 'Hammond Castle guided tour', placeId: 'hammond-castle',
        time: '10:30', mins: 75, booked: true, note: 'Guided tour at 10:30 AM.',
      },
      {
        id: 'fixed-whale', title: 'Cape Ann Whale Watch', placeId: 'cape-ann-whale-watch',
        time: '13:15', mins: 255, booked: true,
        note: 'Be there by 1:15 PM; the boat leaves at 1:30. Back around 5:30 PM. Dress warmly; it’s cold on the water. From Virgilio’s, drive over (about 10 min with parking) so the car is here when you get back.',
      },
    ],
  },
};

// Reminders: they pop up in the app (while it's open) and go into the calendar export.
const CANCEL = [
  { label: 'Ledger on OpenTable', href: 'https://www.opentable.com/restaurant/profile/509149' },
  { label: 'Call Rockafellas', href: 'tel:+19787452411' },
];
const cancelCheck = (id, date, time) => ({
  id, date, time, title: 'Check for cancellations: Ledger and the Rockafellas Vault',
  body: 'Both are full for Sun Nov 1. Look for an opening in OpenTable, or call Rockafellas to ask about the Vault.', links: CANCEL,
});
export const REMINDERS = [
  cancelCheck('cancel-1', '2026-10-30', '19:00'),
  cancelCheck('cancel-2', '2026-10-31', '08:30'),
  cancelCheck('cancel-3', '2026-10-31', '19:30'),
  {
    id: 'witch-book', date: '2026-10-31', time: '22:00', title: 'Book the Salem Witch Museum for tomorrow',
    body: 'Booking for Sun Nov 1 opens at 10:00 PM. Once booked, add the time in Times on Nov 1.',
    links: [{ label: 'Salem Witch Museum', href: 'https://salemwitchmuseum.com' }],
  },
  cancelCheck('cancel-4', '2026-11-01', '06:45'),
  cancelCheck('cancel-5', '2026-11-01', '10:30'),
  cancelCheck('cancel-6', '2026-11-01', '15:00'),
];

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
    // Replace any copy of these bookings that was added by hand, and sample bookings.
    const placeIds = new Set(fixed.map(a => a.placeId));
    day.appts = day.appts.filter(a => !placeIds.has(a.placeId) && !String(a.id).startsWith('fixed-') && !/^Example/.test(a.note || ''));
    day.appts.push(...fixed.map(a => ({ ...a })));
  }
  for (const [date, settings] of Object.entries(TRIP_FACTS.days)) if (s.days[date]) Object.assign(s.days[date], settings);
  for (const [date, ids] of Object.entries(TRIP_FACTS.remove || {})) {
    const day = s.days[date];
    if (!day) continue;
    day.stops = day.stops.filter(x => !ids.includes(x.id));
    day.appts = day.appts.filter(a => !ids.includes(a.placeId));
  }
  for (const [date, stops] of Object.entries(TRIP_FACTS.stops)) {
    const day = s.days[date];
    if (!day) continue;
    for (const x of stops) {
      const i = day.stops.findIndex(y => y.id === x.id);
      if (i < 0) day.stops.push({ ...x });
      else if (x.when) day.stops[i] = { ...x }; // a planned slot replaces the old entry
    }
  }
  const first = s.days[TRIP_FACTS.arrive.date], last = s.days[TRIP_FACTS.depart.date];
  if (first) Object.assign(first, { town: 'rockport', startFrom: 'lodging', dayStart: toHHMM(arriveAt()) });
  if (last) Object.assign(last, { town: 'rockport', startFrom: 'lodging', endAtStart: true, dayStart: '08:30', dayEnd: toHHMM(leaveAt()) });
  s.factsV = TRIP_FACTS.version;
  return s;
}
