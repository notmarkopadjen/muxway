import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { inboxOrder } from '../term/order';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, target } from './client';
import { joinAddress, originOfHub, splitAddress, useHubs, type Hub } from '../hubs';
import { noteOwn } from '../term/lens';
import { Settle } from './settle';
import { extOf, isTextName } from '../term/types';
import type {
  AuthMethods,
  Changes,
  Diff,
  Listing,
  Host,
  Mail,
  Me,
  Mouse,
  Pane,
  PaneContent,
  Resize,
  Talk,
  Tree,
  WindowContent,
} from './types';

// Another hub of the hubs box keys its lists by its name; this page's
// own hub by nothing, so the bare keys stand.
export const keys = {
  auth: ['auth'] as const,
  me: ['me'] as const,
  meOf: (hub?: string) => (hub ? (['me', hub] as const) : (['me'] as const)),
  hosts: ['hosts'] as const,
  hostsOf: (hub?: string) => (hub ? (['hosts', hub] as const) : (['hosts'] as const)),
  tree: (host: string, hub?: string) =>
    hub ? (['tree', host, hub] as const) : (['tree', host] as const),
  pane: (address: string) => ['pane', address] as const,
  window: (host: string, session: string, window: string) =>
    ['window', host, session, window] as const,
  panes: ['panes'] as const,
  panesOf: (hub?: string) => (hub ? (['panes', hub] as const) : (['panes'] as const)),
  inboxOf: (hub?: string) => (hub ? (['inbox', hub] as const) : (['inbox'] as const)),
  talkOf: (hub?: string) => (hub ? (['talk', hub] as const) : (['talk'] as const)),
  mailbox: (address: string) => ['mailbox', address] as const,
  transcriber: ['transcriber'] as const,
  admin: ['admin'] as const,
  desk: ['desk'] as const,
  files: (address: string) => ['files', address] as const,
  changes: (address: string) => ['changes', address] as const,
  listing: (address: string, cwd: string) => ['listing', address, cwd] as const,
  shares: (hub?: string) => (hub ? (['shares', hub] as const) : (['shares'] as const)),
};

function useVisible(): boolean {
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

export function useAuthMethods() {
  return useQuery({
    queryKey: keys.auth,
    queryFn: () => api<AuthMethods>('/v1/auth'),
    staleTime: 60_000,
  });
}

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api<Me>('/v1/me'),
    retry: false,
    staleTime: 30_000,
  });
}

// Every hub of the hubs box is asked, this page's own first with the
// session it has, the others with the browser's cookie for each; what a
// peer answers is marked with its name. A peer's refusal is not retried.
export interface HubList<T> {
  hub: Hub;
  own: boolean;
  data?: T;
  error?: unknown;
  pending: boolean;
}

const peerRetry = (count: number, err: unknown) => !(err instanceof ApiError) && count < 2;

function useHubLists<T>(
  key: (hub?: string) => readonly unknown[],
  fetch: (hub: Hub, own: boolean) => Promise<T>,
  opts: { enabled?: boolean; refetchInterval?: number; staleTime?: number } = {},
): HubList<T>[] {
  const hubs = useHubs();
  const combine = useCallback(
    (rs: { data: T | undefined; error: unknown; isPending: boolean }[]) =>
      rs.map((r, i) => ({
        hub: hubs[i],
        own: i === 0,
        data: r.data,
        error: r.error ?? undefined,
        pending: r.isPending,
      })),
    [hubs],
  );
  return useQueries({
    queries: hubs.map((h, i) => ({
      queryKey: key(i === 0 ? undefined : h.name),
      queryFn: () => fetch(h, i === 0),
      retry: i === 0 ? undefined : peerRetry,
      ...opts,
    })),
    combine,
  });
}

export function useHubMe(): HubList<Me>[] {
  return useHubLists(keys.meOf, (h, own) => api<Me>('/v1/me', own ? {} : { hub: h.url }), {
    staleTime: 30_000,
  });
}

export function useHubHosts(): HubList<Host[]>[] {
  return useHubLists(
    keys.hostsOf,
    (h, own) =>
      api<unknown>('/v1/hosts', own ? {} : { hub: h.url }).then((v) =>
        unwrapHosts(v).map((x) => (own ? x : { ...x, hub: h.name })),
      ),
    { refetchInterval: 5_000 },
  );
}

