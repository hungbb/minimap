// Admin page: create usernames, release claims, set up the home page, and back up the data.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import styled from 'styled-components';
import type { Clock, OfficeLocation, PublicSettings, TeamUser } from '../../shared/types.ts';
import { Mochi } from '../components/Mochi.tsx';
import { SheetNav, StatusLine } from '../components/SheetNav.tsx';
import { api, ApiFailure, errorText } from '../lib/api.ts';
import { useMessage, useTeamState } from '../lib/hooks.ts';
import { theme } from '../styles/theme.ts';
import { Button, Chip, Chips, Field, FieldLabel, Input, Panel, PanelHint, Row, Sheet, StackPanel } from '../styles/ui.ts';

const PASSWORD_KEY = 'minimap.admin';

type AdminCall = <T = unknown>(method: string, url: string, body?: unknown) => Promise<T>;
type ShowMessage = (text: string, isError?: boolean) => void;
type Runner = (action: () => Promise<unknown>, done: string, show: ShowMessage) => Promise<void>;

const UserTable = styled.ul`
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const UserRow = styled.li`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-top: ${theme.dashedLine};

  &:first-child { border-top: 0; }
`;

const UserAvatar = styled.div`
  flex: none;
  width: 36px;
  height: 36px;
`;

const UserText = styled.div`
  flex: 1;
  min-width: 120px;
  overflow-wrap: anywhere;

  strong { display: block; font-family: ${theme.displayFont}; line-height: 1.2; }
  span { color: ${theme.inkSoft}; font-size: 14px; }
`;

const ClockFields = styled.div`
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 10px;
`;

const ClockFieldPair = styled.div`
  display: contents;
`;

const WrappingRow = styled(Row)`
  flex-wrap: wrap;
