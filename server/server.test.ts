import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createApp, latestResetDate, type AppOptions } from './server.ts';
import { sunTimes } from './core.ts';
import type { OfficeLocation, TeamState, TeamUser } from '../shared/types.ts';

const ADMIN = { 'x-admin-password': 'secret' };

async function setup(t: TestContext, options: Partial<AppOptions> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimap-'));
  const dataFile = path.join(dir, 'data.json');
  const publicDir = path.join(dir, 'dist');
  fs.mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<div id="root"></div>');
  fs.writeFileSync(path.join(publicDir, 'assets', 'app-abc.js'), 'console.log(1)');
  const clock = { now: new Date(2026, 10, 3, 12, 0, 0) };
  const app = createApp({ dataFile, publicDir, adminPassword: 'secret', now: () => clock.now, ...options });
  const port = await app.start(0);
  t.after(async () => {
    await app.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function api(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  }

  const addUser = (username: string) => api('POST', '/api/admin/users', { username }, ADMIN);
  const claim = async (username: string, pin = '1234'): Promise<string> => {
    const res = await api('POST', '/api/claim', { username, pin });
    return res.json.token;
  };
  const me = (token: string, body: unknown) => api('PATCH', '/api/me', body, { Authorization: `Bearer ${token}` });

  return { app, api, addUser, claim, me, clock, dataFile, port };
}

test('admin routes need the password', async (t) => {
  const { api } = await setup(t);
  assert.equal((await api('POST', '/api/admin/users', { username: 'a' })).status, 401);
  assert.equal((await api('POST', '/api/admin/users', { username: 'a' }, { 'x-admin-password': 'nope' })).status, 401);
  assert.equal((await api('POST', '/api/admin/users', { username: 'a' }, ADMIN)).status, 201);
});

test('admin login locks after 5 wrong tries', async (t) => {
  const { api } = await setup(t);
  for (let i = 0; i < 5; i++) await api('GET', '/api/admin/check', undefined, { 'x-admin-password': 'nope' });
  assert.equal((await api('GET', '/api/admin/check', undefined, ADMIN)).status, 429);
});

test('usernames are validated and unique, ignoring case', async (t) => {
  const { addUser } = await setup(t);
  assert.equal((await addUser('bad name')).status, 400);
  assert.equal((await addUser('thanh')).status, 201);
  assert.equal((await addUser('THANH')).status, 409);
});

test('a username can only be claimed once, with a 4-digit PIN', async (t) => {
  const { api, addUser } = await setup(t);
  await addUser('a');
  assert.equal((await api('POST', '/api/claim', { username: 'missing', pin: '1234' })).status, 404);
  assert.equal((await api('POST', '/api/claim', { username: 'a', pin: '12' })).status, 400);
  assert.equal((await api('POST', '/api/claim', { username: 'a', pin: '1234' })).status, 200);
  assert.equal((await api('POST', '/api/claim', { username: 'a', pin: '9999' })).status, 409);
});

test('PIN login works, and locks after 5 wrong tries until the minute passes', async (t) => {
  const { api, addUser, claim, clock } = await setup(t);
  await addUser('a');
  await claim('a');
  assert.equal((await api('POST', '/api/login', { username: 'a', pin: '1234' })).status, 200);
  for (let i = 0; i < 5; i++) {
    assert.equal((await api('POST', '/api/login', { username: 'a', pin: '0000' })).status, 401);
  }
  assert.equal((await api('POST', '/api/login', { username: 'a', pin: '1234' })).status, 429);
  clock.now = new Date(clock.now.getTime() + 61 * 1000);
  assert.equal((await api('POST', '/api/login', { username: 'a', pin: '1234' })).status, 200);
});

test('a token only edits its own user, and fields are validated', async (t) => {
  const { api, addUser, claim, me } = await setup(t);
  await addUser('a');
  await addUser('b');
  const token = await claim('a');

  assert.equal((await api('PATCH', '/api/me', { status: 'x' })).status, 401);
  assert.equal((await me('junk', { status: 'x' })).status, 401);
  assert.equal((await me(token, { place: 'moon' })).status, 400);
  assert.equal((await me(token, { nickname: '  ' })).status, 400);
  assert.equal((await me(token, { nickname: 'x'.repeat(25) })).status, 400);
  assert.equal((await me(token, { status: 'x'.repeat(141) })).status, 400);
  assert.equal((await me(token, { nickname: 'Thành', place: 'main', status: 'Leave early' })).status, 200);

  const { users } = (await api('GET', '/api/state')).json;
  const a = users.find((u: TeamUser) => u.username === 'a');
  const b = users.find((u: TeamUser) => u.username === 'b');
  assert.deepEqual([a.nickname, a.place, a.status], ['Thành', 'main', 'Leave early']);
  assert.ok(a.updatedAt);
  assert.deepEqual([b.nickname, b.place, b.status], ['b', null, '']);
});

test('releasing invalidates the old token and allows a new claim', async (t) => {
  const { api, addUser, claim, me } = await setup(t);
  await addUser('a');
  const oldToken = await claim('a');
  assert.equal((await api('POST', '/api/admin/users/a/release', undefined, ADMIN)).status, 200);
  assert.equal((await me(oldToken, { status: 'x' })).status, 401);
  const newToken = await claim('a', '4321');
  assert.equal((await me(newToken, { status: 'x' })).status, 200);
});

test('deleting removes the user', async (t) => {
  const { api, addUser } = await setup(t);
  await addUser('a');
  assert.equal((await api('DELETE', '/api/admin/users/a')).status, 401);
  assert.equal((await api('DELETE', '/api/admin/users/a', undefined, ADMIN)).status, 200);
  assert.equal((await api('GET', '/api/state')).json.users.length, 0);
});

test('state never exposes PINs or the secret', async (t) => {
  const { api, addUser, claim } = await setup(t);
  await addUser('a');
  await claim('a');
  const { text, json } = await api('GET', '/api/state');
  assert.ok(!/pinHash|pinVersion|secret/.test(text));
  assert.equal(json.users[0].claimed, true);
});

test('latestResetDate picks today after the reset time, yesterday before it', () => {
  assert.equal(latestResetDate(new Date(2026, 10, 3, 5, 0), '05:00'), '2026-11-03');
  assert.equal(latestResetDate(new Date(2026, 10, 3, 4, 59), '05:00'), '2026-11-02');
  assert.equal(latestResetDate(new Date(2026, 10, 1, 1, 0), '05:00'), '2026-10-31');
  // Cloudflare runs on UTC, so it passes the team's time zone instead.
  assert.equal(latestResetDate(new Date('2026-11-02T22:00:00Z'), '05:00', 'Asia/Ho_Chi_Minh'), '2026-11-03');
  assert.equal(latestResetDate(new Date('2026-11-02T21:59:00Z'), '05:00', 'Asia/Ho_Chi_Minh'), '2026-11-02');
  assert.equal(latestResetDate(new Date('2026-01-01T03:00:00Z'), '05:00', 'UTC'), '2025-12-31');
});

test('the daily reset clears place and status but keeps nickname and PIN', async (t) => {
  const { api, app, addUser, claim, me, clock } = await setup(t);
  await addUser('a');
  const token = await claim('a');
  await me(token, { nickname: 'Nick', place: 'wfh', status: 'Busy' });

  assert.equal(app.runResetIfDue(), false, 'same day: not due yet');
  clock.now = new Date(2026, 10, 4, 4, 59);
  assert.equal(app.runResetIfDue(), false, 'before reset time');
  clock.now = new Date(2026, 10, 4, 5, 0);
  assert.equal(app.runResetIfDue(), true);
  assert.equal(app.runResetIfDue(), false, 'runs only once a day');

  const user = (await api('GET', '/api/state')).json.users[0];
  assert.deepEqual([user.nickname, user.place, user.status, user.claimed], ['Nick', null, '', true]);
  assert.equal((await me(token, { status: 'still logged in' })).status, 200);
});

test('startup catches up on a reset missed while the server was down', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, JSON.stringify({
    secret: 's',
    lastResetDate: '2026-11-01',
    places: [{ id: 'main', name: 'Main', kind: 'office' }],
    users: [{ username: 'a', nickname: 'a', place: 'main', status: 'x', updatedAt: null, pinHash: null, pinVersion: 1 }],
  }));
  const app = createApp({ dataFile, adminPassword: 'secret', now: () => new Date(2026, 10, 3, 12, 0) });
  await app.start(0);
  await app.stop();
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(saved.users[0].place, null);
  assert.equal(saved.lastResetDate, '2026-11-03');
});

