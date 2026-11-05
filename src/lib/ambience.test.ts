import test from 'node:test';
import assert from 'node:assert/strict';
import { ambience, CLEAR, conditions, DAY, defaultSun, mixColor, PREVIEW_WEATHER, previewTime } from './ambience.ts';

// 5 to 7 November 2026 in Hanoi (UTC+7): sunrise about 06:00, sunset about 17:20.
const SUN = [
  { rise: '2026-11-04T23:00:00.000Z', set: '2026-11-05T10:20:00.000Z' },
  { rise: '2026-11-05T23:00:00.000Z', set: '2026-11-06T10:19:00.000Z' },
  { rise: '2026-11-06T23:01:00.000Z', set: '2026-11-07T10:18:00.000Z' },
];
const weather = { isDay: true, sun: SUN };
/** A moment on 6 November in Hanoi. */
const hanoi = (time: string) => new Date(`2026-11-06T${time}:00+07:00`);

test('midday looks exactly like the town always has', () => {
  assert.deepEqual(ambience(weather, hanoi('12:00')), DAY);
  assert.deepEqual(ambience(null, hanoi('23:00')), DAY, 'no weather: always daytime');
});

test('night is dark with the lamps on, from evening until early morning', () => {
  for (const time of ['20:00', '23:59', '03:00', '04:30']) {
    const look = ambience(weather, hanoi(time));
    assert.equal(look.phase, 'night', time);
    assert.equal(look.daylight, 0, time);
    assert.equal(look.lamps, 1, time);
    assert.equal(look.sky.top, '#141a45', time);
  }
  // Just after midnight, the sun times of the next day still apply.
  assert.equal(ambience(weather, new Date('2026-11-07T00:30:00+07:00')).phase, 'night');
});

test('light changes smoothly through dawn and dusk', () => {
  let last = -1;
  for (let minute = 5 * 60; minute <= 7 * 60; minute += 5) {
    const look = ambience(weather, hanoi(`${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`));
    assert.ok(look.daylight >= last, 'it only gets lighter in the morning');
    assert.ok(look.daylight - last < 0.2 || last < 0, 'no sudden jumps');
    last = look.daylight;
  }
  assert.equal(ambience(weather, hanoi('06:00')).phase, 'dawn');
  assert.equal(ambience(weather, hanoi('17:19')).phase, 'dusk');
  assert.equal(ambience(weather, hanoi('16:30')).phase, 'dusk', 'golden hour counts as dusk');
});

test('sunrise and sunset are warm, and the lamps come on as it gets dark', () => {
  const sunset = ambience(weather, hanoi('17:19'));
  assert.equal(sunset.warmth, 1);
  assert.ok(sunset.daylight > 0.4 && sunset.daylight < 0.6);
  assert.ok(ambience(weather, hanoi('16:40')).warmth > 0.3, 'warm before sunset');
  assert.ok(ambience(weather, hanoi('18:30')).lamps === 1);
  assert.ok(ambience(weather, hanoi('17:00')).lamps < 0.5);
});

test('without sun times, the weather service decides between day and night', () => {
  assert.deepEqual(ambience({ isDay: true }, hanoi('22:00')), DAY);
  assert.equal(ambience({ isDay: false }, hanoi('12:00')).phase, 'night');
  assert.equal(ambience({ isDay: false, sun: [] }, hanoi('12:00')).daylight, 0);
});

