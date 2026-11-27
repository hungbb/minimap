// Park foliage stays stable through updates and fits the park's width in either layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parkTrees } from './parkTrees.ts';
import { christmasTreeReach, christmasTreeSpot } from './season.ts';
import { computeLayout, noticeBoardSpot } from './layout.ts';
test('trees have varied stable positions with room for activities in both map orientations', () => {
  for (const portrait of [false, true]) {
    const layout = computeLayout([], [], { portrait });
    const park = layout.park!;
    const trees = parkTrees(park);
    assert.deepEqual(parkTrees(park), trees);
    assert.ok(trees.length >= 3 && trees.length <= 4);
    assert.ok(new Set(trees.map((t) => t.y)).size > 2);
    for (const tree of trees) {
      assert.ok(tree.x - tree.size / 2 >= park.x && tree.x + tree.size / 2 <= park.x + park.w);
      assert.ok(tree.y > park.y && tree.y < park.y + park.h * 0.9);
      assert.ok(tree.size > 0);
    }
    const board = noticeBoardSpot(layout)!;
    assert.ok(Math.abs(board.y + board.h / 2 - (park.y + park.h / 2)) < 1e-9);
  }
});

test('at Christmas no park tree stands inside the big Christmas tree', () => {
  for (const portrait of [false, true]) {
    const layout = computeLayout([{ id: 'main', name: 'Main office', kind: 'office' }], [], { portrait });
    const park = layout.park!;
    const big = christmasTreeSpot(layout)!;
    const festive = parkTrees(park, { festive: true });
    // The gap's own tree always goes; the rest stay unless the big tree's branches reach them.
    assert.ok(festive.length < parkTrees(park).length);
    for (const tree of festive) {
      assert.ok(parkTrees(park).slice(0, 3).some((t) => t.x === tree.x && t.y === tree.y));
      assert.ok(Math.abs(tree.x - big.x) >= christmasTreeReach(big) + tree.size * 0.4);
    }
  }
});
