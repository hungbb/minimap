// Team Minimap server for Node.js. Built-ins only: run with `node server/server.ts`.
// The API lives in core.ts and each feature's own folder; this file adds the web server,
// the data files, live updates and the timers. worker/index.ts does the same job on Cloudflare.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createBasketball, takeOldBasketball } from './basketball/core.ts';
import { createCelebrate } from './celebrate/core.ts';
import { createFund } from './fund/core.ts';
import { createPet } from './pet/core.ts';
import { FUND_EVERY_MS } from '../shared/fund.ts';
import { createVote } from './vote/core.ts';
import { ApiError, createCore, MAX_BODY, WEATHER_EVERY_MS, type ApiRequest, type JsonBody } from './core.ts';

export { latestResetDate } from './core.ts';

type Req = http.IncomingMessage;
type Res = http.ServerResponse;

export interface AppOptions {
  dataFile: string;
  publicDir?: string;
  adminPassword: string;
  resetAt?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

const ROOT = path.join(import.meta.dirname, '..');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// React decides which page to show, so these all serve the same file.
const PAGES = new Set(['/', '/me', '/account', '/admin', '/vote']);

function readFile(file: string): any {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// Writes a copy first, so a crash halfway never leaves a broken file.
function writeFile(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function createApp({ dataFile, publicDir = path.join(ROOT, 'dist'), ...options }: AppOptions) {
  const sseClients = new Set<Res>();
  // Each feature keeps its own file next to the team's.
  const basketballFile = path.join(path.dirname(dataFile), 'basketball.json');
  const voteFile = path.join(path.dirname(dataFile), 'vote.json');
  const fundFile = path.join(path.dirname(dataFile), 'fund.json');
  const petFile = path.join(path.dirname(dataFile), 'pet.json');
  const celebrateFile = path.join(path.dirname(dataFile), 'celebrate.json');

  const teamSaved = readFile(dataFile);
  const oldBasketball = takeOldBasketball(teamSaved);
  const core = createCore({
    ...options,
    saved: teamSaved,
    save: (data) => writeFile(dataFile, data),
    onChange: (state) => sendAll(`data: ${JSON.stringify(state)}\n\n`),
  });

  const basketballSaved = readFile(basketballFile);
  const basketball = createBasketball({
    saved: basketballSaved ?? oldBasketball,
    save: (data) => writeFile(basketballFile, data),
    team: core.team,
    now: options.now,
  });
  core.attach(basketball.feature);
  // Scores from the team's file get their own file before the team's file is written without them.
  if (!basketballSaved && oldBasketball) void basketball.save();

  const votes = createVote({
    saved: readFile(voteFile),
    save: (data) => writeFile(voteFile, data),
    team: core.team,
    // Its own event name, so maps tell it apart from the team's state.
    onChange: (views) => sendAll(voteEvent(views)),
    now: options.now,
  });
  core.attach(votes.feature);

  const fund = createFund({
    saved: readFile(fundFile),
    save: (data) => writeFile(fundFile, data),
    team: core.team,
    onChange: (people) => sendAll(fundEvent(people)),
    now: options.now,
    fetchImpl: options.fetchImpl,
  });
  core.attach(fund.feature);

  const pet = createPet({
    saved: readFile(petFile),
    save: (data) => writeFile(petFile, data),
    team: core.team,
    onChange: (view) => sendAll(petEvent(view)),
    now: options.now,
  });
  core.attach(pet.feature);

  function petEvent(view: unknown): string {
    return `event: pet
data: ${JSON.stringify(view)}

`;
  }

  const celebrate = createCelebrate({
    saved: readFile(celebrateFile),
    save: (data) => writeFile(celebrateFile, data),
    team: core.team,
    onChange: (view) => sendAll(celebrateEvent(view)),
    now: options.now,
  });
  core.attach(celebrate.feature);

  function celebrateEvent(view: unknown): string {
    return `event: celebrate
data: ${JSON.stringify(view)}

`;
  }

  // The fund's looks and titles have their own event name too.
  function fundEvent(people: unknown): string {
    return `event: fund
data: ${JSON.stringify(people)}

`;
  }

  function voteEvent(views: unknown): string {
    return `event: vote\ndata: ${JSON.stringify(views)}\n\n`;
  }

  function sendAll(payload: string): void {
    for (const res of sseClients) res.write(payload);
  }

  async function answer(req: ApiRequest) {
    return (await basketball.handle(req)) ?? (await votes.handle(req)) ?? (await fund.handle(req)) ?? (await celebrate.handle(req))
      ?? (await pet.handle(req)) ?? (await core.handle(req));
  }

  function readJson(req: Req, maxBytes = MAX_BODY): Promise<JsonBody> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          reject(new ApiError(413, 'Request too large.'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
          resolve(body as JsonBody);
        } catch {
          reject(new ApiError(400, 'Invalid JSON.'));
        }
      });
      req.on('error', reject);
    });
  }

  function openEvents(req: Req, res: Res): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify(core.publicState())}\n\n`);
    res.write(voteEvent(votes.views()));
    res.write(fundEvent(fund.people()));
    res.write(celebrateEvent(celebrate.view()));
    res.write(petEvent(pet.view()));
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  }

  async function handleApi(req: Req, res: Res, url: URL): Promise<void> {
    if (req.method === 'GET' && url.pathname === '/api/events') return openEvents(req, res);
    const { status, body, headers } = await answer({
      method: req.method ?? 'GET',
      url,
      header: (name) => {
        const value = req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] : value;
      },
      readJson: (maxBytes) => readJson(req, maxBytes),
    });
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function serveStatic(req: Req, res: Res, url: URL): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    let relative = 'index.html';
    if (!PAGES.has(url.pathname)) {
      try {
        relative = decodeURIComponent(url.pathname).slice(1);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
    }
    const file = path.resolve(publicDir, relative);
    const root = path.resolve(publicDir) + path.sep;
    const type = MIME[path.extname(file)];
    if (!file.startsWith(root) || !type || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    // Vite puts a content hash in these file names, so they can be cached for good.
    const cache = url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Invalid address.' }));
      return;
    }
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Something went wrong on the server.' }));
    }
  });

  let timedChangesTimer: NodeJS.Timeout | undefined;
  let pingTimer: NodeJS.Timeout | undefined;
  let weatherTimer: NodeJS.Timeout | undefined;
  let fundTimer: NodeJS.Timeout | undefined;

  // The reset goes first, so it wins over schedules that went overdue while the server was off.
  function runTimedChanges(): void {
    core.runResetIfDue();
    core.runScheduledIfDue();
    celebrate.tick();
    void pet.tick();
  }

  function start(port: number): Promise<number> {
    runTimedChanges();
    core.save();
    void core.refreshWeather();
    timedChangesTimer = setInterval(runTimedChanges, 30 * 1000);
    weatherTimer = setInterval(() => void core.refreshWeather(), WEATHER_EVERY_MS);
    void fund.refresh();
    fundTimer = setInterval(() => void fund.refresh(), FUND_EVERY_MS);
    // Comment lines keep SSE connections alive through idle proxies.
    pingTimer = setInterval(() => {
      for (const res of sseClients) res.write(': ping\n\n');
    }, 25 * 1000);
    return new Promise((resolve) => {
      server.listen(port, () => resolve((server.address() as { port: number }).port));
    });
  }

  function stop(): Promise<void> {
    clearInterval(timedChangesTimer);
    clearInterval(pingTimer);
    clearInterval(weatherTimer);
    clearInterval(fundTimer);
    for (const res of sseClients) res.end();
    sseClients.clear();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return {
    start,
    stop,
    runResetIfDue: core.runResetIfDue,
    runScheduledIfDue: core.runScheduledIfDue,
    refreshWeather: core.refreshWeather,
    refreshFund: fund.refresh,
  };
}

if (import.meta.main) {
  // A local .env is read when present; Docker passes real environment variables.
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD is not set. Copy .env.example to .env and set a password.');
    process.exit(1);
  }

  const app = createApp({
    dataFile: process.env.DATA_FILE || path.join(ROOT, 'data', 'data.json'),
    adminPassword,
    resetAt: process.env.RESET_AT || '05:00',
  });

  const distIndex = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) console.warn('The pages are not built yet. Run `npm run build`, or use `npm start`.');

  void app.start(Number(process.env.PORT) || 8080).then((port) => {
    console.log(`Team Minimap running on http://localhost:${port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void app.stop().then(() => process.exit(0)));
  }
}