// Every hub's hosts in one list, this page's own first.
export function useHosts(): { data: Host[] | undefined; isPending: boolean } {
  const lists = useHubHosts();
  return useMemo(
    () => ({
      data: lists[0]?.data === undefined ? undefined : lists.flatMap((l) => l.data ?? []),
      isPending: !!lists[0]?.pending,
    }),
    [lists],
  );
}

// The host a pane is on, by the hub it belongs to and its name.
export function hostOf(hosts: Host[] | undefined, address: string): Host | undefined {
  const { hub, address: bare } = splitAddress(address);
  const name = bare.split('/')[0];
  return hosts?.find((h) => h.name === name && h.hub === hub);
}

function unwrapHosts(v: unknown): Host[] {
  return (v as { hosts: Host[] | null }).hosts ?? [];
}

export function useTree(host: string, online: boolean, hub?: string) {
  return useQuery({
    queryKey: keys.tree(host, hub),
    queryFn: () => api<Tree>(`/v1/hosts/${host}/tree`, hub ? { hub: originOfHub(hub) } : {}),
    enabled: online,
    refetchInterval: 5_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
  });
}

// A pane the hub answered, named as this page names it: with the hub's
// name when it is another hub's.
function claim(address: string, p: Pane): Pane {
  const { hub } = splitAddress(address);
  return hub ? { ...p, address, hub } : p;
}

function readPane(address: string, conditional: boolean): Promise<PaneContent> {
  const t = target(address);
  return api<PaneContent>(`/v1/panes/${t.address}?ansi=1&lines=400`, {
    conditional,
    hub: t.hub,
  }).then((r) => ({ ...r, pane: claim(address, r.pane) }));
}

export function usePane(address: string, every = 1_000) {
  const visible = useVisible();
  return useQuery({
    queryKey: keys.pane(address),
    queryFn: () => readPane(address, true),
    refetchInterval: visible ? every : 5_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
    placeholderData: (prev) => prev,
  });
}

// The pane as the view showing it has it; fetches nothing itself.
export function usePaneCached(address: string) {
  return useQuery({
    queryKey: keys.pane(address),
    queryFn: () => readPane(address, false),
    enabled: false,
  });
}

// Sends to one pane go one after another, so what was pressed first
// arrives first; a refused one does not hold the next.
const queues = new Map<string, Promise<unknown>>();
function inOrder<T>(address: string, go: () => Promise<T>): Promise<T> {
  const prev = queues.get(address) ?? Promise.resolve();
  const next = prev.then(go, go);
  queues.set(address, next);
  return next;
}

// The pane an address names, as the open view or some list has it;
// fetches nothing.
export function knownPane(qc: QueryClient, address: string): Pane | undefined {
  const open = qc.getQueryData<PaneContent>(keys.pane(address))?.pane;
  if (open) return open;
  const { hub, address: bare } = splitAddress(address);
  const all = qc.getQueryData<Pane[]>(keys.panesOf(hub))?.find((p) => p.address === address);
  if (all) return all;
  const host = bare.split('/')[0];
  for (const s of qc.getQueryData<Tree>(keys.tree(host, hub))?.sessions ?? [])
    for (const w of s.windows)
      for (const p of w.panes) if (p.address === bare) return hub ? { ...p, address, hub } : p;
  return undefined;
}

// What input reads back settles once per burst, not once per key:
// sixteen keys at once are sixteen requests and a few reads, under the
// hub's burst of forty.
const settled = new Settle(250);

// The input asks for the screen with its answer, so a key's echo costs
// one round trip: the frame goes into the pane query and into the window
// query that holds the pane, and the burst's read is trailing only. A hub
// that answers 204 (an older one, or a token that may not read the pane)
// gets the leading read as well.
export function useInput(address: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string } | { key: string; count?: number } | { mouse: Mouse }) => {
      noteOwn(address);
      return inOrder(address, () => sendInput(address, body, true));
    },
    onSuccess: (frame) => {
      noteOwn(address);
      // Text and keys clear the pane's attention: the lists are asked
      // again only when the key changed something in them.
      const lists = !!knownPane(qc, address)?.attention;
      if (frame) takeFrame(qc, address, frame);
      const refresh = () => {
        qc.invalidateQueries({ queryKey: keys.pane(address) });
        const { hub, address: bare } = splitAddress(address);
        if (!hub) qc.invalidateQueries({ queryKey: ['window', ...bare.split('/').slice(0, 2)] });
        if (!lists) return;
        qc.invalidateQueries({ queryKey: keys.panesOf(hub) });
        qc.invalidateQueries({ queryKey: keys.tree(bare.split('/')[0], hub) });
      };
      if (frame) settled.later(address, refresh);
      else settled.run(address, refresh);
    },
  });
}