`;

function readSavedPassword(): string {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

function savePassword(value: string): void {
  try {
    if (value) sessionStorage.setItem(PASSWORD_KEY, value);
    else sessionStorage.removeItem(PASSWORD_KEY);
  } catch {}
}

// ---- Log in -------------------------------------------------------------

function LoginPanel({ note, onLogIn }: { note: string; onLogIn: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [message, showMessage] = useMessage();

  useEffect(() => {
    if (note) showMessage(note, true);
  }, [note, showMessage]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await onLogIn(password);
    } catch (err) {
      showMessage(errorText(err), true);
    }
  }

  return (
    <StackPanel as="form" onSubmit={submit}>
      <h2>Admin</h2>
      <Field>
        <FieldLabel>Admin password</FieldLabel>
        <Input
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Row><Button $primary type="submit">Log in</Button></Row>
      <StatusLine message={message} />
    </StackPanel>
  );
}

// ---- Team ---------------------------------------------------------------

function AddUserForm({ call, run }: { call: AdminCall; run: Runner }) {
  const [username, setUsername] = useState('');
  const [message, showMessage] = useMessage();

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = username.trim();
    void run(() => call('POST', '/api/admin/users', { username: name }).then(() => setUsername('')), `Added ${name}`, showMessage);
  }

  return (
    <StackPanel as="form" onSubmit={submit}>
      <h2>Add a username</h2>
      <Row>
        <Input
          maxLength={32}
          placeholder="for example thanh.nguyen"
          aria-label="Username"
          autoComplete="off"
          required
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Button $primary type="submit">Add username</Button>
      </Row>
      <StatusLine message={message} />
    </StackPanel>
  );
}

function TeamPanel({ users, call, run }: { users: TeamUser[]; call: AdminCall; run: Runner }) {
  const [message, showMessage] = useMessage();
  const sorted = [...users].sort((a, b) => a.username.localeCompare(b.username));

  function release(user: TeamUser) {
    if (!confirm(`Release ${user.username}? Its PIN is cleared and it can be claimed again.`)) return;
    void run(() => call('POST', `/api/admin/users/${encodeURIComponent(user.username)}/release`), `Released ${user.username}`, showMessage);
  }

  function remove(user: TeamUser) {
    if (!confirm(`Delete ${user.username}? This removes them from the map.`)) return;
    void run(() => call('DELETE', `/api/admin/users/${encodeURIComponent(user.username)}`), `Deleted ${user.username}`, showMessage);
  }

  return (
    <Panel>
      <h2>Team</h2>
      <UserTable>
        {!sorted.length && <li>No usernames yet. Add your first one above.</li>}
        {sorted.map((user) => (
          <UserRow key={user.username}>
            <UserAvatar><Mochi user={user} /></UserAvatar>
            <UserText>
              <strong>{user.username}</strong>
              <span>{user.claimed ? `Claimed, shown as ${user.nickname}` : 'Available to claim'}</span>
            </UserText>
            {user.claimed && (
              <Button
                $small
                type="button"
                title="Clears the PIN so this username can be claimed again"
                onClick={() => release(user)}
              >
                Release
              </Button>
            )}
            <Button $small type="button" onClick={() => remove(user)}>Delete</Button>
          </UserRow>
        ))}
      </UserTable>
      <StatusLine message={message} />
    </Panel>
  );
}

// ---- Home page settings -------------------------------------------------

function AddressForm({ value, call, run }: { value: string; call: AdminCall; run: Runner }) {
  const [address, setAddress] = useState(value);
  const [message, showMessage] = useMessage();
  useEffect(() => setAddress(value), [value]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const publicUrl = address.trim();
    void run(() => call('PATCH', '/api/admin/settings', { publicUrl }), publicUrl ? 'Address saved' : 'Address cleared', showMessage);
  }

  return (
    <StackPanel as="form" onSubmit={submit}>
      <h2>Team address</h2>
      <PanelHint>The address people use to open the map on this deployment. The QR code on the map points here. Leave it empty to use the address the map is opened on.</PanelHint>
      <Row>
        <Input
          maxLength={300}
          placeholder="for example http://192.168.1.20:8080"
          aria-label="Team address"
          autoComplete="off"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <Button type="submit">Save address</Button>
      </Row>
      <StatusLine message={message} />
    </StackPanel>
  );
}

function ClocksForm({ value, call, run }: { value: Clock[]; call: AdminCall; run: Runner }) {
  const [clocks, setClocks] = useState(value);
  const [message, showMessage] = useMessage();
  const key = JSON.stringify(value);
  useEffect(() => setClocks(JSON.parse(key) as Clock[]), [key]);

  const zones = useMemo(() => ['UTC', ...Intl.supportedValuesOf('timeZone')], []);

  function change(index: number, patch: Partial<Clock>) {
    setClocks((current) => current.map((clock, i) => (i === index ? { ...clock, ...patch } : clock)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const cleaned = clocks.map((clock) => ({ label: clock.label, timeZone: clock.timeZone.trim() }));
    void run(() => call('PATCH', '/api/admin/settings', { clocks: cleaned }), 'Clocks saved', showMessage);
  }

  return (
    <StackPanel as="form" onSubmit={submit}>
      <h2>Clocks</h2>
      <ClockFields>
        {clocks.map((clock, i) => (
          <ClockFieldPair key={i}>
            <Field>
              <FieldLabel>{i === 0 ? 'First' : 'Second'} clock name</FieldLabel>
              <Input
                maxLength={24}
                required
                autoComplete="off"
                value={clock.label}
                onChange={(event) => change(i, { label: event.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel>Time zone</FieldLabel>
              <Input
                list="time-zones"
                required
                autoComplete="off"
                value={clock.timeZone}
                onChange={(event) => change(i, { timeZone: event.target.value })}
              />
            </Field>
          </ClockFieldPair>
        ))}
      </ClockFields>
      <datalist id="time-zones">
        {zones.map((zone) => <option key={zone} value={zone} />)}
      </datalist>
      <Row><Button type="submit">Save clocks</Button></Row>
      <StatusLine message={message} />
    </StackPanel>
  );
}

const Switch = styled.label`
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  cursor: pointer;

  input { width: 18px; height: 18px; margin: 0; accent-color: ${theme.ink}; }
