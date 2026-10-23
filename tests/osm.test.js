import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, toPlace } from '../scripts/fetch-osm.mjs';

test('turns OpenStreetMap elements into places', () => {
  const places = transform({ elements: [
    { type: 'node', id: 1, lat: 42.5219, lon: -70.894, tags: { shop: 'gift', name: 'Witchy Gifts', 'addr:housenumber': '200', 'addr:street': 'Essex Street', opening_hours: 'Mo-Su 10:00-18:00' } },
    { type: 'way', id: 2, center: { lat: 42.5236, lon: -70.8935 }, tags: { amenity: 'parking', parking: 'multi-storey', fee: 'yes', name: 'Museum Place Garage', capacity: '700' } },
    { type: 'way', id: 3, center: { lat: 42.52, lon: -70.89 }, tags: { amenity: 'parking', access: 'private' } },
    { type: 'node', id: 4, lat: 42.522, lon: -70.895, tags: { amenity: 'restaurant', cuisine: 'seafood;american', name: 'Fish House' } },
    { type: 'node', id: 5, lat: 42.522, lon: -70.892, tags: { tourism: 'museum', name: 'Tiny Museum' } },
    { type: 'node', id: 6, lat: 42.521, lon: -70.893, tags: { shop: 'bakery', name: 'Crumbs' } },
    { type: 'node', id: 7, lat: 42.5219, lon: -70.894, tags: { shop: 'gift', name: 'Witchy Gifts' } },
  ] });
  const by = Object.fromEntries(places.map(p => [p.name, p]));
  assert.equal(places.length, 5, 'private parking and the duplicate are dropped');
  assert.equal(by['Witchy Gifts'].cat, 'shop');
  assert.equal(by['Witchy Gifts'].addr, '200 Essex Street');
  assert.equal(by['Witchy Gifts'].oh, 'Mo-Su 10:00-18:00');
  assert.equal(by['Museum Place Garage'].cat, 'parking');
  assert.match(by['Museum Place Garage'].sub, /garage.*paid.*700 spaces/i);
  assert.equal(by['Fish House'].sub, 'Restaurant · Seafood');
  assert.equal(by['Tiny Museum'].cat, 'museum');
  assert.equal(by.Crumbs.cat, 'food');
  assert.equal(by.Crumbs.id, 'osm-n6');
});

test('unnamed parking gets a usable name; unnamed shops are skipped', () => {
  assert.equal(toPlace({ type: 'node', id: 9, lat: 1, lon: 1, tags: { amenity: 'parking' } }).name, 'Parking');
  assert.equal(toPlace({ type: 'node', id: 9, lat: 1, lon: 1, tags: { shop: 'gift' } }), null);
});

test('places are tagged with the town area they are in', async () => {
  const { areaOf } = await import('../scripts/fetch-osm.mjs');
  assert.equal(areaOf(42.5219, -70.894), 'salem');
  assert.equal(areaOf(42.6578, -70.6177), 'capeann'); // Dock Square, Rockport
  assert.equal(areaOf(42.36, -71.06), null); // Boston
});
