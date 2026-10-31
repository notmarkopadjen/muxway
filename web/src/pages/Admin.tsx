import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { keys, useMe } from '../api/queries';
import type { AdminOverview, AdminToken, LogRecord } from '../api/types';
import { Box } from '../components/Box';
import { Qr } from '../components/Qr';
import { connectCode } from '../qr';
import { setHeading } from '../shell/heading';

// The admin page: the hub's log, its tokens and users, who is connected,
// and the address lists. Only an admin principal gets past the hub.

const KEEP = 2000;
const IP = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:]*)$/i;

function clock(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], { hour12: false });
}

function age(at: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - at));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function day(at: number): string {
  return new Date(at * 1000).toISOString().slice(0, 10);
}

function words(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function useOverview(enabled: boolean) {
  return useQuery({
    queryKey: keys.admin,
    queryFn: () => api<AdminOverview>('/v1/admin/overview'),
    enabled,
    retry: false,
    refetchInterval: 5000,
  });
}

// useLog tails the hub's log through the long poll while live is on.
function useLog(enabled: boolean, live: boolean) {
  const [records, setRecords] = useState<LogRecord[]>([]);
  const cursor = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || !live) return;
    let stopped = false;
    const ctl = new AbortController();
    (async () => {
      while (!stopped) {
        const q =
          cursor.current === null ? '?limit=500' : `?after=${cursor.current}&limit=500&wait=25`;
        try {
          const page = await api<{ records: LogRecord[]; next: number }>('/v1/admin/log' + q, {
            signal: ctl.signal,
          });
          if (stopped) return;
          cursor.current = page.next;
          if (page.records.length) setRecords((old) => [...old, ...page.records].slice(-KEEP));
        } catch (err) {
          if (stopped || (err instanceof ApiError && err.status === 403)) return;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
    return () => {
      stopped = true;
      ctl.abort();
    };
  }, [enabled, live]);
  return records;
}

export function AdminPage() {
  const me = useMe();
  const admin = !!me.data?.admin;
  const overview = useOverview(admin);
  const [live, setLive] = useState(true);
  const records = useLog(admin, live);
  const [denyDraft, setDenyDraft] = useState<string | null>(null);

  useEffect(() => {
    setHeading({ place: 'admin' });
    return () => setHeading({ place: '' });
  }, []);

  const forbidden = overview.error instanceof ApiError && overview.error.status === 403;
  if (me.isPending) return null;
  if (!admin || forbidden)
    return (
      <div className="mx-empty" data-testid="admin-refused">
        not yours to see.
      </div>
    );
  const o = overview.data;
  const deny = (addr: string) => {
    const base = denyDraft ?? (o?.access.deny ?? []).join('\n');
    const list = words(base);
    if (!list.includes(addr)) list.push(addr);
    setDenyDraft(list.join('\n'));
  };

  return (
    <div className="mx-admin" data-testid="admin">
      {!o && <div />}
      {o && (
        <div className="mx-admin-facts mx-dim" data-testid="admin-facts">
          hub {o.hub.version} · {o.hub.tls ? 'tls' : 'behind a proxy'}
          {o.hub.trust_proxy && ' · trusts the proxy'} · sign-in: token
          {o.hub.providers.map((p) => `, ${p}`)}
          {o.hub.transcriber && ' · transcriber'} · you are {o.you.addr}
        </div>
      )}
      <LogBox
        records={records}
        live={live}
        onLive={() => setLive((l) => !l)}
        onDeny={deny}
        denied={o?.access.deny ?? []}
      />
      {o && (
        <div className="mx-admin-row">
          <TokensBox o={o} />
          <ClientsBox o={o} />
          <AccessBox o={o} draft={denyDraft} setDraft={setDenyDraft} />
        </div>
      )}
      {overview.isError && !forbidden && (
        <div className="mx-error" role="alert">
          the overview did not load: {String(overview.error)}
        </div>
      )}
    </div>
  );
}

function LogBox({
  records,
  live,
  onLive,
  onDeny,
  denied,
}: {
  records: LogRecord[];
  live: boolean;
  onLive: () => void;
  onDeny: (addr: string) => void;
  denied: string[];
}) {
  const [filter, setFilter] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return records;
    return records.filter((r) =>
      [r.msg, r.level, ...Object.entries(r.attrs ?? {}).flat()].some((s) =>
        s.toLowerCase().includes(f),
      ),
    );
  }, [records, filter]);
  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <Box title="log" className="mx-admin-log" testId="admin-log">
      <div
        className="mx-log-lines"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {shown.map((r) => {
          const bad = r.level !== 'INFO';
          const addr = r.attrs?.addr;
          return (
            <div
              key={r.seq}
              className={`mx-log-line${bad ? ' mx-bad' : ''}`}
              data-testid="log-line"
              data-level={r.level}
            >
              <span className="mx-dim">{clock(r.at)}</span>
              <span className="mx-log-mark">{bad ? '!' : ' '}</span>
              <span className="mx-log-msg">{r.msg}</span>
              <span className="mx-log-attrs">
                {Object.entries(r.attrs ?? {})
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')}
              </span>
              {addr && IP.test(addr) && !denied.some((d) => d === addr || d === `${addr}/32`) && (
                <button
                  type="button"
                  className="mx-log-deny"
                  title={`put ${addr} on the deny list`}
                  data-testid="log-deny"
                  onClick={() => onDeny(addr)}
                >
                  deny
                </button>
              )}
            </div>
          );
        })}
        {shown.length === 0 && <div className="mx-dim">nothing logged yet.</div>}
      </div>
      <div className="mx-log-foot">
        <input
          value={filter}
          placeholder="filter"
          aria-label="filter the log"
          data-testid="log-filter"
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" onClick={onLive} data-testid="log-live">
          {live ? '● live' : '○ paused'}
        </button>
      </div>
    </Box>
  );
}

