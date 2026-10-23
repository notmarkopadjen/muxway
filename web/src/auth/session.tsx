import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../api/client';
import { keys, useMe } from '../api/queries';

// Who is signed in, from the hub; the token itself never stays in the page.
export function useSession() {
  const me = useMe();
  const qc = useQueryClient();
  const signInWithToken = useCallback(
    async (token: string) => {
      await api<void>('/v1/auth/token', { method: 'POST', body: JSON.stringify({ token }) });
      await qc.invalidateQueries({ queryKey: keys.me });
    },
    [qc],
  );
  const logout = useCallback(async () => {
    await api<void>('/v1/auth/logout', { method: 'POST' });
    qc.clear();
  }, [qc]);
  return { me: me.data, loading: me.isPending, signedIn: !!me.data, signInWithToken, logout };
}
