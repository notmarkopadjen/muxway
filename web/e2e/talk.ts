import { expect, type APIRequestContext } from '@playwright/test';
import { control, HOST, TOKEN } from './fixtures';

// Helpers for the talk and mail specs in the agents environment.

const auth = { Authorization: `Bearer ${TOKEN}` };

// The panes a test made, closed after it: a window holds eight at most.
const made: string[] = [];

export async function closeMade(request: APIRequestContext) {
  for (const id of made.splice(0)) await control(request, '/kill-pane', { target: id });
}

// One more writable pane in the first window, with the mark the source carries.
export async function otherPane(
  request: APIRequestContext,
): Promise<{ address: string; id: string }> {
  // One split every two seconds per token: a second try after a moment.
  let r = await request.post(`/v1/windows/${HOST}/work/0/panes`, {
    headers: auth,
    data: { direction: 'h' },
  });
  if (r.status() === 429) {
    await new Promise((f) => setTimeout(f, 2100));
    r = await request.post(`/v1/windows/${HOST}/work/0/panes`, {
      headers: auth,
      data: { direction: 'h' },
    });
  }
  expect(r.status()).toBe(201);
  const { pane } = (await r.json()) as { pane: { address: string; pane_id: string } };
  made.push(pane.pane_id);
  // tmux titles a new pane with the machine's name: the fixtures' title instead.
  await control(request, '/rename', { what: 'title', target: pane.pane_id, name: 'test-pane' });
  return { address: pane.address, id: pane.pane_id };
}

// A write from one pane to another, as muxway client would send it.
export async function say(
  request: APIRequestContext,
  to: string,
  fromPane: string,
  body: { text: string } | { key: string },
) {
  const r = await request.post(`/v1/panes/${to}/input`, {
    headers: auth,
    data: { ...body, from: { host: HOST, pane_id: fromPane } },
  });
  expect(r.status()).toBe(204);
}

// A pane's address now: a split at the first pane shifts every later index.
export async function addressOf(request: APIRequestContext, id: string): Promise<string> {
  const r = await request.get('/v1/panes', { headers: auth });
  const { panes } = (await r.json()) as { panes: { address: string; pane_id: string }[] };
  const p = panes.find((q) => q.pane_id === id);
  expect(p, `pane ${id} listed`).toBeTruthy();
  return p!.address;
}
