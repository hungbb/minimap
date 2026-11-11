// Tests for the office cat's shared rules: growing up, closing days, mood and names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, dateIn, moodOf, rollOver, stageFor, stageText, toView, type PetState } from './pet.ts';

const cat = (change: Partial<PetState> = {}): PetState => ({ name: 'Miu', day: '2026-11-10', fed: [], goodDays: 0, quietDays: 0, ...change });

test('good days make it grow from kitten to cat to big cat', () => {
  assert.deepEqual([0, 4, 5, 19, 20, 99].map(stageFor), ['kitten', 'kitten', 'cat', 'cat', 'bigcat', 'bigcat']);
  assert.equal(toView(cat({ goodDays: 3 })).toGrow, 2);
  assert.equal(toView(cat({ goodDays: 25 })).toGrow, null);
  assert.equal(stageText(toView(cat({ goodDays: 4 }))), 'Kitten: 1 more good day to grow up');
  assert.equal(stageText(toView(cat({ goodDays: 20 }))), 'Big cat, all grown up');
});

test('a new day counts the last one as good with three feeds, and days nobody looked as quiet', () => {
  const good = rollOver(cat({ fed: ['a', 'b', 'c'] }), '2026-11-11');
  assert.deepEqual(good, cat({ day: '2026-11-11', goodDays: 1, quietDays: 0 }));
  const quiet = rollOver(cat({ fed: ['a'], quietDays: 1 }), '2026-11-11');
  assert.deepEqual([quiet.goodDays, quiet.quietDays, quiet.fed], [0, 2, []]);
  // A good day, then three days with nobody looking.
  const away = rollOver(cat({ fed: ['a', 'b', 'c'] }), '2026-11-14');
  assert.deepEqual([away.goodDays, away.quietDays], [1, 3]);
  const same = cat({ fed: ['a'] });
  assert.equal(rollOver(same, '2026-11-10'), same);
  assert.deepEqual(rollOver(cat({ day: '' }), '2026-11-10').day, '2026-11-10');
});

test('it naps with nobody in, cheers up with feeds and company, and is sad after quiet days unfed', () => {
  assert.equal(moodOf(cat({ fed: ['a', 'b', 'c', 'd', 'e'] }), 0), 'sleeping');
  assert.equal(moodOf(cat({ quietDays: 3 }), 1), 'sad');
  assert.equal(moodOf(cat({ quietDays: 3, fed: ['a'] }), 1), 'content');
  assert.equal(moodOf(cat(), 2), 'content');
  assert.equal(moodOf(cat({ fed: ['a'] }), 2), 'happy');
  assert.equal(moodOf(cat({ fed: ['a', 'b', 'c'] }), 4), 'joyful');
});

test('names are trimmed and kept short', () => {
  assert.equal(cleanName('  Bánh   Bao '), 'Bánh Bao');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('x'.repeat(21)), null);
  assert.equal(cleanName(5), null);
});

test('a day is read on the team’s calendar', () => {
  assert.equal(dateIn(new Date('2026-11-09T18:30:00Z'), 'Asia/Ho_Chi_Minh'), '2026-11-10');
});