// A frame an input brought back: the pane query's data, and the pane's
// entry in any window query of this hub that holds it (by id, since an
// address is a position).
export function takeFrame(qc: QueryClient, address: string, frame: PaneContent) {
  // A poll in flight was asked before the keys: answered after the frame
  // is in, it would put the old screen back until the trailing read.
  void qc.cancelQueries({ queryKey: keys.pane(address) });
  qc.setQueryData<PaneContent>(keys.pane(address), { ...frame, pane: claim(address, frame.pane) });
  const { hub, address: bare } = splitAddress(address);
  if (hub) return;
  const id = frame.pane.pane_id;
  const windows = ['window', ...bare.split('/').slice(0, 2)];
  void qc.cancelQueries({ queryKey: windows });
  qc.setQueriesData<WindowContent>({ queryKey: windows }, (w) =>
    w && w.panes.some((p) => p.pane.pane_id === id)
      ? {
          ...w,
          panes: w.panes.map((p) =>
            p.pane.pane_id === id
              ? { ...p, pane: frame.pane, content: frame.content, trimmed: frame.trimmed }
              : p,
          ),
        }
      : w,
  );
}

export function useWindow(host: string, session: string, window: string) {
  const visible = useVisible();
  return useQuery({
    queryKey: keys.window(host, session, window),
    queryFn: () =>
      api<WindowContent>(`/v1/windows/${host}/${session}/${window}?ansi=1&lines=300`, {
        conditional: true,
      }),
    refetchInterval: visible ? 1_000 : 5_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
    placeholderData: (prev) => prev,
  });
}

// A click, a key or text to the pane, on its own hub.
// An answer to a question a pane asked with fixed choices: a write, and
// the pane's attention goes with it.
// A mail for a pane's process: held on its host, never typed.
export function useMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ address, text }: { address: string; text: string }) => {
      const t = target(address);
      return api<{ mail: { id: number; at: number } }>(`/v1/panes/${t.address}/mail`, {
        method: 'POST',
        body: JSON.stringify({ text }),
        hub: t.hub,
      });
    },
    onSuccess: (_v, { address }) => {
      const { hub } = splitAddress(address);
      qc.invalidateQueries({ queryKey: keys.pane(address) });
      qc.invalidateQueries({ queryKey: keys.panesOf(hub) });
      qc.invalidateQueries({ queryKey: keys.talkOf(hub) });
      qc.invalidateQueries({ queryKey: ['mailbox'] });
    },
  });
}

// The mail a pane holds, read and unread, for a reader of the pane: the
// mail window asks every five seconds while it is open. Origins come
// back at this page's addresses, hub and all.
export function mailboxOptions(address: string) {
  const { hub } = splitAddress(address);
  return {
    queryKey: keys.mailbox(address),
    queryFn: () => {
      const t = target(address);
      return api<{ mail: Mail[] | null }>(`/v1/panes/${t.address}/mail`, { hub: t.hub }).then((v) =>
        (v.mail ?? []).map((m) =>
          m.from && hub
            ? { ...m, from: { ...m.from, address: joinAddress(hub, m.from.address) } }
            : m,
        ),
      );
    },
    refetchInterval: 5_000,
    retry: (count: number, err: unknown) => !(err instanceof ApiError) && count < 2,
  };
}

export function useMailbox(address: string) {
  return useQuery({
    ...mailboxOptions(address),
    placeholderData: (prev: Mail[] | undefined) => prev,
  });
}

// The mailboxes of several panes at once, by address.
export function useMailboxes(addresses: string[]): Record<string, Mail[]> {
  const data = useQueries({
    queries: addresses.map((a) => mailboxOptions(a)),
    combine: (rs) => rs.map((r) => r.data),
  });
  return useMemo(() => {
    const out: Record<string, Mail[]> = {};
    addresses.forEach((a, i) => {
      if (data[i]) out[a] = data[i];
    });
    return out;
  }, [addresses, data]);
}

// The owner's name for a pane: its alias, set on the host for a writer.
export function useRename() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ address, alias }: { address: string; alias: string }) => {
      const t = target(address);
      return api<{ pane: Pane }>(`/v1/panes/${t.address}/alias`, {
        method: 'POST',
        body: JSON.stringify({ alias }),
        hub: t.hub,
      });
    },
    onSuccess: (_v, { address }) => {
      const { hub, address: bare } = splitAddress(address);
      qc.invalidateQueries({ queryKey: keys.pane(address) });
      qc.invalidateQueries({ queryKey: keys.panesOf(hub) });
      qc.invalidateQueries({ queryKey: keys.tree(bare.split('/')[0], hub) });
    },
  });
}