test('colours blend exactly at the ends', () => {
  assert.equal(mixColor('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixColor('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixColor('#000000', '#ffffff', 0.5), '#808080');
});

test('previews jump to named times of day or a clock time', () => {
  const now = hanoi('09:15');
  assert.equal(previewTime('dawn', SUN, now)?.toISOString(), SUN[1]!.rise);
  assert.equal(previewTime('dusk', SUN, now)?.toISOString(), SUN[1]!.set);
  assert.equal(ambience(weather, previewTime('night', SUN, now)!).phase, 'night');
  assert.equal(ambience(weather, previewTime('day', SUN, now)!).phase, 'day');
  assert.equal(previewTime('noon-ish', SUN, now), null);
  assert.equal(previewTime('25:00', SUN, now), null);

  const local = previewTime('21:30', SUN, now)!;
  assert.equal(local.getHours(), 21);
  assert.equal(local.getMinutes(), 30);

  // Without a location, previews use a 06:00 sunrise and 18:00 sunset.
  const sun = defaultSun(now);
  assert.equal(new Date(previewTime('dawn', sun, now)!).getHours(), 6);
  assert.equal(ambience({ isDay: true, sun }, previewTime('20:00', sun, now)!).phase, 'night');
});

test('every group of weather codes shows its own weather', () => {
  const at = (code: number) => conditions({ isDay: true, code });
  assert.deepEqual(at(0), CLEAR);
  assert.ok(at(1).clouds < at(2).clouds && at(2).clouds < at(3).clouds, 'more cloud from clear to overcast');
  assert.ok(at(45).fog > 0.5 && at(48).fog > at(45).fog);
  for (const code of [51, 53, 55, 56, 57]) assert.equal(at(code).precipitation, 'drizzle', String(code));
  for (const code of [61, 63, 65, 66, 67, 80, 81, 82]) assert.equal(at(code).precipitation, 'rain', String(code));
  for (const code of [71, 73, 75, 77, 85, 86]) assert.equal(at(code).precipitation, 'snow', String(code));
  for (const code of [95, 96, 99]) assert.ok(at(code).storm && at(code).precipitation === 'rain' && at(code).wind > 0, String(code));
  assert.ok(at(61).intensity < at(63).intensity && at(63).intensity < at(65).intensity, 'heavier rain codes rain harder');
  assert.deepEqual(conditions(null), CLEAR);
  assert.deepEqual(conditions({ isDay: true }), CLEAR, 'no code: nothing to show');
});

test('cloud cover, rain amount and wind fine-tune the weather', () => {
  assert.equal(conditions({ isDay: true, code: 2, cloudCover: 30 }).clouds, 0.3);
  assert.equal(conditions({ isDay: true, code: 63, cloudCover: 30 }).clouds, 0.9, 'rain clouds stay heavy');
  assert.equal(conditions({ isDay: true, code: 61, precipitation: 12 }).intensity, 1);
  assert.equal(conditions({ isDay: true, code: 0, precipitation: 3 }).precipitation, 'none');
  assert.equal(conditions({ isDay: true, code: 63, windSpeed: 20 }).wind, 0.5);
  assert.equal(conditions({ isDay: true, code: 63, windSpeed: 90 }).wind, 1);
  assert.equal(conditions({ isDay: true, code: 95, windSpeed: 4 }).wind, 0.1, 'a measured wind beats the guess for storms');
});

test('a clear midday still looks exactly as before, and bad weather greys the sky', () => {
  assert.deepEqual(ambience({ ...weather, code: 0, cloudCover: 0 }, hanoi('12:00')), DAY);
  const rainy = ambience({ ...weather, code: 63 }, hanoi('12:00'));
  assert.equal(rainy.daylight, 1, 'rain leaves the time of day alone');
  assert.equal(rainy.weather.precipitation, 'rain');
  assert.notEqual(rainy.sky.top, DAY.sky.top);
  assert.equal(rainy.lamps, 0, 'ordinary rain leaves the lamps off by day');
  assert.ok(ambience({ ...weather, code: 95 }, hanoi('12:00')).lamps > 0, 'a dark storm turns them on a little');
  assert.equal(ambience({ ...weather, code: 63 }, hanoi('22:00')).lamps, 1);
});

test('weather previews name real weather codes', () => {
  for (const [name, preview] of Object.entries(PREVIEW_WEATHER)) {
    const shown = conditions({ isDay: true, ...preview });
    if (name === 'clear') assert.deepEqual(shown, CLEAR);
    else assert.notDeepEqual(shown, CLEAR, name);
  }
});
