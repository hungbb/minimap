import test from 'node:test';
import assert from 'node:assert/strict';
import type { Place, TeamUser } from '../../shared/types.ts';
import { computeLayout, isNotWorking, noticeBoardSpot, parkActivities, petSpot, placeGroup, placeName, shareLength, type Zone } from './layout.ts';

const office = (id: string): Place => ({ id, name: id, kind: 'office' });
const TWO_OFFICES = [office('main'), office('other')];

const user = (username: string, place: string | null): TeamUser => ({
  username,
  nickname: username,
  place,
  status: '',
  updatedAt: null,
  claimed: true,
  look: null,
});

function overlaps(a: Zone, b: Zone): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

for (const portrait of [false, true]) {
  const shape = portrait ? 'portrait' : 'landscape';

  for (const places of [TWO_OFFICES, [office('main')], [...TWO_OFFICES, office('third')]]) {
    test(`${shape} town with ${places.length} offices: rooms fit and don't overlap`, () => {
      const { zones, width, height } = computeLayout(places, [], { portrait });
      assert.deepEqual(
        zones.map((z) => z.id).sort(),
        [...places.map((p) => p.id), 'wfh', 'out', 'off', 'lobby'].sort(),
      );
      for (const z of zones) {
        assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= width && z.y + z.h <= height, `${z.id} is on the map`);
      }
      zones.forEach((a, i) => zones.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `${a.id} overlaps ${b.id}`)));
    });
  }

  test(`${shape} town: everyone gets a seat inside their room, however many there are`, () => {
    for (const count of [1, 5, 12, 40]) {
      const people = ['main', 'other', 'wfh', 'out', 'off', null].flatMap((place, p) =>
        Array.from({ length: count }, (_, i) => user(`u${p}-${i}`, place)),
      );
      const { seats } = computeLayout(TWO_OFFICES, people, { portrait });
      assert.equal(seats.size, people.length);
      for (const person of people) {
        const seat = seats.get(person.username)!;
        assert.equal(seat.zone.id, person.place ?? 'lobby');
        const { x, y, w, h } = seat.zone;
        assert.ok(seat.x >= x && seat.x <= x + w && seat.y >= y && seat.y <= y + h, `${person.username} of ${count}`);
      }
    }
  });
}

for (const portrait of [false, true]) {
  test(`${portrait ? 'portrait' : 'landscape'} park: all three activities fit, away from rooms and people`, () => {
    for (const count of [0, 3, 12, 40, 100]) {
      const people = crowd({ lobby: count, off: count, out: count, main: count });
      const layout = computeLayout(TWO_OFFICES, people, { portrait });
      const park = layout.park!;
      const activities = Object.values(parkActivities(layout)!);
      assert.deepEqual(noticeBoardSpot(layout), parkActivities(layout)!.board);
      for (const a of activities) {
        assert.ok(a.w > 0 && a.h > 0);
        assert.ok(a.x >= park.x && a.x + a.w <= park.x + park.w + 1e-9);
        assert.ok(a.y >= park.y && a.y + a.h <= park.y + park.h + 1e-9);
        for (const seat of layout.seats.values()) assert.ok(seat.x < park.x || seat.x > park.x + park.w || seat.y < park.y || seat.y > park.y + park.h);
      }
      activities.forEach((a, i) => activities.slice(i+1).forEach(b => {
        assert.ok(a.x+a.w < b.x || b.x+b.w < a.x || a.y+a.h < b.y || b.y+b.h < a.y);
      }));
    }
  });
}

// A usual day for a 15-person team.
const TYPICAL_DAY = [
  ...Array.from({ length: 5 }, (_, i) => user(`main${i}`, 'main')),
  ...Array.from({ length: 5 }, (_, i) => user(`home${i}`, 'wfh')),
  ...Array.from({ length: 3 }, (_, i) => user(`other${i}`, 'other')),
  ...Array.from({ length: 2 }, (_, i) => user(`out${i}`, 'out')),
];

