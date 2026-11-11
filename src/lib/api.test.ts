import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { TeamState } from '../../shared/types.ts';
import { subscribe } from './api.ts';

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  listeners = new Map<string, (event: { data: string }) => void>();

  addEventListener(name: string, listener: (event: { data: string }) => void) {
    this.listeners.set(name, listener);
  }

  constructor() {
    FakeEventSource.opened.push(this);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  /** What a browser does on a dropped connection: it retries by itself. */
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.();
  }

  /** What a browser does on an HTTP error, such as a 502: it gives up for good. */
  refuse() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

const opened = () => FakeEventSource.opened;
const latest = () => opened().at(-1)!;

function start() {
  const onState = mock.fn<(state: TeamState) => void>();
  const onConnection = mock.fn<(online: boolean) => void>();
  const onVotes = mock.fn<(votes: unknown[]) => void>();
  const stop = subscribe({ onState, onConnection, onVotes });
  const lastOnline = () => onConnection.mock.calls.at(-1)?.arguments[0];
  return { onState, onVotes, lastOnline, stop };
}

beforeEach(() => {
  FakeEventSource.opened = [];
  Object.assign(globalThis, { EventSource: FakeEventSource });
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  mock.timers.reset();
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

test('passes on each new state', () => {
  const { onState, lastOnline } = start();
  latest().onmessage?.({ data: '{"users":[]}' });
  assert.deepEqual(onState.mock.calls[0]?.arguments[0], { users: [] });
  assert.equal(lastOnline(), true);
});

test('passes on votes from their own event, apart from the state', () => {
  const { onState, onVotes } = start();
  latest().listeners.get('vote')?.({ data: '[{"id":"v1"}]' });
  assert.deepEqual(onVotes.mock.calls[0]?.arguments[0], [{ id: 'v1' }]);
  assert.equal(onState.mock.calls.length, 0);
});

test('leaves a dropped connection to the browser', () => {
  const { lastOnline } = start();
  latest().open();
  latest().drop();
  assert.equal(lastOnline(), false);
  mock.timers.tick(60_000);
  assert.equal(opened().length, 1);
});

test('opens a new connection after the browser gives up on an HTTP error', () => {
  const { lastOnline } = start();
  latest().refuse();
  assert.equal(lastOnline(), false);
  assert.equal(opened().length, 1);
  mock.timers.tick(1000);
  assert.equal(opened().length, 2);
  latest().open();
  assert.equal(lastOnline(), true);
});

test('waits longer after each failure, up to 30 seconds', () => {
  start();
  for (const wait of [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    const before = opened().length;
    latest().refuse();
    mock.timers.tick(wait - 1);
    assert.equal(opened().length, before, `still waiting at ${wait - 1} ms`);
    mock.timers.tick(1);
    assert.equal(opened().length, before + 1, `reconnected at ${wait} ms`);
  }
});

test('waits only a moment again once a connection has worked', () => {
  start();
  latest().refuse();
  mock.timers.tick(1000);
  latest().refuse();
  mock.timers.tick(2000);
  latest().open();
  latest().refuse();
  const before = opened().length;
  mock.timers.tick(1000);
  assert.equal(opened().length, before + 1);
});

test('stopping closes the newest connection', () => {
  const { stop } = start();
  latest().refuse();
  mock.timers.tick(1000);
  const second = latest();
  second.open();
  stop();
  assert.equal(second.readyState, FakeEventSource.CLOSED);
});

test('stopping cancels a planned reconnect', () => {
  const { stop } = start();
  latest().refuse();
  stop();
  mock.timers.tick(60_000);
  assert.equal(opened().length, 1);
});
