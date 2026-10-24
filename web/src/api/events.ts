import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './client';
import type { Event, Events } from './types';

// One long poll at a time: GET /v1/events?after=<cursor>&wait=30, restarted
// on completion, backed off on error. The first call fetches the recent
// history, so the caller knows what each pane was last up to; those come
// with live=false. Every live event invalidates the lists.
export function useEventStream(onEvent: (e: Event, live: boolean) => void, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cursor: number | undefined;
    let stopped = false;
    let delay = 1000;
    const ctl = new AbortController();
    const loop = async () => {
      while (!stopped) {
        try {
          const q = cursor === undefined ? '?limit=100' : `?after=${cursor}&wait=30`;
          const res = await api<Events>('/v1/events' + q, { signal: ctl.signal });
          delay = 1000;
          const live = cursor !== undefined;
          for (const e of res.events) {
            if (live) {
              qc.invalidateQueries({ queryKey: ['tree', e.host] });
              qc.invalidateQueries({ queryKey: ['panes'] });
            }
            onEvent(e, live);
          }
          cursor = res.next;
        } catch (err) {
          if (stopped || (err instanceof DOMException && err.name === 'AbortError')) return;
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, 30_000);
        }
      }
    };
    loop();
    return () => {
      stopped = true;
      ctl.abort();
    };
  }, [enabled, onEvent, qc]);
}