test('the main office and home get the same room, and the other office less', () => {
  const { zones } = computeLayout(TWO_OFFICES, []);
  const find = (id: string) => zones.find((z) => z.id === id)!;
  assert.equal(find('main').w, find('wfh').w);
  assert.equal(find('main').h, find('wfh').h);
  assert.ok(find('other').w < find('main').w / 1.5);
});

test('on a usual day, people in the main office and at home are the same size and roomy', () => {
  const { seats } = computeLayout(TWO_OFFICES, TYPICAL_DAY);
  const main = seats.get('main0')!.cell;
  assert.equal(main, seats.get('home0')!.cell);
  assert.ok(main >= 9.5, `main office cell is ${main}`);
  assert.ok(seats.get('other0')!.cell >= 7, 'the other office still fits three people');
  assert.ok(seats.get('out0')!.cell >= 10, 'the street has plenty of room for two');
});

test('on a usual day, Not checked in and Off are far smaller than the working rooms', () => {
  const day = { main: 5, wfh: 5, other: 3, out: 2, off: 1 };
  const area = (id: string) => {
    const z = zoneOf(day, id);
    return z.w * z.h;
  };
  for (const small of ['lobby', 'off']) {
    for (const big of ['main', 'wfh']) {
      assert.ok(area(small) < area(big) / 2.5, `${small} ${area(small)}, ${big} ${area(big)}`);
    }
    assert.ok(area(small) < area('other') / 1.5, `${small} against other`);
  }
  assert.ok(zoneOf(day, 'lobby').h < zoneOf(day, 'main').h / 2, 'the bottom row is much shorter');
});

test('the park fills the space the lobby and beach do not need', () => {
  const { zones, park, width } = computeLayout(TWO_OFFICES, crowd({ main: 5, wfh: 5, off: 1 }));
  const find = (id: string) => zones.find((z) => z.id === id)!;
  assert.ok(park, 'there is a park on a usual day');
  assert.ok(park.x >= find('lobby').x + find('lobby').w);
  assert.ok(park.x + park.w <= find('off').x);
  assert.ok(find('off').x + find('off').w <= width);
  assert.ok(computeLayout(TWO_OFFICES, crowd({ lobby: 15, off: 8 })).park!.w >= 8, 'the arcade keeps its reserved space on busy days');
});

test('people in the small rooms stay inside them', () => {
  const { seats } = computeLayout(TWO_OFFICES, crowd({ main: 5, wfh: 5, off: 3 }));
  const seat = seats.get('off0')!;
  assert.ok(seat.cell >= 6, `cell is ${seat.cell}`);
});

test('Not checked in stays small unless people are in it', () => {
  const { w: emptyWidth } = zoneOf({ main: 15 }, 'lobby');
  assert.equal(emptyWidth, 20, 'the lobby no longer reserves space for the board');
  assert.ok(zoneOf({ lobby: 6 }, 'lobby').w > emptyWidth, 'it still grows for people');
});

test('first thing in the morning, the whole team fits in the lobby at a readable size', () => {
  const everyone = Array.from({ length: 15 }, (_, i) => user(`u${i}`, null));
  const { seats } = computeLayout(TWO_OFFICES, everyone);
  assert.ok(seats.get('u0')!.cell >= 5.5, `lobby cell is ${seats.get('u0')!.cell}`);
});

const crowd = (split: Record<string, number>) =>
  Object.entries(split).flatMap(([place, n]) =>
    Array.from({ length: n }, (_, i) => user(`${place}${i}`, place === 'lobby' ? null : place)),
  );

const zoneOf = (split: Record<string, number>, id: string, portrait = false) =>
  computeLayout(TWO_OFFICES, crowd(split), { portrait }).zones.find((z) => z.id === id)!;

