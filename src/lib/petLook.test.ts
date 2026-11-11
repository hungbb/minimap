// Tests for what the maps show about the office cat, and when it hops.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PetView } from '../../shared/pet.ts';
import type { Place, TeamUser } from '../../shared/types.ts';
import { inMainOffice, newFeed, petShown } from './petLook.ts';

const places: Place[] = [{ id: 'main', name: 'Main', kind: 'office' }, { id: 'other', name: 'Other', kind: 'office' }];
const user = (username: string, place: string | null) => ({ username, place }) as TeamUser;
const view = (fed: string[], day = '2026-11-10'): PetView => ({ name: 'Miu', day, fed, goodDays: 0, quietDays: 0, stage: 'kitten', toGrow: 5 });

test('only people in the main office keep the cat company', () => {
  const users = [user('a', 'main'), user('b', 'other'), user('c', 'main'), user('d', null)];
  assert.equal(inMainOffice({ places, users }), 2);
  assert.equal(inMainOffice({ places: [], users }), 0);
});

test('the cat naps in an empty office and is happy with company and food', () => {
  assert.equal(petShown(view([]), { places, users: [] }, 0)?.mood, 'sleeping');
  assert.equal(petShown(view(['a']), { places, users: [user('a', 'main'), user('b', 'main')] }, 3)?.mood, 'happy');
  assert.equal(petShown(view([]), { places: [], users: [] }, 0), null);
  assert.equal(petShown(null, { places, users: [] }, 0), null);
});

test('a hop plays for a new feed on the same day only', () => {
  assert.ok(newFeed(view([]), view(['a'])));
  assert.equal(newFeed(view(['a']), view(['a'])), false);
  assert.equal(newFeed(null, view(['a'])), false);
  assert.equal(newFeed(view(['a', 'b'], '2026-11-09'), view(['a', 'b', 'c'])), false);
});
