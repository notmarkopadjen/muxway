import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, target } from '../api/client';
import { keys } from '../api/queries';
import { createShare, listShares, revokeShare } from '../api/shares';
import type { Pane, Share } from '../api/types';
import { copyPng, qrPng } from '../qrpng';
import { Box } from './Box';
import { PaneTitle } from './PaneTitle';
import { Qr } from './Qr';

// The share window: the live shares of one pane with revoke, and the form
// that makes one. A new share's link, password and code are shown once;
// the password leaves with done and the hub keeps only its hash.

const LIFETIMES: [label: string, seconds: number][] = [
  ['1 h', 3600],
  ['24 h', 86400],
  ['7 d', 604800],
];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

// Twelve letters and digits in three groups, as the hub would make them.
export function suggestPassword(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b, i) => (i && i % 4 === 0 ? '-' : '') + ALPHABET[b & 31]).join('');
}

function until(at: number): string {
  return new Date(at * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function useShares(address: string | undefined, enabled: boolean) {
  const hub = address ? target(address).hub : undefined;
  return useQuery({
    queryKey: keys.shares(hub),
    queryFn: () => listShares(hub),
    enabled,
    refetchInterval: 10_000,
  });
}

export function sharesOf(shares: Share[] | undefined, pane: Pane | undefined): Share[] {
  if (!shares || !pane) return [];
  return shares.filter((s) => s.host === pane.host && s.pane_id === pane.pane_id);
}

export function ShareWindow({ pane, onClose }: { pane: Pane; onClose: () => void }) {
  const qc = useQueryClient();
  const hub = target(pane.address).hub;
  const shares = useShares(pane.address, true);
  const mine = sharesOf(shares.data, pane);
  const [password, setPassword] = useState(suggestPassword);
  const [ttl, setTtl] = useState(86400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<Share | null>(null);
  const [copied, setCopied] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: keys.shares(hub) });
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        onClose();
      } else ev.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const share = await createShare(pane.address, { ttl, password: password.trim() });
      setMade(share);
      setPassword(suggestPassword());
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'too_many'
            ? 'twenty shares already: revoke one first'
            : err.code === 'bad_input'
              ? 'the password needs 8 to 64 characters'
              : err.code === 'read_only'
                ? 'only a writer of the pane may share it'
                : err.code
          : 'the hub could not be reached',
      );
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    await revokeShare(id, hub).catch(() => undefined);
    if (made?.id === id) setMade(null);
    refresh();
  };
  const note = (what: string) => {
    setCopied(what);
    window.setTimeout(() => setCopied((c) => (c === what ? '' : c)), 1500);
  };
  const copyText = (what: string, text: string) =>
    navigator.clipboard.writeText(text).then(
      () => note(what),
      () => setError('the browser refused the clipboard: select and copy it'),
    );
  const copyImage = async () => {
    if (!made) return;
    const png = await qrPng(made.url);
    if (!png) return;
    if (await copyPng(png)) note('image');
    else setError('this browser puts no image on the clipboard: ⤓ saves it instead');
  };
  const saveImage = async () => {
    if (!made) return;
    const png = await qrPng(made.url);
    if (!png) return;
    const url = URL.createObjectURL(png);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'muxway-share.png';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="mx-help" onClick={onClose} data-testid="share-window">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title="share · read only" enter={false} className="mx-share-box">
          <div className="mx-share-pane">
            <PaneTitle pane={pane} /> <span className="mx-dim">{pane.address}</span>
          </div>
          <ul className="mx-share-list" data-testid="share-list">
            {mine.map((s) => (
              <li key={s.id} data-testid="share-row" data-id={s.id}>
                <span>until {until(s.expires)}</span>
                <span className="mx-dim">
                  {s.watching ? `${s.watching} watching` : 'nobody watching'}
                </span>
                <button type="button" data-testid="share-revoke" onClick={() => void revoke(s.id)}>
                  revoke
                </button>
              </li>
            ))}
            {mine.length === 0 && <li className="mx-dim">not shared.</li>}
          </ul>
          {made ? (
            <div className="mx-share-made" data-testid="share-made" role="status">
              <div className="mx-share-made-text">
                <div>
                  shared until {until(made.expires)}. the password is shown only now, never again:
                </div>
                <div className="mx-share-field">
                  <span className="mx-dim">link</span>
                  <code data-testid="share-url">{made.url}</code>
                  <button
                    type="button"
                    data-testid="share-copy-link"
                    onClick={() => void copyText('link', made.url)}
                  >
                    {copied === 'link' ? 'copied' : 'copy link'}
                  </button>
                </div>
                <div className="mx-share-field">
                  <span className="mx-dim">password</span>
                  <code data-testid="share-password">{made.password}</code>
                  <button
                    type="button"
                    data-testid="share-copy-password"
                    onClick={() => void copyText('password', made.password ?? '')}
                  >
                    {copied === 'password' ? 'copied' : 'copy password'}
                  </button>
                </div>
                <div className="mx-dim">
                  send the link and the password apart; the image holds the link only.
                </div>
                <div className="mx-toggles">
                  <button
                    type="button"
                    data-testid="share-copy-image"
                    onClick={() => void copyImage()}
                  >
                    {copied === 'image' ? 'copied' : 'copy image'}
                  </button>{' '}
                  <button
                    type="button"
                    data-testid="share-save-image"
                    onClick={() => void saveImage()}
                  >
                    ⤓ save image
                  </button>{' '}
                  <button type="button" data-testid="share-done" onClick={() => setMade(null)}>
                    done
                  </button>
                </div>
              </div>
              <Qr text={made.url} label="the share's link, as a code" size={176} />
            </div>
          ) : (
            <form className="mx-share-form" onSubmit={create}>
              <label>
                <span className="mx-dim">password</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="share-password-input"
                  aria-label="password"
                />
              </label>
              <span className="mx-share-ttl" data-testid="share-ttl">
                <span className="mx-dim">for</span>
                {LIFETIMES.map(([label, seconds]) => (
                  <button
                    key={seconds}
                    type="button"
                    className={ttl === seconds ? 'on' : undefined}
                    onClick={() => setTtl(seconds)}
                    data-testid={`share-ttl-${seconds}`}
                  >
                    {label}
                  </button>
                ))}
              </span>
              <button
                type="submit"
                disabled={busy || password.trim().length < 8}
                data-testid="share-create"
              >
                create
              </button>
            </form>
          )}
          {error && (
            <div className="mx-error" role="alert" data-testid="share-error">
              {error}
            </div>
          )}
          <div className="mx-toggles">
            <span className="mx-dim">
              the observer sees this pane's screen, the web links in it, and the file or diff you
              open over it; nothing else. <kbd>Esc</kbd> close
            </span>
          </div>
        </Box>
      </div>
    </div>
  );
}
