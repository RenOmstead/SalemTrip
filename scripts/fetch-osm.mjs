// Downloads the shops, food, museums/attractions and parking for the towns on
// the trip from OpenStreetMap (Overpass API, no key needed) and writes
// data/osm-places.json. Run by the "Refresh places" GitHub workflow:
//   node scripts/fetch-osm.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// south, west, north, east
export const AREAS = {
  salem: [42.485, -70.955, 42.552, -70.845],
  capeann: [42.570, -70.735, 42.700, -70.580], // Rockport and Gloucester
};

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export function overpassQuery(areas = AREAS) {
  const parts = Object.values(areas).map(([s, w, n, e]) => {
    const b = `${s},${w},${n},${e}`;
    return `  nwr["shop"]["name"](${b});
  nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|biergarten|food_court)$"]["name"](${b});
  nwr["tourism"~"^(museum|gallery|attraction)$"]["name"](${b});
  nwr["amenity"="parking"](${b});`;
  });
  return `[out:json][timeout:180];
(
${parts.join('\n')}
);
out center tags;`;
}

export function areaOf(lat, lng, areas = AREAS) {
  for (const [name, [s, w, n, e]] of Object.entries(areas)) {
    if (lat >= s && lat <= n && lng >= w && lng <= e) return name;
  }
  return null;
}

const FOOD = { restaurant: 'Restaurant', cafe: 'Cafe', fast_food: 'Fast food', bar: 'Bar', pub: 'Pub', ice_cream: 'Ice cream', biergarten: 'Beer garden', food_court: 'Food court' };
const FOOD_SHOPS = new Set(['bakery', 'confectionery', 'chocolate', 'coffee', 'tea', 'pastry', 'deli', 'ice_cream']);
const MINS = { Restaurant: 60, Cafe: 25, 'Fast food': 30, Bar: 60, Pub: 60, 'Ice cream': 15, 'Beer garden': 60, 'Food court': 45 };

// Shops nobody on a trip is looking for (car dealers, tire shops, storage...).
const SKIP_SHOPS = new Set(['car', 'car_repair', 'car_parts', 'tyres', 'motorcycle', 'motorcycle_repair', 'truck',
  'fuel', 'gas', 'energy', 'funeral_directors', 'storage_rental', 'trade', 'wholesale', 'agrarian', 'boat', 'caravan']);
// Neighboring towns that fall inside the boxes above.
const OTHER_TOWNS = /,\s*(Peabody|Beverly|Marblehead|Danvers|Swampscott|Lynn|Essex|Manchester[- a-z]*)$/i;

const titleCase = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function address(t) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const city = t['addr:city'] || '';
  return [street, city].filter(Boolean).join(', ');
}

// Turn one OpenStreetMap element into a compact place, or null to skip it.
export function toPlace(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  let cat, sub, mins;
  if (t.amenity === 'parking') {
    if (['private', 'no'].includes(t.access)) return null;
    cat = 'parking';
    const garage = ['multi-storey', 'underground'].includes(t.parking);
    sub = [garage ? 'Parking garage' : 'Parking lot',
      t.access === 'customers' ? 'customers only' : '',
      t.fee === 'yes' ? 'paid' : t.fee === 'no' ? 'free' : ''].filter(Boolean).join(' · ');
    mins = 0;
  } else if (FOOD[t.amenity]) {
    cat = 'food';
    sub = FOOD[t.amenity] + (t.cuisine ? ` · ${titleCase(t.cuisine.split(';')[0])}` : '');
    mins = MINS[FOOD[t.amenity]];
  } else if (t.tourism === 'museum' || t.tourism === 'gallery' || t.tourism === 'attraction') {
    cat = 'museum';
    sub = { museum: 'Museum', gallery: 'Gallery', attraction: 'Attraction' }[t.tourism];
    mins = t.tourism === 'museum' ? 60 : 30;
  } else if (t.shop) {
    if (SKIP_SHOPS.has(t.shop) || (['vacant', 'no', 'yes'].includes(t.shop) && !t.name)) return null;
    cat = FOOD_SHOPS.has(t.shop) ? 'food' : 'shop';
    sub = titleCase(t.shop === 'yes' ? 'shop' : t.shop);
    mins = cat === 'food' ? 15 : 20;
  } else {
    return null;
  }
  let name = t.name;
  if (!name && cat === 'parking') {
    const kind = sub.startsWith('Parking garage') ? 'Parking garage' : 'Parking lot';
    name = t.operator ? `${t.operator} ${kind.toLowerCase()}` : t['addr:street'] ? `${kind}, ${t['addr:street']}` : kind;
  }
  if (!name) return null;
  const p = {
    id: `osm-${el.type[0]}${el.id}`, name, cat, sub,
    lat: +lat.toFixed(6), lng: +lng.toFixed(6), mins, area: areaOf(lat, lng),
  };
  if (!p.area) return null;
  const addr = address(t);
  if (OTHER_TOWNS.test(addr)) return null;
  if (addr) p.addr = addr;
  if (t.opening_hours) p.oh = t.opening_hours;
  if (t.website || t['contact:website']) p.web = t.website || t['contact:website'];
  if (t.phone || t['contact:phone']) p.phone = t.phone || t['contact:phone'];
  if (t.capacity && cat === 'parking') p.sub += ` · ${t.capacity} spaces`;
  return p;
}

export function transform(json) {
  const seen = new Set();
  const out = [];
  for (const el of json.elements || []) {
    const p = toPlace(el);
    if (!p) continue;
    // The same business is sometimes mapped twice (a point and a building).
    const key = `${p.cat}|${p.name.toLowerCase()}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  return out;
}

async function main() {
  const body = 'data=' + encodeURIComponent(overpassQuery());
  let lastErr;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SalemTrip/1.0 (personal trip planner)' },
      });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const places = transform(await res.json());
      if (places.length < 50) throw new Error(`${url}: only ${places.length} places, something is wrong`);
      const counts = places.reduce((c, p) => ({ ...c, [`${p.area} ${p.cat}`]: (c[`${p.area} ${p.cat}`] || 0) + 1 }), {});
      mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
      writeFileSync(new URL('../data/osm-places.json', import.meta.url),
        JSON.stringify({ source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), places }) + '\n');
      console.log(`Saved ${places.length} places from ${url}:`, counts);
      return;
    } catch (e) {
      lastErr = e;
      console.warn(String(e));
    }
  }
  throw lastErr;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
