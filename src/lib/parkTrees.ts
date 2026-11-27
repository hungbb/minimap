// Stable random scenery shared by the two maps; foliage stays behind the park activities.
import { parkActivities, type Rect } from './layout.ts';
import { christmasTreeReach, christmasTreeSpot, parkGap } from './season.ts';

/** How far a pine's branches reach out from its trunk on both maps, as a share of its size. */
const PINE_REACH = 0.4;

/**
 * The park's trees: three along the back, and one in the first gap between the notice
 * board and the games. At Christmas the big tree takes that gap (season.ts), so it's left out,
 * and so is any tree along the back that would stand inside the big tree.
 */
export function parkTrees(park: Rect, { festive = false } = {}) {
  let seed = 731;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const count = 3;
  const trees = Array.from({ length: count }, (_, i) => {
    const size = Math.min(7, (park.w / count) * 0.85) * (0.82 + random() * 0.18);
    const x = park.x + ((i + 0.25 + random() * 0.5) / count) * park.w;
    return {
      x: Math.max(park.x + size / 2, Math.min(park.x + park.w - size / 2, x)),
      y: park.y + park.h * (0.18 + random() * 0.16),
      size,
    };
  });
  const gap = parkGap(park, parkActivities({ park })!);
  if (festive) {
    const big = christmasTreeSpot({ park });
    return big ? trees.filter((tree) => Math.abs(tree.x - big.x) >= christmasTreeReach(big) + tree.size * PINE_REACH) : trees;
  }
  if (gap) {
    const size = Math.min(6, gap.w * 0.7, park.h * 0.4);
    trees.push({ x: gap.x + gap.w / 2, y: park.y + park.h * (0.72 + random() * 0.16), size });
  }
  return trees;
}