for (const portrait of [false, true]) {
  const shape = portrait ? 'portrait' : 'landscape';

  test(`${shape}: a room gets bigger as people move into it`, () => {
    const area = (split: Record<string, number>, id: string) => {
      const z = zoneOf(split, id, portrait);
      return z.w * z.h;
    };
    assert.ok(area({ main: 10, wfh: 2 }, 'main') > area({ main: 2, wfh: 10 }, 'main'));
    assert.ok(area({ main: 2, wfh: 10 }, 'wfh') > area({ main: 10, wfh: 2 }, 'wfh'));
    assert.ok(area({ other: 8, main: 2, wfh: 2 }, 'other') > area({ other: 1, main: 2, wfh: 2 }, 'other'));
    assert.ok(area({ lobby: 15 }, 'lobby') > area({ off: 15 }, 'lobby'));
    assert.ok(area({ off: 15 }, 'off') > area({ lobby: 15 }, 'off'));
  });

  test(`${shape}: rooms never overlap or leave the map, whatever the split`, () => {
    const splits: Record<string, number>[] = [
      {},
      { main: 15 },
      { wfh: 15 },
      { other: 15 },
      { out: 15 },
      { off: 15 },
      { lobby: 15 },
      { main: 5, wfh: 5, other: 3, out: 2 },
      { main: 1, wfh: 1, other: 1, out: 1, off: 1, lobby: 1 },
      { main: 40, wfh: 40, other: 40, out: 40, off: 40, lobby: 40 },
    ];
    for (const places of [TWO_OFFICES, [office('main')], [...TWO_OFFICES, office('third'), office('fourth'), office('fifth')]]) {
      for (const split of splits) {
        const people = crowd(split).filter((p) => p.place === null || p.place === 'wfh' || p.place === 'out' || p.place === 'off' || places.some((o) => o.id === p.place));
        const { zones, width, height, seats } = computeLayout(places, people, { portrait });
        const label = `${places.length} offices, ${JSON.stringify(split)}`;
        for (const z of zones) {
          assert.ok(z.w > 0 && z.h > 0, `${z.id} has a size: ${label}`);
          assert.ok(z.x >= -0.001 && z.y >= -0.001 && z.x + z.w <= width + 0.001 && z.y + z.h <= height + 0.001, `${z.id} is on the map: ${label}`);
        }
        zones.forEach((a, i) => zones.slice(i + 1).forEach((b) => {
          const clear = a.x + a.w <= b.x + 0.001 || b.x + b.w <= a.x + 0.001 || a.y + a.h <= b.y + 0.001 || b.y + b.h <= a.y + 0.001;
          assert.ok(clear, `${a.id} overlaps ${b.id}: ${label}`);
        }));
        assert.equal(seats.size, people.length, label);
      }
    }
  });
}

test('moving one person only nudges the rooms', () => {
  const before = zoneOf({ main: 5, wfh: 5, other: 3, out: 2 }, 'main');
  const after = zoneOf({ main: 4, wfh: 6, other: 3, out: 2 }, 'main');
  assert.ok(before.w > after.w);
  assert.ok(before.w - after.w < 5, `changed by ${before.w - after.w}`);
});

test('the wide map keeps its overall size, so the plan does not jump', () => {
  const splits: Record<string, number>[] = [{}, { lobby: 15 }, { main: 15 }, { out: 15 }];
  for (const split of splits) {
    const { width, height } = computeLayout(TWO_OFFICES, crowd(split));
    assert.deepEqual([width, height], [100, 68]);
  }
});

test('the street gets wider only when many people are out', () => {
  assert.equal(zoneOf({ out: 2 }, 'out').h, 12);
  assert.equal(zoneOf({ out: 8 }, 'out').h, 12);
  assert.ok(zoneOf({ out: 15 }, 'out').h > 12);
});

test('length is shared by minimum, then weight', () => {
  assert.deepEqual(shareLength(100, [{ min: 10, weight: 1 }, { min: 10, weight: 3 }]), [30, 70]);
  assert.deepEqual(shareLength(100, [{ min: 10, weight: 0 }, { min: 10, weight: 0 }]), [50, 50]);
  assert.deepEqual(shareLength(10, [{ min: 10, weight: 1 }, { min: 10, weight: 1 }]), [5, 5], 'shrinks to fit');
});

test('the main office and home stay equal with more offices', () => {
  for (const places of [[office('main')], [...TWO_OFFICES, office('third')]]) {
    const { zones } = computeLayout(places, []);
    const find = (id: string) => zones.find((z) => z.id === id)!;
    assert.equal(find('main').w, find('wfh').w);
  }
});