`;

function OfficeForm({ officeName, mapWeather, call, run }: { officeName: string; mapWeather: boolean; call: AdminCall; run: Runner }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OfficeLocation[]>([]);
  const [message, showMessage] = useMessage();
  // Shows the new choice straight away, while it saves.
  const [saving, setSaving] = useState<boolean | null>(null);

  async function chooseMapWeather(on: boolean) {
    setSaving(on);
    await run(() => call('PATCH', '/api/admin/settings', { mapWeather: on }), on ? 'Daylight and weather are on' : 'Daylight and weather are off', showMessage);
    setSaving(null);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const q = encodeURIComponent(query.trim());
    void run(
      async () => {
        const found = await call<{ results: OfficeLocation[] }>('GET', `/api/admin/places?q=${q}`);
        setResults(found.results);
        if (!found.results.length) throw new Error('No places found. Check the spelling, or try a nearby city.');
      },
      'Pick your location below',
      showMessage,
    );
  }

  async function pick(place: OfficeLocation) {
    await run(() => call('PATCH', '/api/admin/settings', { office: place }), `Main office set to ${place.name}`, showMessage);
    setResults([]);
    setQuery('');
  }

  return (
    <StackPanel>
      <h2>Main office location</h2>
      <PanelHint>{officeName ? `The map shows the weather for ${officeName}.` : 'Set this to show the weather on the map.'}</PanelHint>
      <Row as="form" onSubmit={search}>
        <Input
          maxLength={100}
          placeholder="Search for a city"
          aria-label="City"
          autoComplete="off"
          required
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button type="submit">Search</Button>
        {officeName && (
          <Button
            type="button"
            onClick={() => void run(() => call('PATCH', '/api/admin/settings', { office: null }), 'Location removed', showMessage)}
          >
            Remove
          </Button>
        )}
      </Row>
      {results.length > 0 && (
        <Chips>
          {results.map((place) => (
            <Chip key={`${place.latitude},${place.longitude}`} type="button" onClick={() => void pick(place)}>
              {place.name}
            </Chip>
          ))}
        </Chips>
      )}
      <Switch>
        <input
          type="checkbox"
          checked={saving ?? mapWeather}
          disabled={saving !== null}
          onChange={(event) => void chooseMapWeather(event.target.checked)}
        />
        Show the office's daylight and weather on the map
      </Switch>
      <StatusLine message={message} />
    </StackPanel>
  );
}

// ---- Backup -------------------------------------------------------------

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function BackupPanel({ call, run }: { call: AdminCall; run: Runner }) {
  const [message, showMessage] = useMessage();
  const fileInput = useRef<HTMLInputElement>(null);

  function download() {
    void run(
      async () => {
        const data = await call('GET', '/api/admin/data');
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `minimap-backup-${todayStamp()}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      'Backup downloaded',
      showMessage,
    );
  }

  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // Picking the same file again should work too.
    if (!file) return;
    let backup: { users?: unknown };
    try {
      backup = JSON.parse(await file.text());
    } catch {
      showMessage(`${file.name} is not a backup file. Pick a data.json or a downloaded backup.`, true);
      return;
    }
    const count = Array.isArray(backup?.users) ? backup.users.length : 0;
    const question = `Replace everything with ${file.name}? It has ${count} ${count === 1 ? 'user' : 'users'}. All current usernames, PINs and settings will be replaced.`;
    if (!confirm(question)) return;
    void run(() => call('PUT', '/api/admin/data', backup), `Restored ${count} ${count === 1 ? 'user' : 'users'} from ${file.name}`, showMessage);
  }

  return (
    <StackPanel>
      <h2>Backup</h2>
      <PanelHint>
        Save everything to a file, PINs included. Restoring replaces all usernames, PINs and settings with a backup, or with the
        data.json from the office server. Keep backups private: they reveal every PIN.
      </PanelHint>
      <WrappingRow>
        <Button type="button" onClick={download}>Download backup</Button>
        <Button type="button" onClick={() => fileInput.current?.click()}>Restore from a file</Button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => void restore(event)} />
      </WrappingRow>
      <StatusLine message={message} />
    </StackPanel>
  );
}

// ---- Page ---------------------------------------------------------------

function AdminPanels({ call, run }: { call: AdminCall; run: Runner }) {
  const { state } = useTeamState();
  if (!state) return null;
  const settings: PublicSettings = state.settings;
  return (
    <div>
      <AddUserForm call={call} run={run} />
      <TeamPanel users={state.users} call={call} run={run} />
      <AddressForm value={settings.publicUrl} call={call} run={run} />
      <ClocksForm value={settings.clocks} call={call} run={run} />
      <OfficeForm officeName={settings.officeName} mapWeather={settings.mapWeather} call={call} run={run} />
      <BackupPanel call={call} run={run} />
    </div>
  );
}

export function AdminPage() {
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(() => Boolean(readSavedPassword()));
  const [note, setNote] = useState('');

  useEffect(() => {
    document.title = 'Team Admin';
  }, []);

  const logIn = useCallback(async (candidate: string) => {
    await api('GET', '/api/admin/check', undefined, { 'x-admin-password': candidate });
    savePassword(candidate);
    setNote('');
    setPassword(candidate);
  }, []);

  const logOut = useCallback((reason = '') => {
    savePassword('');
    setPassword('');
    setNote(reason);
  }, []);

  useEffect(() => {
    const saved = readSavedPassword();
    if (saved) logIn(saved).catch(() => logOut()).finally(() => setChecking(false));
  }, [logIn, logOut]);

  const call = useCallback<AdminCall>(
    (method, url, body) => api(method, url, body, { 'x-admin-password': password }),
    [password],
  );

  const run = useCallback<Runner>(
    async (action, done, show) => {
      try {
        await action();
        show(done);
      } catch (err) {
        if (err instanceof ApiFailure && err.status === 401) logOut('Enter the admin password again.');
        else show(errorText(err), true);
      }
    },
    [logOut],
  );

  return (
    <Sheet>
      <SheetNav links={[{ href: '/', label: 'Map' }, { href: '/me', label: 'My status' }]} />
      {password && <AdminPanels call={call} run={run} />}
      {!password && !checking && <LoginPanel note={note} onLogIn={logIn} />}
    </Sheet>
  );
}
