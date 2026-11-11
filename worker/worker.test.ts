// Runs the real Worker and Durable Object in workerd, Cloudflare's runtime, using the
// settings in wrangler.jsonc. The API's rules are tested in server/server.test.ts, so
// these cover what only the Worker does.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTestHarness, experimental_readRawConfig } from 'wrangler';
import { MAX_BODY } from '../server/core.ts';
import type { TeamState, TeamUser } from '../shared/types.ts';

const ADMIN = { 'x-admin-password': 'secret' };
const PAGE = '<div id="root"></div>';
const ROOT = path.join(import.meta.dirname, '..');

// A morning reset 12 hours away, so that none happens in the middle of a test.
function distantResetAt(): string {
  return new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

function workerConfig(dir: string, vars: Record<string, string>) {
  // `build` is left out because these tests use a small page instead of the built ones.
  const { build: _build, ...config } = experimental_readRawConfig({ config: path.join(ROOT, 'wrangler.jsonc') }).rawConfig;
  return {
    ...config,
    main: path.join(ROOT, 'worker', 'index.ts'),
    assets: { ...config.assets, directory: path.join(dir, 'dist') },
    vars: { TZ: 'UTC', RESET_AT: distantResetAt(), ...vars },
  };
}

async function setup(t: TestContext, vars: Record<string, string> = { ADMIN_PASSWORD: 'secret' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimap-worker-'));
  fs.mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), PAGE);
  fs.writeFileSync(path.join(dir, 'dist', 'assets', 'app-abc.js'), 'console.log(1)');

  // The root is the empty folder, so a real .env or .dev.vars can't change the settings.
  const server = createTestHarness({ root: dir, workers: [{ config: workerConfig(dir, vars) }] });
  const { url } = await server.listen();
  const stopListening = new AbortController();
  t.after(async () => {
    stopListening.abort();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function api(method: string, address: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(new URL(address, url), {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, json, text };
  }

  // Adds a person who has claimed their username, and returns their login token.
  async function join(username: string): Promise<string> {
    assert.equal((await api('POST', '/api/admin/users', { username }, ADMIN)).status, 201);
    return (await api('POST', '/api/claim', { username, pin: '1234' })).json.token;
  }
  const me = (token: string, body: unknown) => api('PATCH', '/api/me', body, { Authorization: `Bearer ${token}` });
  const person = async (username: string): Promise<TeamUser | undefined> => {
    const state = (await api('GET', '/api/state')).json as TeamState;
    return state.users.find((u) => u.username === username);
  };
  // Throws away the running object, as Cloudflare does when nobody has used it for a while.
  const evict = () => server.getWorker().evictDurableObject('MINIMAP', { name: 'team' });

  const events = () => openEvents(stopListening.signal, url);

  return { server, url, dir, api, join, me, person, evict, events };
}

// Reads the live updates. It gives up after 20 seconds, so an update that never comes
// fails the test, and that is sooner than the 25 seconds the map's own timer waits.
async function openEvents(signal: AbortSignal, url: URL) {
  const res = await fetch(new URL('/api/events', url), { signal: AbortSignal.any([signal, AbortSignal.timeout(20 * 1000)]) });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  // The next message with this event name; the team's state has none.
  async function nextEvent(name = ''): Promise<any> {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const message = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = message.match(/^event: (.*)\n/)?.[1] ?? '';
        const data = message.match(/^data: (.*)$/m)?.[1];
        if (data !== undefined && event === name) return JSON.parse(data);
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('The live updates stopped.');
      buffer += value;
    }
  }
  const nextState = (): Promise<TeamState> => nextEvent();
  return { res, nextState, nextEvent };
}

test('every page serves the React app, built files come from the assets, and the rest is 404', async (t) => {
  const { api } = await setup(t);
  for (const page of ['/', '/me', '/account', '/admin', '/vote']) {
    const res = await api('GET', page);
    assert.equal(res.status, 200, page);
    assert.equal(res.text, PAGE, page);
  }
  assert.equal((await api('GET', '/assets/app-abc.js')).text, 'console.log(1)');

  const missing = await api('GET', '/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.text, 'Not found');
});

test('the API explains that it needs ADMIN_PASSWORD, while the pages still load', async (t) => {
  const { api } = await setup(t, {});
  const res = await api('GET', '/api/state');
  assert.equal(res.status, 500);
  assert.match(res.json.error, /ADMIN_PASSWORD/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await api('GET', '/me')).status, 200);
});

test('requests reach the shared API, with its status codes and headers', async (t) => {
  const { api, join, me, person } = await setup(t);
  assert.equal((await api('POST', '/api/admin/users', { username: 'a' })).status, 401);
  assert.equal((await api('GET', '/api/nope')).status, 404);

  const token = await join('a');
  assert.equal((await me(token, { place: 'main', status: 'Hello' })).status, 200);
  assert.equal((await person('a'))?.status, 'Hello');

  for (let i = 0; i < 5; i++) await api('GET', '/api/admin/check', undefined, { 'x-admin-password': 'nope' });
  const locked = await api('GET', '/api/admin/check', undefined, ADMIN);
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
});

test('a body that is not a JSON object is refused', async (t) => {
  const { url } = await setup(t);
  for (const body of ['{nope', '[1]', 'null']) {
    const res = await fetch(new URL('/api/admin/users', url), { method: 'POST', headers: ADMIN, body });
    assert.equal(res.status, 400, body);
    assert.equal(((await res.json()) as { error: string }).error, 'Invalid JSON.', body);
  }
});

test('a body that is too large is refused, even when it does not say its size', async (t) => {
  const { url } = await setup(t);
  const body = JSON.stringify({ username: 'a'.repeat(MAX_BODY) });

  const sized = await fetch(new URL('/api/admin/users', url), { method: 'POST', headers: ADMIN, body });
  assert.equal(sized.status, 413);

  const unsized = await fetch(new URL('/api/admin/users', url), {
    method: 'POST',
    headers: ADMIN,
    body: new Blob([body]).stream(),
    duplex: 'half',
  } as RequestInit);
  assert.equal(unsized.status, 413);
});

test('data and logins survive the object being thrown away', async (t) => {
  const { join, me, person, evict } = await setup(t);
  const token = await join('a');
  assert.equal((await me(token, { place: 'main', status: 'Still here' })).status, 200);

  await evict();

  assert.equal((await person('a'))?.status, 'Still here');
  assert.equal((await me(token, { status: 'Back' })).status, 200);
  assert.equal((await person('a'))?.status, 'Back');
});

test('live updates start with the current state and then follow every change', async (t) => {
  const { events, join, me } = await setup(t);
  const token = await join('a');

  const live = await events();
  assert.equal(live.res.headers.get('content-type'), 'text/event-stream');
  assert.equal(live.res.headers.get('cache-control'), 'no-store');
  assert.equal((await live.nextState()).users[0]!.status, '');

  const update = live.nextState();
  await me(token, { status: 'Live' });
  assert.equal((await update).users[0]!.status, 'Live');
});

test('an alarm moves someone at the scheduled time, with no request to wake the object', async (t) => {
  const { events, join, me } = await setup(t);
  const token = await join('a');
  await me(token, { place: 'main' });

  // Only the alarm can send this update: the map's own timer waits 25 seconds.
  const live = await events();
  await live.nextState();
  const at = new Date(Date.now() + 1000).toISOString();
  const update = live.nextState();
  assert.equal((await me(token, { scheduled: { at, status: 'Dentist' } })).status, 200);
  assert.equal((await update).users[0]!.scheduled?.at, at);

  const moved = await live.nextState();
  assert.equal(moved.users[0]!.place, 'out');
  assert.equal(moved.users[0]!.status, 'Dentist');
  assert.equal(moved.users[0]!.scheduled, null);
});

test(
  'the morning reset that passed while the object was asleep runs when it wakes',
  // The two reset times below land on different dates except in the last minute of the day.
  { skip: new Date().toISOString().slice(11, 16) === '23:59' && 'too close to midnight' },
  async (t) => {
    const { server, dir, join, me, person } = await setup(t, { ADMIN_PASSWORD: 'secret', RESET_AT: '23:59' });
    await me(await join('a'), { place: 'main', status: 'Yesterday' });

    // Today's reset hasn't happened at 23:59. Moving it to 00:00 means it was missed.
    await server.update({
      root: dir,
      workers: [{ config: workerConfig(dir, { ADMIN_PASSWORD: 'secret', RESET_AT: '00:00' }) }],
    });

    const user = await person('a');
    assert.equal(user?.place, null);
    assert.equal(user?.status, '');
  },
);

test('basketball round tickets and rankings survive Durable Object eviction and backup restore', async (t) => {
  const { api, join, evict } = await setup(t);
  const token = await join('hooper');
  assert.equal((await api('POST', '/api/basketball/round')).status, 401);
  const round = await api('POST', '/api/basketball/round', {}, { Authorization: `Bearer ${token}` });
  assert.equal(round.status, 201);
  await evict();
  const backup = (await api('GET', '/api/admin/data', undefined, ADMIN)).json;
  // The arcade keeps its tickets under its own storage key, not in the team's data.
  assert.equal(backup.users[0].basketballRound, undefined);
  const week = new Date();
  week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
  const entry = { username: 'hooper', score: 42, at: new Date().toISOString() };
  backup.basketball = { week: week.toISOString().slice(0, 10), allTime: [entry], weekly: [entry] };
  assert.equal((await api('PUT', '/api/admin/data', backup, ADMIN)).status, 200);
  await evict();
  const rankings = (await api('GET', '/api/basketball')).json;
  assert.deepEqual(rankings.allTime, [entry]);
  assert.deepEqual(rankings.weekly, [entry]);
  assert.equal((await api('POST', '/api/basketball/score', { ...round.json, shots: [] }, { Authorization: `Bearer ${token}` })).status, 400);
});

test('votes survive Durable Object eviction, and reach open maps as their own event', async (t) => {
  const { api, join, evict, events } = await setup(t);
  const token = await join('ann');
  const auth = { Authorization: `Bearer ${token}` };
  const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const made = await api('POST', '/api/vote', { title: 'Lunch', endsAt, options: ['Pho', 'Pizza'], voters: [] }, auth);
  assert.equal(made.status, 201);

  assert.equal((await api('POST', `/api/vote/${made.json.id}/ballot`, { choices: ['o2'] }, auth)).status, 200);
  await evict();
  const [vote] = (await api('GET', '/api/vote', undefined, auth)).json.votes;
  assert.deepEqual(vote.mine, ['o2']);
  assert.deepEqual(vote.voted, ['ann']);
  // Votes are kept under their own key, and still go into the admin's backup.
  const backup = (await api('GET', '/api/admin/data', undefined, ADMIN)).json;
  assert.deepEqual(backup.vote.votes[0].ballots, [['ann', ['o2']]]);

  // Open maps get the votes when they connect, and again after each change.
  const live = await events();
  const firstVotes = await live.nextEvent('vote');
  assert.equal(firstVotes[0].title, 'Lunch');
  assert.equal(firstVotes[0].mine, undefined, 'live updates never carry anyone’s picks');
  // Closing early moves the end time to now, and open maps hear about it.
  const closing = live.nextEvent('vote');
  const closed = await api('POST', `/api/vote/${made.json.id}/close`, undefined, auth);
  assert.equal(closed.status, 200);
  assert.ok(Date.parse(closed.json.endsAt) <= Date.now());
  assert.equal((await closing)[0].endsAt, closed.json.endsAt);
  const update = live.nextEvent('vote');
  assert.equal((await api('DELETE', `/api/vote/${made.json.id}`, undefined, ADMIN)).status, 200);
  assert.deepEqual(await update, []);
});

test('fund links survive Durable Object eviction, and open maps get the fund as its own event', async (t) => {
  const { api, join, evict, events } = await setup(t);
  await join('ann');
  // No sheet link, so the test never reads Google Sheets.
  assert.equal((await api('PATCH', '/api/fund/admin', { links: [['ann', 'Ann Nguyen']] }, ADMIN)).status, 200);
  await evict();
  const view = (await api('GET', '/api/fund/admin', undefined, ADMIN)).json;
  assert.deepEqual(view.links, [['ann', 'Ann Nguyen']]);
  assert.equal(view.sheet, '');
  // Kept under its own key, and still in the admin's backup.
  const backup = (await api('GET', '/api/admin/data', undefined, ADMIN)).json;
  assert.deepEqual(backup.fund.links, [['ann', 'Ann Nguyen']]);
  const live = await events();
  assert.deepEqual(await live.nextEvent('fund'), []);
});

test('the office cat survives Durable Object eviction, and open maps get it as its own event', async (t) => {
  const { api, join, evict, events } = await setup(t);
  const lan = await join('lan');
  assert.equal((await api('PATCH', '/api/pet/admin', { name: 'Tofu' }, ADMIN)).status, 200);
  assert.equal((await api('POST', '/api/pet/feed', {}, { Authorization: `Bearer ${lan}` })).status, 200);
  await evict();
  const view = (await api('GET', '/api/pet')).json;
  assert.deepEqual([view.name, view.fed, view.stage], ['Tofu', ['lan'], 'kitten']);
  // Kept under its own key, and still in the admin's backup.
  const backup = (await api('GET', '/api/admin/data', undefined, ADMIN)).json;
  assert.equal(backup.pet.name, 'Tofu');
  const live = await events();
  assert.equal((await live.nextEvent('pet')).name, 'Tofu');
});

test('birthdays and wishes survive Durable Object eviction, and open maps get them as their own event', async (t) => {
  const { api, join, evict, events } = await setup(t);
  const lan = await join('lan');
  const bob = await join('bob');
  // Today in UTC, the time zone these tests give the Worker.
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await api('PATCH', '/api/celebrate/me', { birthday: today.slice(5) }, { Authorization: `Bearer ${lan}` })).status, 200);
  assert.equal((await api('POST', '/api/celebrate/wish', { to: 'lan' }, { Authorization: `Bearer ${bob}` })).status, 200);
  await evict();
  const view = (await api('GET', '/api/celebrate')).json;
  assert.equal(view.today, today);
  assert.deepEqual(view.celebrations[0].wishes, ['bob']);
  // Kept under its own key, and still in the admin's backup.
  const backup = (await api('GET', '/api/admin/data', undefined, ADMIN)).json;
  assert.deepEqual(backup.celebrate.people, [['lan', { birthday: today.slice(5), joined: null }]]);
  const live = await events();
  assert.equal((await live.nextEvent('celebrate')).celebrations[0].username, 'lan');
});