const TTLS: [string, number][] = [
  ['default', 0],
  ['1 hour', 3600],
  ['1 day', 86400],
  ['7 days', 7 * 86400],
  ['30 days', 30 * 86400],
  ['1 year', 365 * 86400],
];

function grants(t: { read: string[]; write: string[] }): string {
  return `r:${t.read.join(',')}${t.write.length ? ` w:${t.write.join(',')}` : ''}`;
}

function TokensBox({ o }: { o: AdminOverview }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [read, setRead] = useState('');
  const [write, setWrite] = useState('');
  const [ttl, setTtl] = useState(0);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState<{ token: AdminToken; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const out = await api<{ secret: string; token: AdminToken }>('/v1/admin/tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          read: words(read),
          write: words(write),
          ttl,
          admin,
        }),
      });
      setSecret(out);
      setCopied(false);
      setName('');
      setRead('');
      setWrite('');
      setAdmin(false);
      qc.invalidateQueries({ queryKey: keys.admin });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'bad_input'
          ? 'a name and at least one valid read pattern'
          : String(err),
      );
    }
  };
  const remove = async (path: string) => {
    setConfirm(null);
    try {
      await api<void>(path, { method: 'DELETE' });
    } catch (err) {
      setError(String(err));
    }
    qc.invalidateQueries({ queryKey: keys.admin });
  };

  return (
    <Box title="tokens & users" className="mx-admin-tokens" testId="admin-tokens">
      <div className="mx-admin-body">
        <ul className="mx-admin-list">
          {o.tokens.map((t) => (
            <li key={t.id} data-testid="token-row" data-name={t.name}>
              <span className="mx-admin-name">{t.name}</span>
              {t.admin && <span className="mx-warn">admin</span>}
              <span className="mx-dim mx-admin-grants" title={grants(t)}>
                {grants(t)}
              </span>
              <span className="mx-dim">until {day(t.expires)}</span>
              {confirm === t.id ? (
                <span className="mx-admin-confirm">
                  revoke?{' '}
                  <button
                    type="button"
                    data-testid="token-revoke-yes"
                    onClick={() => remove(`/v1/admin/tokens/${t.id}`)}
                  >
                    yes
                  </button>{' '}
                  <button type="button" onClick={() => setConfirm(null)}>
                    no
                  </button>
                </span>
              ) : (
                <button type="button" data-testid="token-revoke" onClick={() => setConfirm(t.id)}>
                  revoke
                </button>
              )}
            </li>
          ))}
          {o.users.map((u) => (
            <li key={u.id} data-testid="user-row">
              <span className="mx-admin-name">{u.email}</span>
              {u.admin && <span className="mx-warn">admin</span>}
              <span className="mx-dim mx-admin-grants" title={grants(u)}>
                {grants(u)}
              </span>
              <span className="mx-dim">until {day(u.expires)}</span>
              {confirm === u.id ? (
                <span className="mx-admin-confirm">
                  remove?{' '}
                  <button type="button" onClick={() => remove(`/v1/admin/users/${u.id}`)}>
                    yes
                  </button>{' '}
                  <button type="button" onClick={() => setConfirm(null)}>
                    no
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirm(u.id)}>
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {secret ? (
          <div className="mx-admin-secret" data-testid="token-secret" role="status">
            <div className="mx-admin-secret-text">
              <div>
                token <b>{secret.token.name}</b>, until {day(secret.token.expires)}. it is shown
                only now, never again:
              </div>
              <code data-testid="token-secret-value">{secret.secret}</code>
              <div className="mx-dim">scan the code with the phone app: ≡ hubs, scan code</div>
            </div>
            <Qr
              text={connectCode(location.origin, secret.secret)}
              label="connect code for the phone app"
            />
            <div className="mx-toggles">
              <button
                type="button"
                data-testid="token-copy"
                onClick={() =>
                  navigator.clipboard.writeText(secret.secret).then(
                    () => setCopied(true),
                    () => setError('the browser refused the clipboard: select and copy it'),
                  )
                }
              >
                {copied ? 'copied' : 'copy'}
              </button>
              <button type="button" data-testid="token-secret-done" onClick={() => setSecret(null)}>
                done
              </button>
            </div>
          </div>
        ) : (
          <form className="mx-admin-form" onSubmit={create} data-testid="token-form">
            <input
              value={name}
              placeholder="name"
              aria-label="token name"
              maxLength={64}
              data-testid="token-name"
              onChange={(e) => setName(e.target.value)}
            />
            <input
              value={read}
              placeholder="read: alice-laptop/*"
              aria-label="read grants"
              data-testid="token-read"
              onChange={(e) => setRead(e.target.value)}
            />
            <input
              value={write}
              placeholder="write: alice-laptop/work/*"
              aria-label="write grants"
              data-testid="token-write"
              onChange={(e) => setWrite(e.target.value)}
            />
            <select
              value={ttl}
              aria-label="lifetime"
              data-testid="token-ttl"
              onChange={(e) => setTtl(Number(e.target.value))}
            >
              {TTLS.map(([l, v]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className="mx-admin-check">
              <input
                type="checkbox"
                checked={admin}
                data-testid="token-admin"
                onChange={(e) => setAdmin(e.target.checked)}
              />{' '}
              admin
            </label>
            <button type="submit" data-testid="token-create">
              create
            </button>
          </form>
        )}
        {error && (
          <div className="mx-error" role="alert" data-testid="token-error">
            {error}
          </div>
        )}
      </div>
    </Box>
  );
}

function ClientsBox({ o }: { o: AdminOverview }) {
  const qc = useQueryClient();
  const names = new Map<string, string>();
  for (const t of o.tokens) names.set(t.id, t.name);
  for (const u of o.users) names.set(u.id, u.email);
  const end = async (id: string) => {
    await api<void>(`/v1/admin/sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: keys.admin });
  };
  return (
    <Box title="clients" className="mx-admin-clients" testId="admin-clients">
      <div className="mx-admin-body">
        <ul className="mx-admin-list">
          {o.clients.map((c) => (
            <li
              key={`${c.kind}-${c.id ?? ''}-${c.principal}-${c.client}-${c.addr}`}
              data-testid="client-row"
            >
              <span className="mx-admin-name">{c.client}</span>
              <span>{names.get(c.principal) ?? c.principal}</span>
              <span className="mx-dim">{c.addr}</span>
              <span className="mx-dim" title="since · last seen">
                {age(c.since)} · {age(c.seen)}
              </span>
              {c.kind === 'session' && c.id ? (
                <button type="button" data-testid="client-end" onClick={() => end(c.id!)}>
                  end
                </button>
              ) : (
                <span className="mx-faint" title="a bearer token: revoke it to end this">
                  token
                </span>
              )}
            </li>
          ))}
          {o.clients.length === 0 && <li className="mx-dim">no one.</li>}
        </ul>
        <div className="mx-admin-sub">agents</div>
        <ul className="mx-admin-list">
          {o.agents.map((a) => (
            <li key={a.host} data-testid="agent-row">
              <span className={a.online ? '' : 'mx-dim'}>{a.online ? '●' : '○'}</span>
              <span className="mx-admin-name">{a.host}</span>
              <span className="mx-dim">{a.addr ?? 'offline'}</span>
              <span className="mx-dim">
                {a.connected ? `up ${age(a.connected)}` : `paired ${day(a.paired)}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Box>
  );
}

function AccessBox({
  o,
  draft,
  setDraft,
}: {
  o: AdminOverview;
  draft: string | null;
  setDraft: (s: string | null) => void;
}) {
  const qc = useQueryClient();
  const [allow, setAllow] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lockout, setLockout] = useState(false);
  const allowText = allow ?? o.access.allow.join('\n');
  const denyText = draft ?? o.access.deny.join('\n');
  const changed = allow !== null || draft !== null;

  const save = async (force: boolean) => {
    setError('');
    setLockout(false);
    try {
      await api('/v1/admin/access' + (force ? '?force=1' : ''), {
        method: 'PUT',
        body: JSON.stringify({ allow: words(allowText), deny: words(denyText) }),
      });
      setAllow(null);
      setDraft(null);
      qc.invalidateQueries({ queryKey: keys.admin });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'self_lockout') setLockout(true);
      else if (err instanceof ApiError && err.code === 'bad_input')
        setError('one entry is not an address or CIDR, or a list has more than 256');
      else setError(String(err));
    }
  };
  const unlock = async (addr: string) => {
    await api<void>('/v1/admin/unlock', { method: 'POST', body: JSON.stringify({ addr }) }).catch(
      () => undefined,
    );
    qc.invalidateQueries({ queryKey: keys.admin });
  };

  return (
    <Box title="access" className="mx-admin-access" testId="admin-access">
      <div className="mx-admin-body">
        <label className="mx-admin-label">
          allow <span className="mx-dim">(empty: everyone not denied)</span>
          <textarea
            rows={3}
            value={allowText}
            spellCheck={false}
            placeholder="one address or CIDR a line"
            data-testid="access-allow"
            onChange={(e) => setAllow(e.target.value)}
          />
        </label>
        <label className="mx-admin-label">
          deny
          <textarea
            rows={3}
            value={denyText}
            spellCheck={false}
            placeholder="one address or CIDR a line"
            data-testid="access-deny"
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <div className="mx-admin-sub">locked out</div>
        <ul className="mx-admin-list">
          {o.locked.map((l) => (
            <li key={l.addr} data-testid="locked-row">
              <span className="mx-bad">{l.addr}</span>
              <span className="mx-dim">until {clock(l.until)}</span>
              <button type="button" onClick={() => unlock(l.addr)}>
                unlock
              </button>
            </li>
          ))}
          {o.locked.length === 0 && <li className="mx-dim">no one.</li>}
        </ul>
        <div className="mx-toggles">
          <button
            type="button"
            disabled={!changed}
            data-testid="access-save"
            onClick={() => save(false)}
          >
            save
          </button>
          {changed && (
            <button
              type="button"
              onClick={() => {
                setAllow(null);
                setDraft(null);
                setLockout(false);
              }}
            >
              undo
            </button>
          )}
        </div>
        {lockout && (
          <div className="mx-error" role="alert" data-testid="access-lockout">
            that would shut you out: the hub sees you as {o.you.addr}.{' '}
            <button type="button" data-testid="access-force" onClick={() => save(true)}>
              save anyway
            </button>
          </div>
        )}
        {error && (
          <div className="mx-error" role="alert" data-testid="access-error">
            {error}
          </div>
        )}
        <p className="mx-dim mx-admin-note">
          agents are behind these lists too. locked out of the page? on the hub&apos;s machine:{' '}
          <code>muxway hub access clear</code>
        </p>
      </div>
    </Box>
  );
}
