import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './client';
import type { Event, Events } from './types';

// One long poll at a time: GET /v1/events?after=<cursor>&wait=30, restarted
// on completion, backed off on error. Every event invalidates the trees;
// the caller hears about the ones that need a person.
export function useEventStream(onEvent: (e: Event) => void, enabled: boolean) {
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
          const q = cursor === undefined ? '?limit=1' : `?after=${cursor}&wait=30`;
          const res = await api<Events>('/v1/events' + q, { signal: ctl.signal });
          delay = 1000;
          if (cursor !== undefined) {
            for (const e of res.events) {
              qc.invalidateQueries({ queryKey: ['tree', e.host] });
              onEvent(e);
            }
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