export function useAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ address, choice }: { address: string; choice: string }) => {
      const t = target(address);
      return api<void>(`/v1/panes/${t.address}/answer`, {
        method: 'POST',
        body: JSON.stringify({ choice }),
        hub: t.hub,
      });
    },
    onSuccess: (_v, { address }) => {
      qc.invalidateQueries({ queryKey: keys.pane(address) });
      const { hub, address: bare } = splitAddress(address);
      qc.invalidateQueries({ queryKey: keys.panesOf(hub) });
      qc.invalidateQueries({ queryKey: keys.inboxOf(hub) });
      qc.invalidateQueries({ queryKey: keys.tree(bare.split('/')[0], hub) });
    },
  });
}

// Later: the owner parks a pane, or wakes it; the host keeps the mark
// beside the pane's attention, so every client sees it.
export function useLater() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ address, later }: { address: string; later: boolean }) => {
      const t = target(address);
      return api<void>(`/v1/panes/${t.address}/later`, {
        method: 'POST',
        body: JSON.stringify({ later }),
        hub: t.hub,
      });
    },
    onSuccess: (_v, { address }) => {
      qc.invalidateQueries({ queryKey: keys.pane(address) });
      const { hub, address: bare } = splitAddress(address);
      qc.invalidateQueries({ queryKey: keys.panesOf(hub) });
      qc.invalidateQueries({ queryKey: keys.inboxOf(hub) });
      qc.invalidateQueries({ queryKey: keys.tree(bare.split('/')[0], hub) });
    },
  });
}

// With read, the answer is the pane's screen once the keys landed, in
// the pane query's own shape, or nothing from a hub that answers 204.
export function sendInput(
  address: string,
  body: { text: string } | { key: string; count?: number } | { mouse: Mouse },
  read = false,
): Promise<PaneContent | undefined> {
  const t = target(address);
  return api<PaneContent | undefined>(
    `/v1/panes/${t.address}/input${read ? '?read=1&lines=400&ansi=1' : ''}`,
    { method: 'POST', body: JSON.stringify(body), hub: t.hub },
  ).then((r) => (r ? { ...r, pane: claim(address, r.pane) } : undefined));
}

// Every pane the principal may read on every hub, flat, this page's own
// hub's first, for the selector, the strip and the add menu.
export function useAllPanes(enabled: boolean) {
  const lists = useHubLists(
    keys.panesOf,
    (h, own) =>
      api<{ panes: Pane[] | null }>('/v1/panes', own ? {} : { hub: h.url }).then((v) =>
        (v.panes ?? []).map((p) =>
          own ? p : { ...p, address: joinAddress(h.name, p.address), hub: h.name },
        ),
      ),
    { enabled, refetchInterval: 5_000 },
  );
  return useMemo(
    () => ({
      data: lists[0]?.data === undefined ? undefined : lists.flatMap((l) => l.data ?? []),
    }),
    [lists],
  );
}

// The inbox of every hub in the box: the panes that wait for their owner,
// oldest first. Its own query, polled slowly and never invalidated by
// input, so the header's count costs a request every few seconds and
// nothing per key.
export function useInbox(enabled: boolean) {
  const lists = useHubLists(
    keys.inboxOf,
    (h, own) =>
      api<{ inbox: Pane[] | null }>('/v1/inbox', own ? {} : { hub: h.url }).then((v) =>
        (v.inbox ?? []).map((p) =>
          own ? p : { ...p, address: joinAddress(h.name, p.address), hub: h.name },
        ),
      ),
    { enabled, refetchInterval: 5_000 },
  );
  return useMemo(
    () => ({
      data:
        lists[0]?.data === undefined
          ? undefined
          : lists.flatMap((l) => l.data ?? []).sort(inboxOrder),
    }),
    [lists],
  );
}

