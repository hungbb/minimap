// Team Minimap on Cloudflare Workers.
//
// Cloudflare serves the built pages in dist/ by itself. Everything else comes here:
// /me, /admin and /vote get the same page as /, and /api/ goes to one Durable Object that holds
// the whole team. It runs the same API as the Node.js server (server/core.ts and each
// feature's folder), keeps the data in its own storage (one key for the team and one for
// each feature), and sends live updates to every open map.

import { DurableObject } from 'cloudflare:workers';
import { createBasketball, takeOldBasketball, type Basketball } from '../server/basketball/core.ts';
import { createVote, type Votes } from '../server/vote/core.ts';
import { createFund, type Fund } from '../server/fund/core.ts';
import { createPet, type Pet } from '../server/pet/core.ts';
import { createCelebrate, type Celebrate } from '../server/celebrate/core.ts';
import { ApiError, createCore, MAX_BODY, WEATHER_EVERY_MS, type ApiRequest, type Core, type JsonBody } from '../server/core.ts';

interface Env {
  ASSETS: Fetcher;
  MINIMAP: DurableObjectNamespace<Minimap>;
  ADMIN_PASSWORD?: string;
  RESET_AT?: string;
  TZ?: string;
}

// React decides which page to show, so these serve the same file as /.
const PAGES = new Set(['/me', '/account', '/admin', '/vote']);
const PING_MS = 25 * 1000;
const encoder = new TextEncoder();

// Votes have their own event name, so maps tell them apart from the team's state.
function voteEvent(views: unknown): string {
  return `event: vote\ndata: ${JSON.stringify(views)}\n\n`;
}

// The fund's looks and titles have their own event name too.
function fundEvent(people: unknown): string {
  return `event: fund
data: ${JSON.stringify(people)}

`;
}

// The office cat too.
function petEvent(view: unknown): string {
  return `event: pet
data: ${JSON.stringify(view)}

`;
}

// Birthdays and anniversaries too.
function celebrateEvent(view: unknown): string {
  return `event: celebrate
data: ${JSON.stringify(view)}

`;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!env.ADMIN_PASSWORD) {
        return json(500, { error: 'ADMIN_PASSWORD is not set. Run `npx wrangler secret put ADMIN_PASSWORD`.' });
      }
      return env.MINIMAP.get(env.MINIMAP.idFromName('team')).fetch(request);
    }
    if (PAGES.has(url.pathname)) return env.ASSETS.fetch(new Request(new URL('/', url), request));
    // Files in dist/ never reach the Worker, so anything else does not exist.
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
} satisfies ExportedHandler<Env>;

async function readJson(request: Request, maxBytes = MAX_BODY): Promise<JsonBody> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new ApiError(413, 'Request too large.');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new ApiError(413, 'Request too large.');
  try {
    const body: unknown = bytes.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as JsonBody;
  } catch {
    throw new ApiError(400, 'Invalid JSON.');
  }
}

export class Minimap extends DurableObject<Env> {
  private core!: Core;
  private basketball!: Basketball;
  private votes!: Votes;
  private fund!: Fund;
  private pet!: Pet;
  private celebrate!: Celebrate;
  private clients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private ticker: ReturnType<typeof setInterval> | undefined;
  private weatherAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<string>('data');
      const teamSaved = saved ? JSON.parse(saved) : null;
      const oldBasketball = takeOldBasketball(teamSaved);
      this.core = createCore({
        saved: teamSaved,
        // Not awaited: Cloudflare holds back the reply until the write is safely stored.
        save: (data) => void ctx.storage.put('data', JSON.stringify(data)),
        onChange: (state) => {
          this.sendAll(`data: ${JSON.stringify(state)}\n\n`);
          this.syncAlarm();
        },
        adminPassword: env.ADMIN_PASSWORD ?? '',
        resetAt: env.RESET_AT || '05:00',
        timeZone: env.TZ || 'UTC',
      });

      const basketballSaved = await ctx.storage.get<string>('basketball');
      this.basketball = createBasketball({
        saved: basketballSaved ? JSON.parse(basketballSaved) : oldBasketball,
        // Awaited by the game, so it only says a score is stored once it is.
        save: (data) => ctx.storage.put('basketball', JSON.stringify(data)),
        team: this.core.team,
      });
      this.core.attach(this.basketball.feature);
      // Scores from the team's value get their own key before the team's is written without them.
      if (!basketballSaved && oldBasketball) await this.basketball.save();

      const voteSaved = await ctx.storage.get<string>('vote');
      this.votes = createVote({
        saved: voteSaved ? JSON.parse(voteSaved) : null,
        // Awaited, so a reply only says a vote or ballot is stored once it is.
        save: (data) => ctx.storage.put('vote', JSON.stringify(data)),
        team: this.core.team,
        onChange: (views) => this.sendAll(voteEvent(views)),
      });
      this.core.attach(this.votes.feature);

