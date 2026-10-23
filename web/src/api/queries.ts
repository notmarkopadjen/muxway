import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from './client';
import type { AuthMethods, Host, Key, Me, PaneContent, Tree } from './types';

export const keys = {
  auth: ['auth'] as const,
  me: ['me'] as const,
  hosts: ['hosts'] as const,
  tree: (host: string) => ['tree', host] as const,
  pane: (address: string) => ['pane', address] as const,
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

export function usePane(address: string) {
  const visible = useVisible();
  return useQuery({
    queryKey: keys.pane(address),
    queryFn: () => api<PaneContent>(`/v1/panes/${address}?ansi=1&lines=400`, { conditional: true }),
    refetchInterval: visible ? 1_000 : 5_000,
    retry: (count, err) => !(err instanceof ApiError) && count < 2,
    placeholderData: (prev) => prev,
  });
}

export function useInput(address: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string } | { key: Key }) =>
      api<void>(`/v1/panes/${address}/input`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.pane(address) });
    },
  });
}
