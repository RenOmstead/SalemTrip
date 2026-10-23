// Reads OpenStreetMap opening_hours strings ("Mo-Sa 10:00-18:00; Su 12:00-17:00")
// for one date. Handles the common forms: day ranges and lists, several time
// ranges, "off", "24/7" and month ranges. Anything fancier returns null
// (hours unknown) rather than a wrong guess.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)';
const DAY_SEL = new RegExp(`^(${DAY_RE}(?:\\s*-\\s*${DAY_RE})?(?:\\s*,\\s*${DAY_RE}(?:\\s*-\\s*${DAY_RE})?)*)(?:\\s+|:\\s*|$)`);
const MONTH_SEL = new RegExp(`^(${MONTHS.join('|')})(?:\\s*-\\s*(${MONTHS.join('|')}))?\\s+`);

function expand(list, names, i) {
  const out = new Set();
  for (const part of list.split(',')) {
    const [a, b] = part.split('-').map(s => s.trim());
    const ia = names.indexOf(a), ib = b ? names.indexOf(b) : ia;
    if (ia < 0 || ib < 0) continue; // PH/SH: public/school holidays, ignored
    for (let d = ia; ; d = (d + 1) % names.length) { out.add(d); if (d === ib) break; }
  }
  return out.has(i);
}

/**
 * @returns {{open:number, close:number}|{closed:true}|null}
 *   minutes after midnight; null when the hours can't be read.
 */
export function hoursOn(oh, dateStr) {
  if (!oh || typeof oh !== 'string') return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mo = 0
  const month = m - 1;
  // Rules are split by ";". A comma right after a time ("…18:00, Su 12:00-17:00")
  // also starts a new rule; a comma between days ("Su,Mo") does not.
  const rules = oh.replace(/(\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/g, '$1;')
    .split(';').map(r => r.trim()).filter(Boolean);
  let result = { closed: true }, unsure = false;
  for (let rule of rules) {
    if (/^24\/7$/.test(rule)) { result = { open: 0, close: 1440 }; continue; }
    const mm = rule.match(MONTH_SEL);
    if (mm) {
      const a = MONTHS.indexOf(mm[1]), b = mm[2] ? MONTHS.indexOf(mm[2]) : a;
      const inRange = a <= b ? month >= a && month <= b : month >= a || month <= b;
      rule = rule.slice(mm[0].length);
      if (!inRange) continue;
    }
    let applies = true;
    const dm = rule.match(DAY_SEL);
    if (dm) {
      applies = expand(dm[1].replace(/\s/g, ''), DAYS, day);
      rule = rule.slice(dm[0].length).trim();
    } else if (/^[A-Z][a-z]/.test(rule) && !/^(off|closed)/i.test(rule)) {
      unsure = true; // a selector we don't understand (week numbers, dates…)
      continue;
    }
    if (!applies) continue;
    if (/^(off|closed)\b/i.test(rule)) { result = { closed: true }; continue; }
    const ranges = [...rule.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?/g)];
    if (!ranges.length) { unsure = true; continue; }
    let open = 1440, close = 0;
    for (const r of ranges) {
      const a = +r[1] * 60 + +r[2];
      let b = +r[3] * 60 + +r[4];
      if (b <= a) b = 1440; // runs past midnight
      open = Math.min(open, a);
      close = Math.max(close, Math.min(b, 1440));
    }
    result = { open, close };
  }
  if (unsure && result.closed) return null;
  return result;
}
