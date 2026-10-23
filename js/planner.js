// Itinerary engine. No DOM here, so it runs in the browser and in node tests.
//
// Times are minutes after local midnight (e.g. 13:30 -> 810). Places are
// {lat, lng}. Walking time is the straight-line distance times a street-grid
// detour factor, divided by walking pace. That is good enough for planning
// in a compact downtown, and it works with no network connection.

export const PACES = { slow: 60, normal: 75, fast: 90 }; // meters per minute
export const DETOUR = 1.3;
export const LONG_WALK_MIN = 25;

export function toMin(hhmm) {
  if (hhmm == null || hhmm === '') return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function toHHMM(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtTime(min) {
  if (min == null) return '';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDuration(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function walkMeters(a, b) {
  return haversine(a, b) * DETOUR;
}

export function walkMinutes(a, b, pace = PACES.normal) {
  const m = walkMeters(a, b);
  return m < 40 ? 0 : Math.ceil(m / pace);
}

export function fmtDistance(meters) {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters * 3.281 / 10) * 10} ft` : `${miles.toFixed(miles < 1 ? 2 : 1)} mi`;
}

// Walk a sequence and work out every arrival and departure.
// `violation` adds up the minutes that break a rule: arriving late to an
// appointment, staying past closing time, or finishing after the end of the day.
function simulate(seq, ctx) {
  const { start, end, startTime, endTime, pace, buffer } = ctx;
  let t = startTime, pos = start, walk = 0, wait = 0, violation = 0;
  const steps = [];
  for (const node of seq) {
    // A break (lunch, coffee, rest) has no fixed spot. It happens wherever you are.
    const travel = node.anywhere ? 0 : walkMinutes(pos, node, pace);
    const transition = travel > 0 ? travel + buffer : 0;
    const arrive = t + transition;
    let begin, late = 0, over = 0;
    if (node.kind === 'appt') {
      begin = Math.max(arrive, node.start);
      late = Math.max(0, arrive - node.start);
    } else {
      begin = node.open != null ? Math.max(arrive, node.open) : arrive;
      if (node.close != null) over = Math.max(0, begin + node.mins - node.close);
    }
    const idle = begin - arrive;
    const depart = begin + node.mins;
    walk += travel;
    wait += idle;
    violation += late + over;
    steps.push({ node, travel, arrive, begin, depart, wait: idle, late, over });
    t = depart;
    if (!node.anywhere) pos = node;
  }
  let endTravel = 0, finish = t;
  if (end) {
    endTravel = walkMinutes(pos, end, pace);
    finish = t + endTravel;
    walk += endTravel;
  }
  const overtime = endTime != null ? Math.max(0, finish - endTime) : 0;
  violation += overtime;
  return { steps, walk, wait, violation, overtime, endTravel, finish };
}

function better(a, b) {
  // Lower walking time wins. On a tie, less idle waiting wins.
  if (!b) return true;
  if (a.walk !== b.walk) return a.walk < b.walk;
  return a.wait < b.wait;
}

function bestInsertion(seq, stop, ctx, limit) {
  let best = null;
  for (let i = 0; i <= seq.length; i++) {
    const trial = seq.slice(0, i).concat([stop], seq.slice(i));
    const sim = simulate(trial, ctx);
    if (sim.violation <= limit && better(sim, best)) best = { ...sim, seq: trial };
  }
  return best;
}

// Cheapest insertion. A stop's cost is the time it takes up: the extra walking
// plus the visit itself. Quick stops go in first, so the day fits as many
// places as possible. A long visit only wins if it's marked must-see.
// `rand` (optional) adds noise to the costs, so repeated runs explore
// different orders.
function insertAll(seq, pool, ctx, limit, rand = null) {
  let current = simulate(seq, ctx);
  pool = pool.slice();
  for (;;) {
    let pick = null, pickIdx = -1;
    pool.forEach((stop, idx) => {
      const ins = bestInsertion(seq, stop, ctx, limit);
      if (!ins) return;
      const delta = (ins.walk - current.walk + stop.mins) * (rand ? 0.4 + 1.2 * rand() : 1);
      if (!pick || delta < pick.delta || (delta === pick.delta && ins.wait < pick.wait)) {
        pick = { ...ins, delta };
        pickIdx = idx;
      }
    });
    if (!pick) break;
    seq = pick.seq;
    current = pick;
    pool.splice(pickIdx, 1);
  }
  return { seq, pool };
}

// Move each flexible stop to its best spot, and reverse runs of flexible
// stops, until neither cuts the walking time any further.
function improve(seq, ctx, limit) {
  let current = simulate(seq, ctx);
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (let i = 0; i < seq.length; i++) {
      if (seq[i].kind === 'appt') continue;
      const without = seq.slice(0, i).concat(seq.slice(i + 1));
      const ins = bestInsertion(without, seq[i], ctx, limit);
      if (ins && better(ins, current)) {
        seq = ins.seq;
        current = ins;
        changed = true;
      }
    }
    for (let i = 0; i < seq.length - 1; i++) {
      for (let j = i + 1; j < seq.length; j++) {
        if (seq.slice(i, j + 1).some(n => n.kind === 'appt')) break;
        const trial = seq.slice(0, i).concat(seq.slice(i, j + 1).reverse(), seq.slice(j + 1));
        const sim = simulate(trial, ctx);
        if (sim.violation <= limit && sim.walk < current.walk) {
          seq = trial;
          current = sim;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return seq;
}

const stopCount = seq => seq.filter(n => n.kind === 'stop').length;
const mustCount = seq => seq.filter(n => n.kind === 'stop' && n.priority === 'must').length;

function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function construct(appts, must, nice, ctx, limit, rand) {
  let r = insertAll(appts.slice(), must, ctx, limit, rand);
  let seq = r.seq;
  let leftMust = r.pool;
  r = insertAll(seq, nice, ctx, limit, rand);
  seq = improve(r.seq, ctx, limit);
  let leftNice = r.pool;

  // A second pass after tidying up, in case the shorter route freed up time.
  r = insertAll(seq, leftMust, ctx, limit); seq = r.seq; leftMust = r.pool;
  r = insertAll(seq, leftNice, ctx, limit); seq = improve(r.seq, ctx, limit); leftNice = r.pool;

  // If a must-see stop still doesn't fit, drop a nice-to-have stop to make room.
  for (const m of leftMust.slice()) {
    for (const n of seq.filter(x => x.kind === 'stop' && x.priority !== 'must')) {
      const ins = bestInsertion(seq.filter(x => x !== n), m, ctx, limit);
      if (ins) {
        seq = improve(ins.seq, ctx, limit);
        leftMust = leftMust.filter(x => x !== m);
        leftNice.push(n);
        break;
      }
    }
  }
  r = insertAll(seq, leftNice, ctx, limit); seq = r.seq; leftNice = r.pool;
  return { seq, leftMust, leftNice, walk: simulate(seq, ctx).walk };
}

function betterPlan(a, b) {
  if (mustCount(a.seq) !== mustCount(b.seq)) return mustCount(a.seq) > mustCount(b.seq);
  if (stopCount(a.seq) !== stopCount(b.seq)) return stopCount(a.seq) > stopCount(b.seq);
  return a.walk < b.walk;
}

// Swap one nice-to-have stop for a left-out one, then refill. Keep the swap
// only if more stops fit in the end.
function swapPass(seq, pool, ctx, limit) {
  for (let round = 0; round < 6 && pool.length; round++) {
    let changed = false;
    outer:
    for (const u of pool) {
      for (const s of seq.filter(x => x.kind === 'stop' && x.priority !== 'must')) {
        const ins = bestInsertion(seq.filter(x => x !== s), u, ctx, limit);
        if (!ins) continue;
        const r = insertAll(improve(ins.seq, ctx, limit), pool.filter(x => x !== u).concat([s]), ctx, limit);
        if (stopCount(r.seq) > stopCount(seq)) {
          seq = improve(r.seq, ctx, limit);
          pool = r.pool;
          changed = true;
          break outer;
        }
      }
    }
    if (!changed) break;
  }
  return { seq, pool };
}

function whyUnscheduled(stop, ctx) {
  const dayStart = ctx.startTime, dayEnd = ctx.endTime ?? 24 * 60;
  const opens = stop.open ?? 0, closes = stop.close ?? 24 * 60;
  if (closes <= dayStart) return `Closes at ${fmtTime(closes)}, before your day starts.`;
  if (opens >= dayEnd) return `Opens at ${fmtTime(opens)}, after your day ends.`;
  if (stop.mins > closes - Math.max(opens, dayStart)) {
    return `Not enough time before it closes at ${fmtTime(closes)}.`;
  }
  return 'There isn’t room in the day. Remove a stop, shorten a visit, or end the day later.';
}

/**
 * Build a day plan.
 * @param {object} opts
 *   start: {lat, lng, name}   where the day starts (car, hotel, current spot)
 *   end:   {lat, lng, name} | null   where the day must end (usually the car)
 *   startTime, endTime: minutes after midnight
 *   stops: [{key, name, lat, lng, mins, open, close, priority:'must'|'nice', anywhere?}]
 *          `anywhere` stops (breaks) take no walking and happen wherever you are.
 *   appointments: [{key, name, lat, lng, start, mins}]
 *   pace: meters/min, buffer: minutes added to each walk (finding the door, etc.)
 */
export function buildItinerary(opts) {
  const ctx = {
    start: opts.start,
    end: opts.end || null,
    startTime: opts.startTime,
    endTime: opts.endTime ?? null,
    pace: opts.pace || PACES.normal,
    buffer: opts.buffer ?? 5,
  };
  const appts = (opts.appointments || [])
    .map(a => ({ ...a, kind: 'appt' }))
    .sort((a, b) => a.start - b.start);
  const stops = (opts.stops || []).map(s => ({ ...s, kind: 'stop' }));

  // Appointments are fixed. If two of them already clash, that lateness is the
  // baseline: flexible stops may not make it any worse.
  const limit = simulate(appts, ctx).violation;

  // Tighter time windows go first, so the planner tries the hard stops early.
  const windowSize = s => (s.close ?? 1440) - (s.open ?? 0) - s.mins;
  const must = stops.filter(s => s.priority === 'must').sort((a, b) => windowSize(a) - windowSize(b));
  const nice = stops.filter(s => s.priority !== 'must').sort((a, b) => windowSize(a) - windowSize(b));

  // One plain run, then some runs with shuffled costs. Keep the best day:
  // most must-sees, then most stops, then least walking. The random numbers
  // come from a fixed seed, so the same inputs always give the same plan.
  let best = construct(appts, must, nice, ctx, limit, null);
  const rand = seeded(1692);
  const left = best.leftMust.length + best.leftNice.length;
  // The run count is fixed (not timed) so every phone gets the same plan.
  const tries = left ? Math.max(6, Math.min(30, Math.round(500 / Math.max(1, stops.length)))) : 8;
  for (let i = 0; i < tries; i++) {
    const c = construct(appts, must, nice, ctx, limit, rand);
    if (betterPlan(c, best)) best = c;
  }
  const { leftMust } = best;
  const swapped = swapPass(best.seq, best.leftNice, ctx, limit);
  const seq = swapped.seq;
  const leftNice = swapped.pool;

  const sim = simulate(seq, ctx);
  const items = [{
    type: 'start', name: ctx.start.name || 'Start', lat: ctx.start.lat, lng: ctx.start.lng,
    depart: ctx.startTime,
  }];
  let prev = ctx.start;
  for (const st of sim.steps) {
    const n = st.node.anywhere ? { ...st.node, lat: prev.lat, lng: prev.lng } : st.node;
    const warnings = [];
    if (st.late > 0) warnings.push(`About ${st.late} min late. Leave earlier or drop the stop before it.`);
    if (st.over > 0) warnings.push(`Closes at ${fmtTime(n.close)}, ${st.over} min before you'd finish.`);
    if (st.travel >= LONG_WALK_MIN) warnings.push(`Long walk (${st.travel} min). A car or rideshare may be quicker.`);
    items.push({
      type: n.kind, key: n.key, name: n.name, lat: n.lat, lng: n.lng, anywhere: !!n.anywhere,
      priority: n.priority, mins: n.mins, open: n.open, close: n.close,
      walk: st.travel, dist: n.anywhere ? 0 : walkMeters(prev, n),
      leaveBy: st.begin - (st.travel > 0 ? st.travel + ctx.buffer : 0),
      arrive: st.arrive, begin: st.begin, depart: st.depart, wait: st.wait, warnings,
    });
    prev = n;
  }
  if (ctx.end) {
    const warnings = [];
    if (sim.overtime > 0) warnings.push(`Runs ${sim.overtime} min past your end time.`);
    items.push({
      type: 'end', name: ctx.end.name || 'End', lat: ctx.end.lat, lng: ctx.end.lng,
      walk: sim.endTravel, dist: walkMeters(prev, ctx.end), arrive: sim.finish, warnings,
    });
  }
  const unscheduled = [...leftMust, ...leftNice].map(s => ({
    key: s.key, name: s.name, priority: s.priority, reason: whyUnscheduled(s, ctx),
  }));
  return {
    items,
    unscheduled,
    totals: {
      walkMin: sim.walk,
      walkMeters: items.reduce((sum, it) => sum + (it.dist || 0), 0),
      stops: items.filter(i => i.type === 'stop' || i.type === 'appt').length,
      finish: sim.finish,
    },
  };
}
