// The Christmas look's dates, preview, lights, tree, Santa and sleigh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bulbSpots, christmasTreeSpot, isFestive, LIGHT_COLOURS, parkGap, previewSeason, santaSpot, seasonOn, sleighProgress, twinkle } from './season.ts';
import { computeLayout, parkActivities } from './layout.ts';
import { parkTrees } from './parkTrees.ts';

const on = (month: number, day: number) => seasonOn(new Date(2026, month - 1, day, 12));

test('Christmas, Santa included, runs from the first of December to the last', () => {
  assert.equal(on(11, 30), 'none');
  assert.equal(seasonOn(new Date(2026, 10, 30, 23, 59)), 'none');
  assert.equal(seasonOn(new Date(2026, 11, 1, 0, 0)), 'christmas');
  assert.equal(on(12, 24), 'christmas');
  assert.equal(on(12, 26), 'christmas');
  assert.equal(seasonOn(new Date(2026, 11, 31, 23, 59)), 'christmas');
  assert.equal(seasonOn(new Date(2027, 0, 1, 0, 0)), 'none');
  assert.equal(isFestive('none'), false);
  assert.equal(isFestive('christmas'), true);
});

test('a preview takes only the names it knows', () => {
  assert.equal(previewSeason('christmas'), 'christmas');
  assert.equal(previewSeason('santa'), null);
  assert.equal(previewSeason('none'), 'none');
  assert.equal(previewSeason('summer'), null);
  assert.equal(previewSeason(null), null);
});

test('lights twinkle at different times, and stay steady without motion', () => {
  for (let i = 0; i < LIGHT_COLOURS.length; i++) {
    for (const time of [0, 0.4, 1.1, 7.3]) {
      const level = twinkle(i, time, false);
      assert.ok(level >= 0.35 && level <= 1);
      assert.equal(twinkle(i, time, true), 1);
    }
  }
  assert.notEqual(twinkle(0, 1, false), twinkle(1, 1, false));
});

test('bulbs spread evenly along a string', () => {
  assert.deepEqual(bulbSpots(10, 5), [0.25, 0.75]);
  assert.equal(bulbSpots(1, 5).length, 2);
  const spots = bulbSpots(100, 4);
  assert.equal(spots.length, 25);
  assert.ok(spots.every((s) => s > 0 && s < 1));
});

test('the Christmas tree towers over its gap in the park, with Santa beside it', () => {
  for (const portrait of [false, true]) {
    const layout = computeLayout([{ id: 'main', name: 'Main office', kind: 'office' }], [], { portrait });
    const park = layout.park!;
    const tree = christmasTreeSpot(layout)!;
    const activities = parkActivities(layout)!;
    assert.ok(tree.w > 0 && tree.h > tree.w);
    const gap = parkGap(park, activities)!;
    assert.ok(Math.abs(tree.x - (gap.x + gap.w / 2)) < 1e-9);
    assert.ok(tree.w <= Math.max(gap.w * 1.5, park.h * 0.45) + 1e-9);
    assert.ok(tree.y <= park.y + park.h && tree.y - tree.h >= park.y - 1e-9);
    const santa = santaSpot(tree);
    assert.ok(santa.x < tree.x && santa.x > tree.x - tree.w / 2 && santa.size > 0);
    // The ordinary tree that stands in the same gap the rest of the year is in the middle of it.
    assert.ok(parkTrees(park).some((t) => Math.abs(t.x - (gap.x + gap.w / 2)) < 1e-9));
  }
  assert.equal(christmasTreeSpot({ park: null }), null);
});

test('the sleigh crosses the sky, rests, and comes back', () => {
  assert.equal(sleighProgress(0, false), 0);
  assert.equal(sleighProgress(9, false), 0.5);
  assert.equal(sleighProgress(30, false), null);
  assert.equal(sleighProgress(42 + 9, false), 0.5);
  assert.equal(sleighProgress(30, true), 0.78);
});
