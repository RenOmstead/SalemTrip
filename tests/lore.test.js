import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LORE, LORE_KINDS } from '../js/lore.js';
import { PLACES, TOWNS } from '../js/places.js';

test('every story has a real spot in Salem or Rockport', () => {
  for (const l of LORE) {
    assert.ok(LORE_KINDS[l.kind], `${l.title}: kind`);
    assert.ok(['salem', 'rockport'].includes(l.town), `${l.title}: town`);
    assert.ok(l.story.length > 80, `${l.title}: story`);
    const p = PLACES.find(x => x.lore === l);
    assert.ok(p, `${l.title}: place`);
    const [[s, w], [n, e]] = l.town === 'salem' ? TOWNS.salem.bounds : TOWNS.rockport.bounds;
    assert.ok(p.lat > s && p.lat < n && p.lng > w && p.lng < e, `${l.title}: inside ${l.town}`);
  }
});