test('the street lines up with the other areas, between the buildings and the beach', () => {
  for (const portrait of [false, true]) {
    const { zones } = computeLayout(TWO_OFFICES, [], { portrait });
    const find = (id: string) => zones.find((z) => z.id === id)!;
    const street = find('out');
    assert.equal(street.kind, 'street');
    const others = zones.filter((z) => z !== street);
    const left = Math.min(...others.map((z) => z.x));
    const right = Math.max(...others.map((z) => z.x + z.w));
    assert.equal(street.x, left, 'same left edge as the other areas');
    assert.ok(Math.abs(street.x + street.w - right) < 1e-9, 'same right edge as the other areas');
    assert.ok(find('main').y + find('main').h <= street.y);
    assert.ok(find('off').y >= street.y + street.h);
  }
});

test('people on the street stand clear of its name on a wide screen', () => {
  const { seats } = computeLayout(TWO_OFFICES, [user('a', 'out')]);
  assert.ok(seats.get('a')!.x > 15);
});

test('places are grouped into working, not working and not checked in', () => {
  for (const place of ['main', 'other', 'wfh']) assert.equal(placeGroup(place, TWO_OFFICES), 'working', place);
  for (const place of ['off', 'out']) assert.equal(placeGroup(place, TWO_OFFICES), 'notWorking', place);
  assert.equal(placeGroup(null, TWO_OFFICES), 'notCheckedIn');
  assert.equal(placeGroup('closed-office', TWO_OFFICES), 'notCheckedIn');
  assert.equal(isNotWorking('out'), true);
  assert.equal(isNotWorking('main'), false);
  assert.equal(placeName(TWO_OFFICES, 'out'), 'Out of Office');
});

test('someone whose office was removed waits in the lobby', () => {
  const { seats } = computeLayout(TWO_OFFICES, [user('a', 'closed-office')]);
  assert.equal(seats.get('a')!.zone.id, 'lobby');
});


test('the arcade park remains clear of rooms and people in both map orientations', () => {
  for (const portrait of [false,true]) for (const count of [0,15,100]) {
    const layout=computeLayout(TWO_OFFICES,crowd({lobby:count,off:count}),{portrait});
    const park=layout.park;
    assert.ok(park);
    assert.ok(park.w>=8 && park.h>=13);
    assert.ok(park.x>=0 && park.y>=0 && park.x+park.w<=layout.width+.001 && park.y+park.h<=layout.height+.001);
    for (const zone of layout.zones) assert.ok(!overlaps({...park,kind:'lobby',id:'arcade',name:'arcade',count:0},zone),'the arcade does not occupy a team room');
    for (const seat of layout.seats.values()) assert.ok(!(seat.x>park.x && seat.x<park.x+park.w && seat.y>park.y && seat.y<park.y+park.h));
  }
});


test('reserving the park does not collapse a quiet lobby or beach beside a crowded neighbour', () => {
  for (const split of [{off:100, lobby:0}, {off:0, lobby:100}]) {
    const layout = computeLayout(TWO_OFFICES, crowd(split));
    assert.ok(layout.zones.find(z => z.id === 'lobby')!.w >= 20);
    assert.ok(layout.zones.find(z => z.id === 'off')!.w >= 22);
    assert.ok(layout.park!.w >= 38);
  }
});

test('the office cat sits inside the main office, near its bottom-right corner, in both layouts', () => {
  const places = [{ id: 'main', name: 'Main Office', kind: 'office' as const }, { id: 'other', name: 'Other Office', kind: 'office' as const }];
  for (const portrait of [false, true]) {
    const layout = computeLayout(places, [], { portrait });
    const spot = petSpot(layout, places)!;
    const room = layout.zones.find((z) => z.id === 'main')!;
    assert.ok(spot.x - spot.size / 2 > room.x + room.w / 2 && spot.x + spot.size / 2 < room.x + room.w, `${portrait}`);
    assert.ok(spot.y > room.y + room.h / 2 && spot.y < room.y + room.h, `${portrait}`);
    assert.ok(spot.size >= 3 && spot.size <= 6);
  }
  assert.equal(petSpot(computeLayout([], []), []), null);
});
