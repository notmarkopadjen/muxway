import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './client';
import { keys } from './queries';
import type { Event, Events } from './types';
import { joinAddress, useHubs, type Hub } from '../hubs';

// One long poll per hub: GET /v1/events?after=<cursor>&wait=30, restarted
// on completion, backed off on error. The first call fetches the recent
// history, so the caller knows what each pane was last up to; those come
// with live=false. Every live event invalidates its hub's lists. A pane of
// another hub is named with that hub's name, as everywhere on the page.
export function useEventStream(onEvent: (e: Event, live: boolean) => void, enabled: boolean) {
  const qc = useQueryClient();
  const hubs = useHubs();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const ctl = new AbortController();
    const follow = async (hub: Hub, own: boolean) => {
      let cursor: number | undefined;
      let delay = 1000;
      const name = own ? undefined : hub.name;
      while (!stopped) {
        try {
          const q = cursor === undefined ? '?limit=100' : `?after=${cursor}&wait=30`;
          const res = await api<Events>('/v1/events' + q, {
            signal: ctl.signal,
            hub: own ? undefined : hub.url,
          });
          delay = 1000;
          const live = cursor !== undefined;
          for (const raw of res.events) {
            const e = own ? raw : { ...raw, address: joinAddress(name, raw.address) };
            if (live) {
              qc.invalidateQueries({ queryKey: keys.tree(e.host, name) });
              qc.invalidateQueries({ queryKey: keys.panesOf(name) });
              qc.invalidateQueries({ queryKey: keys.inboxOf(name) });
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
    hubs.forEach((h, i) => void follow(h, i === 0));
    return () => {
      stopped = true;
      ctl.abort();
    };
  }, [enabled, onEvent, qc, hubs]);
}
