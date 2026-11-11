// The admin's "Office cat" panel: give the cat its name. A team vote on /vote is a good way
// to choose one; the admin then saves the winner here.
import { useEffect, useState, type FormEvent } from 'react';
import { MAX_NAME, stageText, type PetView } from '../../shared/pet.ts';
import { api } from '../lib/api.ts';
import { useMessage } from '../lib/hooks.ts';
import { Button, Input, PanelHint, Row, StackPanel } from '../styles/ui.ts';
import { StatusLine } from './SheetNav.tsx';

type AdminCall = <T = unknown>(method: string, url: string, body?: unknown) => Promise<T>;
type ShowMessage = (text: string, isError?: boolean) => void;
type Runner = (action: () => Promise<unknown>, done: string, show: ShowMessage) => Promise<void>;

export function PetAdminPanel({ call, run }: { call: AdminCall; run: Runner }) {
  const [pet, setPet] = useState<PetView | null>(null);
  const [name, setName] = useState('');
  const [message, showMessage] = useMessage(2500);

  useEffect(() => {
    void run(() => api<PetView>('GET', '/api/pet').then((view) => (setPet(view), setName(view.name))), '', showMessage);
  }, [run, showMessage]);

  function save(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    void run(() => call<PetView>('PATCH', '/api/pet/admin', { name: next }).then((view) => (setPet(view), setName(view.name))), 'Name saved', showMessage);
  }

  return (
    <StackPanel as="form" onSubmit={save}>
      <h2>Office cat</h2>
      <PanelHint style={{ margin: 0 }}>
        The cat lives in the first office on the map. Each person can feed it once a day; three feeds make a good day, and good days
        help it grow from kitten to cat to big cat. To let the team choose a name, start a vote on the <a href="/vote">Team votes</a>{' '}
        page, then save the winner here.
      </PanelHint>
      {pet && <PanelHint style={{ margin: 0 }}>{stageText(pet)} · {pet.goodDays} good days so far.</PanelHint>}
      <Row>
        <Input maxLength={MAX_NAME} required aria-label="Cat’s name" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit">Save name</Button>
      </Row>
      <StatusLine message={message} />
    </StackPanel>
  );
}