// The talk feed of every hub: what panes said to panes, the last hundred
// entries, oldest first. A peer's addresses carry its name.
export function useTalk(enabled: boolean) {
  const lists = useHubLists(
    keys.talkOf,
    (h, own) =>
      api<{ talk: Talk[] | null }>('/v1/talk?limit=100', own ? {} : { hub: h.url }).then((v) =>
        (v.talk ?? []).map((e) =>
          own
            ? e
            : {
                ...e,
                hub: h.name,
                from: e.from && { ...e.from, address: joinAddress(h.name, e.from.address) },
                to: { ...e.to, address: joinAddress(h.name, e.to.address) },
              },
        ),
      ),
    { enabled, refetchInterval: 5_000 },
  );
  return useMemo(
    () => ({
      data:
        lists[0]?.data === undefined
          ? undefined
          : lists.flatMap((l) => l.data ?? []).sort((a, b) => a.at - b.at || a.seq - b.seq),
    }),
    [lists],
  );
}

// Whether the pane's host takes files for it: 204 yes, anything else no.
export function useFiles(address: string | undefined, writable: boolean) {
  return useQuery({
    queryKey: keys.files(address ?? ''),
    queryFn: () => {
      const t = target(address!);
      return api<void>(`/v1/panes/${t.address}/files`, { hub: t.hub }).then(
        () => true,
        () => false,
      );
    },
    enabled: !!address && writable,
    staleTime: 60_000,
  });
}

// One file of the host's inbox back, by the name the agent gave it.
export function readFile(address: string, name: string): Promise<Blob> {
  const t = target(address);
  return fetchBlob(`/v1/panes/${t.address}/files/${name}`, t.hub);
}

// A file a pane printed the path of, from under the host's preview roots;
// found names the file when the host found it elsewhere in the pane's
// repository (an ancestor directory, another worktree), else is empty.
export async function previewFile(
  address: string,
  path: string,
): Promise<{ blob: Blob; found: string }> {
  const t = target(address);
  const res = await fetchRaw(
    `/v1/panes/${t.address}/preview?path=${encodeURIComponent(path)}`,
    t.hub,
  );
  return { blob: await res.blob(), found: res.headers.get('Muxway-File') ?? '' };
}

// The changes of the repository the pane works in: every five seconds
// while the window is open, every ten for a tile's header (the window
// and the header share the query, so the shorter wins). A pane outside
// a repository is asked again every minute for the header, since it may
// enter one, and at the window's own pace while the window is open: it
// says so, and a cd into a repository should show. A refusal is kept,
// not retried.
export function useChanges(address: string, enabled: boolean, every = 5_000) {
  return useQuery({
    queryKey: keys.changes(address),
    queryFn: () => {
      const t = target(address);
      return api<Changes>(`/v1/panes/${t.address}/git`, { hub: t.hub });
    },
    enabled,
    refetchInterval: (q) =>
      q.state.error instanceof ApiError && q.state.error.status === 404 && every > 5_000
        ? 60_000
        : every,
    // The status limit is one a second: a 429 is asked again after one.
    retry: (count, err) => (err instanceof ApiError ? err.status === 429 && count < 3 : count < 2),
    retryDelay: 1_100,
    placeholderData: (prev) => prev,
  });
}

// The names in a shell pane's directory, for a writer on a host that
// lists: asked again every `every` ms while a tile shows the pane, which
// the ETag keeps to a round trip; the directory is in the key, so a cd
// lists again at once. Nothing is asked of a pane without a directory.
export function useListing(
  address: string,
  cwd: string | undefined,
  enabled: boolean,
  every = 2_000,
) {
  return useQuery({
    queryKey: keys.listing(address, cwd ?? ''),
    queryFn: () => {
      const t = target(address);
      return api<Listing>(`/v1/panes/${t.address}/dir`, { hub: t.hub, conditional: true });
    },
    enabled: enabled && !!cwd,
    refetchInterval: every,
    // The limit is the preview's, two a second: a 429 is asked again after one.
    retry: (count, err) => (err instanceof ApiError ? err.status === 429 && count < 3 : count < 2),
    retryDelay: 1_100,
    placeholderData: (prev) => prev,
  });
}

// A line typed into a pane for a click on a name: the text, then Enter
// when asked, in the pane's order behind whatever is in flight.
export function typeLine(address: string, text: string, enter: boolean): Promise<void> {
  noteOwn(address);
  return inOrder(address, async () => {
    await sendInput(address, { text });
    if (enter) await sendInput(address, { key: 'Enter' });
  });
}

// One change's diff against the last commit.
export function readDiff(address: string, path: string): Promise<Diff> {
  const t = target(address);
  return api<Diff>(`/v1/panes/${t.address}/git/diff?path=${encodeURIComponent(path)}`, {
    hub: t.hub,
  });
}