      const fundSaved = await ctx.storage.get<string>('fund');
      this.fund = createFund({
        saved: fundSaved ? JSON.parse(fundSaved) : null,
        // Awaited, so a reply only says a change is stored once it is.
        save: (data) => ctx.storage.put('fund', JSON.stringify(data)),
        team: this.core.team,
        onChange: (people) => this.sendAll(fundEvent(people)),
        timeZone: env.TZ || 'UTC',
      });
      this.core.attach(this.fund.feature);

      const petSaved = await ctx.storage.get<string>('pet');
      this.pet = createPet({
        saved: petSaved ? JSON.parse(petSaved) : null,
        // Awaited, so a reply only says a feed is stored once it is.
        save: (data) => ctx.storage.put('pet', JSON.stringify(data)),
        team: this.core.team,
        onChange: (view) => this.sendAll(petEvent(view)),
        timeZone: env.TZ || 'UTC',
      });
      this.core.attach(this.pet.feature);

      const celebrateSaved = await ctx.storage.get<string>('celebrate');
      this.celebrate = createCelebrate({
        saved: celebrateSaved ? JSON.parse(celebrateSaved) : null,
        // Awaited, so a reply only says a date or wish is stored once it is.
        save: (data) => ctx.storage.put('celebrate', JSON.stringify(data)),
        team: this.core.team,
        onChange: (view) => this.sendAll(celebrateEvent(view)),
        timeZone: env.TZ || 'UTC',
      });
      this.core.attach(this.celebrate.feature);

      this.runTimedChanges();
      this.core.save();
      this.syncAlarm();
    });
  }

  // Wakes the object for the next scheduled change, even with no map open.
  override async alarm(): Promise<void> {
    this.runTimedChanges();
    this.syncAlarm();
  }

  // The reset goes first, so it wins over schedules that are overdue. A new day for
  // celebrations needs no alarm: nobody sees it until a map is open, and open maps tick. The
  // cat's new day needs none either: what it shows is worked out from the date, and this saves
  // it when someone looks.
  private runTimedChanges(): void {
    this.core.runResetIfDue();
    this.core.runScheduledIfDue();
    this.celebrate.tick();
    this.ctx.waitUntil(this.pet.tick());
  }

  private syncAlarm(): void {
    const next = this.core.nextScheduledAt();
    void (next ? this.ctx.storage.setAlarm(new Date(next)) : this.ctx.storage.deleteAlarm());
  }

  override async fetch(request: Request): Promise<Response> {
    // Only alarms run while nobody is looking, so catch up on the reset, weather and fund first.
    this.runTimedChanges();
    this.refreshWeatherIfDue();
    this.refreshFundIfDue();

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/events') return this.openEvents();

    const req: ApiRequest = {
      method: request.method,
      url,
      header: (name) => request.headers.get(name) ?? undefined,
      readJson: (maxBytes) => readJson(request, maxBytes),
    };
    const { status, body, headers } =
      (await this.basketball.handle(req)) ?? (await this.votes.handle(req)) ?? (await this.fund.handle(req)) ?? (await this.celebrate.handle(req))
      ?? (await this.pet.handle(req)) ?? (await this.core.handle(req));
    return new Response(JSON.stringify(body), { status, headers });
  }

  private refreshWeatherIfDue(): void {
    if (Date.now() - this.weatherAt < WEATHER_EVERY_MS) return;
    this.weatherAt = Date.now();
    this.ctx.waitUntil(this.core.refreshWeather());
  }

  // The sheet is read again when someone looks and the last read is an hour old, so it needs no alarm.
  private refreshFundIfDue(): void {
    this.ctx.waitUntil(this.fund.refreshIfDue());
  }

  private openEvents(): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.clients.add(writer);
    this.send(writer, `data: ${JSON.stringify(this.core.publicState())}\n\n`);
    this.send(writer, voteEvent(this.votes.views()));
    this.send(writer, fundEvent(this.fund.people()));
    this.send(writer, celebrateEvent(this.celebrate.view()));
    this.send(writer, petEvent(this.pet.view()));
    // While a map is open, keep the connection alive and the reset and weather on time.
    this.ticker ??= setInterval(() => {
      this.sendAll(': ping\n\n');
      this.runTimedChanges();
      this.refreshWeatherIfDue();
      this.refreshFundIfDue();
    }, PING_MS);
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
    });
  }

  private send(writer: WritableStreamDefaultWriter<Uint8Array>, text: string): void {
    // A write fails once the browser has gone away.
    writer.write(encoder.encode(text)).catch(() => this.drop(writer));
  }

  private sendAll(text: string): void {
    for (const writer of this.clients) this.send(writer, text);
  }

  private drop(writer: WritableStreamDefaultWriter<Uint8Array>): void {
    this.clients.delete(writer);
    if (this.clients.size === 0 && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }
}
