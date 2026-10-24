import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from './client';
import { noteOwn } from '../term/lens';
import type {
  AuthMethods,
  Host,
  Key,
  Me,
  Mouse,
  Pane,
  PaneContent,
  Resize,
  Tree,
  WindowContent,
} from './types';

export const keys = {
  auth: ['auth'] as const,
  me: ['me'] as const,
  hosts: ['hosts'] as const,
  tree: (host: string) => ['tree', host] as const,
  pane: (address: string) => ['pane', address] as const,
  window: (host: string, session: string, window: string) =>
    ['window', host, session, window] as const,
  panes: ['panes'] as const,
  transcriber: ['transcriber'] as const,
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

export function useHosts() {
  return useQuery({
    queryKey: keys.hosts,
    queryFn: () => api<Host[]>('/v1/hosts').then(unwrapHosts),
    refetchInterval: 5_000,
  });
}
function unwrapHosts(v: unknown): Host[] {
  return (v as { hosts: Host[] | null }).hosts ?? [];
}

export function useTree(host: string, online: boolean) {
  return useQuery({
    queryKey: keys.tree(host),
    queryFn: () => api<Tree>(`/v1/hosts/${host}/tree`),
    enabled: online,
    refetchInterval: 5_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
  });
}

export function usePane(address: string, every = 1_000) {
  const visible = useVisible();
  return useQuery({
    queryKey: keys.pane(address),
    queryFn: () => api<PaneContent>(`/v1/panes/${address}?ansi=1&lines=400`, { conditional: true }),
    refetchInterval: visible ? every : 5_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
    placeholderData: (prev) => prev,
  });
}

// The pane as the view showing it has it; fetches nothing itself.
export function usePaneCached(address: string) {
  return useQuery({
    queryKey: keys.pane(address),
    queryFn: () => api<PaneContent>(`/v1/panes/${address}?ansi=1&lines=400`),
    enabled: false,
  });
}

export function useInput(address: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string } | { key: Key } | { mouse: Mouse }) => {
      noteOwn(address);
      return api<void>(`/v1/panes/${address}/input`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      noteOwn(address);
      qc.invalidateQueries({ queryKey: keys.pane(address) });
      // Input clears the pane's attention: the lists say so at once.
      qc.invalidateQueries({ queryKey: keys.panes });
      qc.invalidateQueries({ queryKey: keys.tree(address.split('/')[0]) });
    },
  });
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

// Every pane the principal may read, flat, for the selector.
export function useAllPanes(enabled: boolean) {
  return useQuery({
    queryKey: keys.panes,
    queryFn: () => api<{ panes: Pane[] | null }>('/v1/panes').then((v) => v.panes ?? []),
    enabled,
    refetchInterval: 5_000,
  });
}

// resize asks the host to size the pane's window; the answer is the pane
// as tmux has it now. 429 means another resize landed within the second.
export function resizePane(address: string, body: Resize): Promise<{ pane: Pane }> {
  noteOwn(address);
  return api<{ pane: Pane }>(`/v1/panes/${address}/resize`, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then((r) => {
    noteOwn(address);
    return r;
  });
}

// splitWindow asks the host for one more pane in a window, beside ("h") or
// below ("v") the pane it is split from; the answer is the new pane.
export function splitWindow(
  host: string,
  session: string,
  window: number,
  direction: 'h' | 'v',
): Promise<{ pane: Pane }> {
  return api<{ pane: Pane }>(`/v1/windows/${host}/${session}/${window}/panes`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

// newSession starts a session on a host whose agent allows it; the answer
// is its first pane.
export function newSession(host: string, name: string): Promise<{ pane: Pane }> {
  return api<{ pane: Pane }>(`/v1/hosts/${host}/sessions`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
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
