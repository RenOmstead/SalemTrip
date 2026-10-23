// Time zone helpers, sunset, and calendar (.ics) export.
// Times in a plan are kept as wall-clock minutes in Salem's time zone. This
// way the plan reads the same whatever time zone your phone was set to while
// you planned.

import { fmtTime } from './planner.js';

export const TZ = 'America/New_York';

const partsFmt = new Map();
function fmtFor(tz) {
  if (!partsFmt.has(tz)) {
    partsFmt.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return partsFmt.get(tz);
}

function zonedParts(date, tz) {
  const out = {};
  for (const p of fmtFor(tz).formatToParts(date)) out[p.type] = p.value;
  return {
    y: +out.year, mo: +out.month, d: +out.day,
    h: +out.hour % 24, mi: +out.minute, s: +out.second,
  };
}

// Minutes the zone is ahead of UTC at a given moment (EDT = -240, EST = -300).
export function tzOffsetMin(date, tz = TZ) {
  const p = zonedParts(date, tz);
  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// "2026-11-01" + 19:00 in Salem -> the real moment as a Date.
export function zonedToDate(dateStr, minutes, tz = TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - tzOffsetMin(new Date(guess), tz) * 60000;
  const off2 = tzOffsetMin(new Date(t), tz);
  t = guess - off2 * 60000;
  return new Date(t);
}

// The date and minute of the day in Salem right now (or at `date`).
export function zonedNow(date = new Date(), tz = TZ) {
  const p = zonedParts(date, tz);
  const dateStr = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return { dateStr, minutes: p.h * 60 + p.mi };
}

export function daysBetween(fromStr, toStr) {
  const a = Date.UTC(...fromStr.split('-').map((v, i) => i === 1 ? v - 1 : +v));
  const b = Date.UTC(...toStr.split('-').map((v, i) => i === 1 ? v - 1 : +v));
  return Math.round((b - a) / 86400000);
}

export function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// Sunrise and sunset in local minutes, from the standard sunrise equation.
// Accurate to a minute or two, which is plenty for "when does it get dark".
export function sunTimes(dateStr, lat, lng, tz = TZ) {
  const rad = Math.PI / 180;
  const [y, m, d] = dateStr.split('-').map(Number);
  const jd = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) / (Math.cos(lat * rad) * cosDec);
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
  const toDate = j => new Date((j - 2440587.5) * 86400000);
  const local = date => zonedNow(date, tz).minutes;
  return { sunrise: local(toDate(jTransit - w / 360)), sunset: local(toDate(jTransit + w / 360)) };
}

// ---- Calendar export ----

function icsStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

function fold(line) {
  const out = [];
  while (line.length > 74) {
    let cut = 74;
    const c = line.charCodeAt(cut);
    if (c >= 0xdc00 && c <= 0xdfff) cut--; // don't split a surrogate pair (emoji)
    out.push(line.slice(0, cut));
    line = ' ' + line.slice(cut);
  }
  out.push(line);
  return out.join('\r\n');
}

/**
 * @param {object} o
 *   dateStr: trip date, items: itinerary items, places: key -> {addr},
 *   parking: {lat, lng, note, meterUntil}|null, mapsLink: (item) => url
 */
export function buildICS({ dateStr, items, places = {}, parking = null, mapsLink }) {
  const now = icsStamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SalemTrip//Itinerary//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  const event = ({ uid, start, end, summary, location, description, geo, alarmMin, alarmText }) => {
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${now}`,
      `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`, `SUMMARY:${icsText(summary)}`);
    if (location) lines.push(`LOCATION:${icsText(location)}`);
    if (geo) lines.push(`GEO:${geo.lat.toFixed(6)};${geo.lng.toFixed(6)}`);
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    if (alarmMin != null) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(alarmText || summary)}`,
        `TRIGGER:-PT${Math.max(0, Math.round(alarmMin))}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  };
  for (const it of items) {
    if (it.type !== 'stop' && it.type !== 'appt') continue;
    const lead = it.begin - it.leaveBy;
    const walkNote = it.walk ? `${it.walk} min walk from the previous stop.` : '';
    event({
      uid: `${it.key}-${dateStr}@salemtrip`,
      start: zonedToDate(dateStr, it.begin),
      end: zonedToDate(dateStr, Math.max(it.depart, it.begin + 5)),
      summary: it.type === 'appt' ? `\u23F0 ${it.name}` : it.name,
      location: places[it.key]?.addr || '',
      geo: it,
      description: [walkNote, mapsLink ? `Directions: ${mapsLink(it)}` : ''].filter(Boolean).join('\n'),
      // Appointments get an alarm 5 minutes before you need to leave.
      alarmMin: it.type === 'appt' ? lead + 5 : null,
      alarmText: it.type === 'appt' ? `Leave by ${fmtTime(it.leaveBy)} for ${it.name}` : null,
    });
  }
  if (parking?.meterUntil != null) {
    event({
      uid: `parking-${dateStr}@salemtrip`,
      start: zonedToDate(dateStr, parking.meterUntil - 15),
      end: zonedToDate(dateStr, parking.meterUntil),
      summary: '\uD83D\uDE97 Parking runs out',
      description: [parking.note, `Car: https://www.google.com/maps/search/?api=1&query=${parking.lat},${parking.lng}`].filter(Boolean).join('\n'),
      geo: parking,
      alarmMin: 0,
      alarmText: `Parking runs out at ${fmtTime(parking.meterUntil)}`,
    });
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