async function fetchBlob(path: string, hub?: string): Promise<Blob> {
  return (await fetchRaw(path, hub)).blob();
}

async function fetchRaw(path: string, hub?: string): Promise<Response> {
  const res = await fetch((hub ?? '') + path, {
    headers: { 'X-Muxway-Client': 'web' },
    credentials: hub ? 'include' : 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) {
    let code = 'error';
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, code);
  }
  return res;
}

// The types the host's inbox takes, by the browser's type or the name's end.
export const FILE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip',
};

// fileType is the type a file goes as: a known one by the browser's type
// or the name's extension, which the host checks and names; a text with
// no usable extension as plain text, so it lands as .txt; anything else
// as bytes, kept under the extension the name ends in.
export function fileType(f: File): string {
  const known = Object.values(FILE_TYPES);
  if (known.includes(f.type)) return f.type;
  const byName = FILE_TYPES[extOf(f.name)];
  if (byName) return byName;
  if (!fileExt(f.name) && (f.type.startsWith('text/') || isTextName(f.name))) return 'text/plain';
  return 'application/octet-stream';
}

// fileExt is all of the browser's name for a file that travels: the word
// after its last dot, lowercased, when it is one the host takes.
export function fileExt(name: string): string {
  const ext = extOf(name);
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

// sendFile hands a file to the pane's host; the answer is where it went.
// Of the browser's name for the file only the extension is sent.
export function sendFile(address: string, f: File, type: string): Promise<{ path: string }> {
  const form = new FormData();
  const ext = fileExt(f.name);
  form.append('file', new Blob([f], { type }), ext ? `file.${ext}` : 'file');
  const t = target(address);
  return api<{ path: string }>(`/v1/panes/${t.address}/files`, {
    method: 'POST',
    body: form,
    hub: t.hub,
  });
}

// closePane asks the host to close the pane, ending what runs in it.
export function closePane(address: string): Promise<void> {
  const t = target(address);
  return api<void>(`/v1/panes/${t.address}/close`, { method: 'POST', hub: t.hub });
}

// resize asks the host to size the pane's window; the answer is the pane
// as tmux has it now. 429 means another resize landed within the second.
// After a layout the answer lists the window's panes, which may have new
// addresses.
export function resizePane(address: string, body: Resize): Promise<{ pane: Pane; panes?: Pane[] }> {
  noteOwn(address);
  const t = target(address);
  const { hub } = splitAddress(address);
  return api<{ pane: Pane; panes?: Pane[] }>(`/v1/panes/${t.address}/resize`, {
    method: 'POST',
    body: JSON.stringify(body),
    hub: t.hub,
  }).then((r) => {
    noteOwn(address);
    return {
      pane: claim(address, r.pane),
      panes: r.panes?.map((p) => (hub ? { ...p, address: joinAddress(hub, p.address), hub } : p)),
    };
  });
}

// splitWindow asks the host for one more pane in a window, beside ("h") or
// below ("v") the pane it is split from; the answer is the new pane.
export function splitWindow(
  host: string,
  session: string,
  window: number,
  direction: 'h' | 'v',
  hub?: string,
): Promise<{ pane: Pane }> {
  return api<{ pane: Pane }>(`/v1/windows/${host}/${session}/${window}/panes`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
    hub: hub ? originOfHub(hub) : undefined,
  }).then((r) => ({ pane: claim(joinAddress(hub, r.pane.address), r.pane) }));
}

// newSession starts a session on a host whose agent allows it; the answer
// is its first pane.
export function newSession(host: string, name: string, hub?: string): Promise<{ pane: Pane }> {
  return api<{ pane: Pane }>(`/v1/hosts/${host}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ name }),
    hub: hub ? originOfHub(hub) : undefined,
  }).then((r) => ({ pane: claim(joinAddress(hub, r.pane.address), r.pane) }));
}

// Whether the hub has a transcriber: asked once per sign-in, so a hub
// without one is never asked again.
export function useTranscriber() {
  return useQuery({
    queryKey: keys.transcriber,
    queryFn: () =>
      api<void>('/v1/transcribe')
        .then(() => true)
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return false;
          throw err;
        }),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// A spoken clip to the hub's transcriber; the text comes back for the input
// line to show, never sent by itself.
export function transcribe(wav: ArrayBuffer): Promise<string> {
  return api<{ text: string }>('/v1/transcribe', {
    method: 'POST',
    body: wav,
    headers: { 'Content-Type': 'audio/wav' },
  }).then((r) => r.text);
}
