// Tests for the office cat's API, through a real Node.js server and its data files.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createApp } from '../server.ts';
import type { PetView } from '../../shared/pet.ts';

const ADMIN = { 'x-admin-password': 'secret' };

async function setup(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minimap-pet-'));
  const dataFile = path.join(dir, 'data.json');
  const petFile = path.join(dir, 'pet.json');
  fs.writeFileSync(path.join(dir, 'index.html'), '<div id="root"></div>');
  const clock = { now: new Date('2026-11-10T12:00:00Z') };
  const options = { dataFile, publicDir: dir, adminPassword: 'secret', now: () => clock.now };
  let app = createApp(options);
  let port = await app.start(0);
  t.after(async () => {
    await app.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function api(method: string, address: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${address}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  }

  const tokens = new Map<string, string>();
  async function join(...usernames: string[]) {
    for (const username of usernames) {
      await api('POST', '/api/admin/users', { username }, ADMIN);
      tokens.set(username, (await api('POST', '/api/claim', { username, pin: '1234' })).json.token);
    }
  }
  const as = (username: string) => ({ Authorization: `Bearer ${tokens.get(username)}` });
  const view = async (): Promise<PetView> => (await api('GET', '/api/pet')).json;
  const feed = (username: string) => api('POST', '/api/pet/feed', {}, as(username));
  async function restart() {
    await app.stop();
    app = createApp(options);
    port = await app.start(0);
  }
  return { api, join, view, feed, restart, clock, petFile, dataFile };
}

test('a new team starts with a kitten named Miu', async (t) => {
  const { view } = await setup(t);
  const pet = await view();
  assert.deepEqual([pet.name, pet.stage, pet.fed, pet.goodDays, pet.toGrow], ['Miu', 'kitten', [], 0, 5]);
});

test('people feed it once a day after logging in, and the feeds are saved in its own file', async (t) => {
  const { api, join, view, feed, restart, petFile, dataFile } = await setup(t);
  await join('lan', 'bob');
  assert.equal((await api('POST', '/api/pet/feed')).status, 401);
  assert.equal((await feed('lan')).status, 200);
  assert.deepEqual((await feed('lan')).json.fed, ['lan']);
  await feed('bob');
  assert.deepEqual(JSON.parse(fs.readFileSync(petFile, 'utf8')).fed, ['lan', 'bob']);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).pet, undefined);
  await restart();
  assert.deepEqual((await view()).fed, ['lan', 'bob']);
});

test('three feeds make a good day, and good days make it grow up', async (t) => {
  const { join, view, feed, clock } = await setup(t);
  await join('a', 'b', 'c');
  for (let day = 0; day < 5; day++) {
    clock.now = new Date(Date.UTC(2026, 10, 10 + day, 12));
    for (const name of ['a', 'b', 'c']) await feed(name);
  }
  clock.now = new Date('2026-11-15T12:00:00Z');
  const grown = await view();
  assert.deepEqual([grown.goodDays, grown.stage, grown.fed, grown.quietDays], [5, 'cat', [], 0]);
  // Two days with too few feeds count as quiet.
  await feed('a');
  clock.now = new Date('2026-11-17T12:00:00Z');
  assert.deepEqual([(await view()).goodDays, (await view()).quietDays], [5, 2]);
});

test('only the admin names it, with a name that fits', async (t) => {
  const { api, view } = await setup(t);
  assert.equal((await api('PATCH', '/api/pet/admin', { name: 'Bánh Bao' })).status, 401);
  assert.equal((await api('PATCH', '/api/pet/admin', { name: '   ' }, ADMIN)).status, 400);
  assert.equal((await api('PATCH', '/api/pet/admin', { name: 'Bánh Bao' }, ADMIN)).status, 200);
  assert.equal((await view()).name, 'Bánh Bao');
});

test('the cat goes into the backup, and deleted people drop out of today’s feeds', async (t) => {
  const { api, join, view, feed } = await setup(t);
  await join('lan', 'bob');
  await feed('lan');
  await feed('bob');
  await api('PATCH', '/api/pet/admin', { name: 'Tofu' }, ADMIN);
  const backup = (await api('GET', '/api/admin/data', undefined, ADMIN)).json;
  assert.deepEqual([backup.pet.name, backup.pet.fed], ['Tofu', ['lan', 'bob']]);

  const broken = structuredClone(backup);
  broken.pet.fed.push('ghost');
  assert.equal((await api('PUT', '/api/admin/data', broken, ADMIN)).status, 400);

  assert.equal((await api('DELETE', '/api/admin/users/bob', undefined, ADMIN)).status, 200);
  assert.deepEqual((await view()).fed, ['lan']);
  assert.equal((await api('PUT', '/api/admin/data', backup, ADMIN)).status, 200);
  assert.deepEqual((await view()).fed, ['lan', 'bob']);
});

test('two feeds from one person queued behind a slow save count once', async () => {
  const { createPet } = await import('./core.ts');
  let release = () => {};
  const saves: string[][] = [];
  const pet = createPet({
    saved: null,
    save: async (data) => {
      saves.push(data.fed);
      // The first save waits, so the next feeds queue up behind it.
      if (saves.length === 1) await new Promise<void>((done) => (release = done));
    },
    team: {
      player: () => ({ username: 'lan', pinVersion: 1 }),
      members: () => ['lan'],
      sign: () => '',
      requireAdmin: () => {},
    },
    now: () => new Date('2026-11-10T12:00:00Z'),
    timeZone: 'UTC',
  });
  const req = { method: 'POST', url: new URL('http://x/api/pet/feed'), header: () => undefined, readJson: async () => ({}) };
  const slow = pet.tick();
  const first = pet.handle(req);
  const second = pet.handle(req);
  await new Promise((done) => setTimeout(done, 10));
  release();
  await slow;
  const replies = await Promise.all([first, second]);
  assert.deepEqual(replies.map((reply) => (reply?.body as PetView).fed), [['lan'], ['lan']]);
  assert.deepEqual(saves.at(-1), ['lan']);
});