test('a first run does not count as a missed reset', async (t) => {
  const { dataFile } = await setup(t);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).lastResetDate, '2026-11-03');
});

test('data is saved to disk and reloads, with no temp file left behind', async (t) => {
  const { addUser, claim, me, dataFile } = await setup(t);
  await addUser('a');
  await me(await claim('a'), { place: 'off' });
  assert.ok(!fs.existsSync(`${dataFile}.tmp`));

  const second = createApp({ dataFile, adminPassword: 'secret', now: () => new Date(2026, 10, 3, 13, 0) });
  const port = await second.start(0);
  t.after(() => second.stop());
  const state = (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()) as TeamState;
  assert.equal(state.users[0]!.place, 'off');
});

test('the event stream sends current state, then each change', async (t) => {
  const { addUser, port } = await setup(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const nextEvent = async () => JSON.parse(decoder.decode((await reader.read()).value).replace(/^data: /, ''));

  assert.equal((await nextEvent()).users.length, 0);
  await addUser('a');
  assert.equal((await nextEvent()).users[0].username, 'a');
  await reader.cancel();
});

const HANOI: OfficeLocation = { name: 'Hanoi, Vietnam', latitude: 21.02, longitude: 105.84 };

function jsonReply(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

// Answers like the weather service, and records which addresses were requested.
function fakeWeatherService() {
  const service = {
    calls: [] as string[],
    fail: false,
    temperature: 25.4,
    fetchImpl: (async () => jsonReply({})) as typeof fetch,
  };
  service.fetchImpl = async (url) => {
    service.calls.push(String(url));
    if (service.fail) throw new Error('offline');
    if (String(url).includes('geocoding')) {
      return jsonReply({
        results: [
          { name: 'Hanoi', admin1: 'Hanoi', country: 'Vietnam', latitude: 21.02, longitude: 105.84 },
          { name: 'Hanoi', admin1: 'Hanoi', country: 'Vietnam', latitude: 20.32, longitude: 106.01 },
          { name: 'Hanoi', admin1: 'Hung Yen', country: 'Vietnam', latitude: 20.3, longitude: 106 },
        ],
      });
    }
    return jsonReply({
      current: { temperature_2m: service.temperature, weather_code: 2, is_day: 0, cloud_cover: 64, precipitation: 0.4, wind_speed_10m: null },
      // 5 to 7 November 2026 in Hanoi: about 06:00 and 17:20 local time.
      daily: { sunrise: [1793833200, 1793919600, 1794006060], sunset: [1793874000, 1793960340, 1794046680] },
    });
  };
  return service;
}

test('settings have defaults, and only the admin can change them', async (t) => {
  const { api } = await setup(t);
  const { settings, weather } = (await api('GET', '/api/state')).json;
  assert.equal(settings.publicUrl, '');
  assert.equal(settings.clocks.length, 2);
  assert.equal(settings.officeName, '');
  assert.equal(weather, null);
  assert.equal((await api('PATCH', '/api/admin/settings', { publicUrl: 'http://a.test' })).status, 401);
  assert.equal((await api('GET', '/api/admin/places?q=Hanoi')).status, 401);
});

test('the team address must be a full http address, or empty', async (t) => {
  const { api } = await setup(t);
  const save = (publicUrl: string) => api('PATCH', '/api/admin/settings', { publicUrl }, ADMIN);
  for (const bad of ['minimap.local:8080', 'javascript:alert(1)', 'not a url', `http://a.test/${'x'.repeat(300)}`]) {
    assert.equal((await save(bad)).status, 400, bad);
  }
  assert.equal((await save(' http://10.0.0.5:8080 ')).status, 200);
  assert.equal((await api('GET', '/api/state')).json.settings.publicUrl, 'http://10.0.0.5:8080');
  assert.equal((await save('')).status, 200);
  assert.equal((await api('GET', '/api/state')).json.settings.publicUrl, '');
});

test('clocks need exactly two valid time zones', async (t) => {
  const { api } = await setup(t);
  const save = (clocks: unknown) => api('PATCH', '/api/admin/settings', { clocks }, ADMIN);
  const good = { label: 'Tokyo', timeZone: 'Asia/Tokyo' };
  assert.equal((await save([good])).status, 400);
  assert.equal((await save([good, { label: 'X', timeZone: 'Mars/Base' }])).status, 400);
  assert.equal((await save([good, { label: 'X' }])).status, 400);
  assert.equal((await save([good, { label: ' ', timeZone: 'UTC' }])).status, 400);
  assert.equal((await save([good, { label: 'x'.repeat(25), timeZone: 'UTC' }])).status, 400);
  assert.equal((await save([good, { label: 'London', timeZone: 'Europe/London' }])).status, 200);
  assert.deepEqual((await api('GET', '/api/state')).json.settings.clocks[1], { label: 'London', timeZone: 'Europe/London' });
});

test('setting the office location fetches its weather, and clearing removes it', async (t) => {
  const service = fakeWeatherService();
  const { api, app } = await setup(t, { fetchImpl: service.fetchImpl });
  assert.equal(service.calls.length, 0, 'no location: no requests');

  for (const office of [{ name: 'x' }, { name: 'x', latitude: 91, longitude: 0 }, { name: '', latitude: 1, longitude: 1 }, { name: 'x', latitude: '1', longitude: 1 }]) {
    assert.equal((await api('PATCH', '/api/admin/settings', { office }, ADMIN)).status, 400);
  }

  assert.equal((await api('PATCH', '/api/admin/settings', { office: HANOI }, ADMIN)).status, 200);
  await app.refreshWeather();
  const { settings, weather } = (await api('GET', '/api/state')).json;
  assert.equal(settings.officeName, 'Hanoi, Vietnam');
  assert.equal(weather.temperature, 25.4);
  assert.equal(weather.code, 2);
  assert.equal(weather.isDay, false);
  assert.ok(service.calls.at(-1)!.includes('latitude=21.02'));
  assert.ok(service.calls.at(-1)!.includes('daily=sunrise%2Csunset'));
  assert.deepEqual(weather.sun[1], { rise: '2026-11-05T23:00:00.000Z', set: '2026-11-06T10:19:00.000Z' });
  assert.equal(weather.sun.length, 3);
  assert.ok(service.calls.at(-1)!.includes('cloud_cover%2Cprecipitation%2Cwind_speed_10m'));
  assert.equal(weather.cloudCover, 64);
  assert.equal(weather.precipitation, 0.4);
  assert.equal('windSpeed' in weather, false, 'missing details are left out');

  await api('PATCH', '/api/admin/settings', { office: null }, ADMIN);
  const cleared = (await api('GET', '/api/state')).json;
  assert.equal(cleared.settings.officeName, '');
  assert.equal(cleared.weather, null);
});

test('a short outage keeps the last weather, but an old reading is dropped', async (t) => {
  const service = fakeWeatherService();
  const { api, app, clock } = await setup(t, { fetchImpl: service.fetchImpl });
  await api('PATCH', '/api/admin/settings', { office: HANOI }, ADMIN);
  await app.refreshWeather();

  service.fail = true;
  clock.now = new Date(clock.now.getTime() + 30 * 60 * 1000);
  await app.refreshWeather();
  assert.equal((await api('GET', '/api/state')).json.weather.temperature, 25.4);

  clock.now = new Date(clock.now.getTime() + 4 * 60 * 60 * 1000);
  await app.refreshWeather();
  assert.equal((await api('GET', '/api/state')).json.weather, null);

  service.fail = false;
  service.temperature = 30;
  await app.refreshWeather();
  assert.equal((await api('GET', '/api/state')).json.weather.temperature, 30);
});

test('a slow reply for an old location cannot replace the new one', async (t) => {
  const replies: ((reply: Response) => void)[] = [];
  const fetchImpl = (() => new Promise<Response>((resolve) => replies.push(resolve))) as typeof fetch;
  const { api } = await setup(t, { fetchImpl });
  await api('PATCH', '/api/admin/settings', { office: HANOI }, ADMIN);
  await api('PATCH', '/api/admin/settings', { office: { name: 'Tokyo', latitude: 35.7, longitude: 139.7 } }, ADMIN);
  assert.equal(replies.length, 2);

  replies[1]!(jsonReply({ current: { temperature_2m: 10, weather_code: 0, is_day: 1 } }));
  replies[0]!(jsonReply({ current: { temperature_2m: 99, weather_code: 0, is_day: 1 } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await api('GET', '/api/state')).json.weather.temperature, 10);
});

test('location search returns readable names and explains failures', async (t) => {
  const service = fakeWeatherService();
  const { api } = await setup(t, { fetchImpl: service.fetchImpl });
  assert.equal((await api('GET', '/api/admin/places?q=a', undefined, ADMIN)).status, 400);

  const { json } = await api('GET', '/api/admin/places?q=Hanoi', undefined, ADMIN);
  assert.deepEqual(json.results.map((r: OfficeLocation) => r.name), ['Hanoi, Vietnam', 'Hanoi, Hung Yen, Vietnam']);

  service.fail = true;
  const failed = await api('GET', '/api/admin/places?q=Hanoi', undefined, ADMIN);
  assert.equal(failed.status, 502);
  assert.match(failed.json.error, /internet/);
});

test('settings survive a restart, and older data files gain the defaults', async (t) => {
  const service = fakeWeatherService();
  const { api, dataFile } = await setup(t, { fetchImpl: service.fetchImpl });
  await api('PATCH', '/api/admin/settings', { publicUrl: 'http://a.test', office: HANOI }, ADMIN);

  const reopen = async () => {
    const app = createApp({ dataFile, adminPassword: 'secret', now: () => new Date(2026, 10, 3, 13, 0), fetchImpl: service.fetchImpl });
    const port = await app.start(0);
    const state = (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()) as TeamState;
    await app.stop();
    return state;
  };

  const callsBefore = service.calls.length;
  const state = await reopen();
  assert.equal(state.settings.publicUrl, 'http://a.test');
  assert.equal(state.settings.officeName, 'Hanoi, Vietnam');
  assert.ok(service.calls.length > callsBefore, 'fetches the weather on start');

  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  delete saved.settings;
  fs.writeFileSync(dataFile, JSON.stringify(saved));
  assert.equal((await reopen()).settings.clocks.length, 2);
});

test('static files cannot escape the public folder', async (t) => {
  const { port, api } = await setup(t);
  const res = await fetch(`http://127.0.0.1:${port}/..%2fdata.json`);
  assert.equal(res.status, 404);
  assert.equal((await api('GET', '/data/data.json')).status, 404);
  assert.equal((await api('GET', '/api/nope')).status, 404);
});

test('every page serves the React app, and built files can be cached for good', async (t) => {
  const { port } = await setup(t);
  for (const page of ['/', '/me', '/admin']) {
    const res = await fetch(`http://127.0.0.1:${port}${page}`);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /id="root"/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
  }
  const asset = await fetch(`http://127.0.0.1:${port}/assets/app-abc.js`);
  assert.match(asset.headers.get('content-type') ?? '', /javascript/);
  assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
});

const DESIGN = {
  color: '#8d5524',
  strokes: [{ color: '#2a2657', width: 3, points: [20.04, 30, 30, 40] }],
};

test('someone can save and reset their character, without changing "updated at"', async (t) => {
  const { api, addUser, claim, me, clock } = await setup(t);
  await addUser('a');
  await addUser('b');
  const token = await claim('a');
  const read = async (name: string): Promise<TeamUser> =>
    (await api('GET', '/api/state')).json.users.find((u: TeamUser) => u.username === name);

  assert.equal((await read('a')).look, null);
  await me(token, { status: 'x' });
  const statusTime = (await read('a')).updatedAt;

  clock.now = new Date(clock.now.getTime() + 60 * 1000);
  assert.equal((await me(token, { look: DESIGN })).status, 200);
  const saved = await read('a');
  assert.equal(saved.look?.color, '#8d5524');
  assert.deepEqual(saved.look?.strokes[0]?.points, [20, 30, 30, 40], 'rounded to one decimal place');
  assert.equal(saved.updatedAt, statusTime);
  assert.equal((await read('b')).look, null, 'only their own character changes');

  assert.equal((await me(token, { look: null })).status, 200);
  assert.equal((await read('a')).look, null);
});

test('accessories are saved in a fixed order, without repeats', async (t) => {
  const { api, addUser, claim, me } = await setup(t);
  await addUser('a');
  const token = await claim('a');
  const read = async (): Promise<TeamUser> => (await api('GET', '/api/state')).json.users[0];

  assert.equal((await me(token, { look: { ...DESIGN, wearing: ['mustache', 'hat', 'hat'] } })).status, 200);
  assert.deepEqual((await read()).look?.wearing, ['hat', 'mustache']);

  assert.equal((await me(token, { look: DESIGN })).status, 200, 'wearing nothing is fine');
  assert.deepEqual((await read()).look?.wearing, []);

  assert.equal((await me(token, { look: { ...DESIGN, wearing: ['crown'] } })).status, 400);
  assert.equal((await me(token, { look: { ...DESIGN, wearing: 'hat' } })).status, 400);
});

test('characters saved before accessories existed still load', async (t) => {
  const { app, dataFile, port } = await setup(t);
  await app.stop();
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  saved.users.push({ username: 'old', nickname: 'old', place: null, status: '', updatedAt: null, pinHash: null, pinVersion: 1, look: { color: '#ffffff', strokes: [] } });
  fs.writeFileSync(dataFile, JSON.stringify(saved));

  const reopened = createApp({ dataFile, adminPassword: 'secret' });
  const newPort = await reopened.start(port);
  t.after(() => reopened.stop());
  const state = (await (await fetch(`http://127.0.0.1:${newPort}/api/state`)).json()) as TeamState;
  assert.deepEqual(state.users[0]?.look, { color: '#ffffff', wearing: [], strokes: [] });
});

test('Out of Office is a place people can choose, cleared by the morning reset', async (t) => {
  const { api, app, addUser, claim, me, clock } = await setup(t);
  await addUser('a');
  assert.equal((await me(await claim('a'), { place: 'out', status: 'Client visit' })).status, 200);
  const before = (await api('GET', '/api/state')).json.users[0];
  assert.deepEqual([before.place, before.status], ['out', 'Client visit']);

  clock.now = new Date(2026, 10, 4, 6, 0);
  app.runResetIfDue();
  assert.equal((await api('GET', '/api/state')).json.users[0].place, null);
});

test('only valid characters are saved', async (t) => {
  const { addUser, claim, me } = await setup(t);
  await addUser('a');
  const token = await claim('a');
  const stroke = DESIGN.strokes[0]!;
  const bad = [
    { ...DESIGN, color: 'red' },
    { ...DESIGN, color: '#12345' },
    { ...DESIGN, strokes: 'nope' },
    { color: '#ffffff' },
    { ...DESIGN, strokes: [null] },
    { ...DESIGN, strokes: [{ ...stroke, color: 'url(javascript:alert(1))' }] },
    { ...DESIGN, strokes: [{ ...stroke, width: 99 }] },
    { ...DESIGN, strokes: [{ ...stroke, points: [] }] },
    { ...DESIGN, strokes: [{ ...stroke, points: [1, 2, 3] }] },
    { ...DESIGN, strokes: [{ ...stroke, points: [1, '2'] }] },
    { ...DESIGN, strokes: [{ ...stroke, points: [500, 2] }] },
    { ...DESIGN, strokes: [{ ...stroke, points: [32, 40, 32, 5] }] },
    { ...DESIGN, strokes: Array.from({ length: 41 }, () => stroke) },
    { ...DESIGN, strokes: [{ ...stroke, points: Array.from({ length: 1202 }, () => 32) }] },
  ];
  for (const look of bad) {
    assert.equal((await me(token, { look })).status, 400, JSON.stringify(look).slice(0, 80));
  }
});

test('a character survives a restart and the morning reset', async (t) => {
  const { api, app, addUser, claim, me, clock, dataFile } = await setup(t);
  await addUser('a');
  await me(await claim('a'), { look: { ...DESIGN, wearing: ['glasses'] }, place: 'wfh' });

  clock.now = new Date(2026, 10, 4, 6, 0);
  assert.equal(app.runResetIfDue(), true);
  const user = (await api('GET', '/api/state')).json.users[0];
  assert.equal(user.place, null);
  assert.equal(user.look.color, '#8d5524');
  assert.deepEqual(user.look.wearing, ['glasses']);

  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(saved.users[0].look.color, '#8d5524');
});

test('the largest allowed drawing fits in one request', async (t) => {
  const { addUser, claim, me } = await setup(t);
  await addUser('a');
  const token = await claim('a');
  const points = Array.from({ length: 15 * 2 }, (_, i) => (i % 2 ? 40.5 : 44.5));
  const strokes = Array.from({ length: 40 }, () => ({ color: '#2a2657', width: 3.5, points }));
  assert.equal((await me(token, { look: { color: '#ffffff', strokes } })).status, 200);
});

test('a malformed token is refused instead of crashing', async (t) => {
  const { me } = await setup(t);
  assert.equal((await me('%E0%A4%A.1.abc', { status: 'x' })).status, 401);
});

test('the admin can export everything and import it into a new server', async (t) => {
  const first = await setup(t);
  await first.addUser('a');
  const token = await first.claim('a');
  await first.me(token, { place: 'main', status: 'Here', look: DESIGN });
  assert.equal((await first.api('GET', '/api/admin/data')).status, 401);
  const backup = (await first.api('GET', '/api/admin/data', undefined, ADMIN)).json;
  assert.ok(backup.secret && backup.users[0].pinHash, 'a backup keeps PINs and the secret');

  const second = await setup(t);
  await second.addUser('someone-else');
  assert.equal((await second.api('PUT', '/api/admin/data', backup)).status, 401);
  const res = await second.api('PUT', '/api/admin/data', backup, ADMIN);
  assert.deepEqual([res.status, res.json.users], [200, 1]);

  const { users } = (await second.api('GET', '/api/state')).json;
  assert.deepEqual(users.map((u: TeamUser) => [u.username, u.place, u.status, u.look?.color]), [['a', 'main', 'Here', DESIGN.color]]);
  assert.equal((await second.me(token, { status: 'Still logged in' })).status, 200, 'old logins keep working');
  assert.equal((await second.api('POST', '/api/login', { username: 'a', pin: '1234' })).status, 200, 'old PINs keep working');
  assert.equal(JSON.parse(fs.readFileSync(second.dataFile, 'utf8')).users[0].username, 'a', 'the import is saved');
});

test('an import from an earlier day gets the morning reset it missed', async (t) => {
  const { api, clock } = await setup(t);
  const user = { username: 'a', nickname: 'A', place: 'main', status: 'x', updatedAt: null, pinHash: null, pinVersion: 1 };
  clock.now = new Date(2026, 10, 5, 12, 0);
  assert.equal((await api('PUT', '/api/admin/data', { lastResetDate: '2026-11-03', users: [user] }, ADMIN)).status, 200);
  const [a] = (await api('GET', '/api/state')).json.users;
  assert.deepEqual([a.nickname, a.place, a.status], ['A', null, '']);
});

test('broken backups are refused and change nothing', async (t) => {
  const { api, addUser } = await setup(t);
  await addUser('keep');
  const user = { username: 'a', nickname: 'a', place: null, status: '', updatedAt: null, pinHash: null, pinVersion: 1 };
  const bad = [
    {},
    { users: 'nope' },
    { users: [{ ...user, username: 'bad name' }] },
    { users: [user, { ...user, username: 'A' }] },
    { users: [{ ...user, pinVersion: 0 }] },
    { users: [{ ...user, pinHash: 'nohash' }] },
    { users: [{ ...user, look: { color: 'red', strokes: [] } }] },
    { users: [user], places: [] },
    { users: [user], settings: { clocks: [] } },
    { users: [user], lastResetDate: 'yesterday' },
  ];
  for (const body of bad) {
    assert.equal((await api('PUT', '/api/admin/data', body, ADMIN)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.deepEqual((await api('GET', '/api/state')).json.users.map((u: TeamUser) => u.username), ['keep']);
});

test('people in an office that is gone count as not checked in after an import', async (t) => {
  const { api } = await setup(t);
  const user = { username: 'a', nickname: 'a', place: 'old-office', status: '', updatedAt: null, pinHash: null, pinVersion: 1 };
  assert.equal((await api('PUT', '/api/admin/data', { lastResetDate: '2026-11-03', users: [user] }, ADMIN)).status, 200);
  assert.equal((await api('GET', '/api/state')).json.users[0].place, null);
});

test('sun times pair up by day, leaving out days without a real sunrise and sunset', () => {
  assert.deepEqual(sunTimes([0, 86_400], [3_600, 90_000]), [
    { rise: '1970-01-01T00:00:00.000Z', set: '1970-01-01T01:00:00.000Z' },
    { rise: '1970-01-02T00:00:00.000Z', set: '1970-01-02T01:00:00.000Z' },
  ]);
  // Polar night and day: no sunrise, a sunset before sunrise, or a full day of sun.
  assert.deepEqual(sunTimes([null, 100, 0], [50, 50, 86_400]), []);
  assert.deepEqual(sunTimes(), []);
});
