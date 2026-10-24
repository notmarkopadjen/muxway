import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useInput, usePane } from '../api/queries';
import type { Key } from '../api/types';
import { Badge } from '../components/Badge';
import { KeyBar } from '../components/KeyBar';
import { PaneTitle } from '../components/PaneTitle';
import { useToast } from '../components/Toast';
import { Screen } from '../term/Screen';
import { useFit } from '../term/useFit';

export function PanePage() {
  const { _splat: address = '' } = useParams({ strict: false });
  const pane = usePane(address);
  const input = useInput(address);
  const toast = useToast();
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const writable = pane.data?.pane.mode === 'write';
  // Fit is on by default for a pane the person may write to.
  const [fit, setFit] = useState<boolean | null>(null);
  const fitOn = fit ?? writable;
  const fitted = useFit(address, fitOn && writable, box, 'pane');

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (ev.key === 'f' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && writable)
        setFit((f) => !(f ?? writable));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [writable]);

  const send = async (body: { text: string } | { key: Key }) => {
    try {
      await input.mutateAsync(body);
    } catch (err) {
      toast.push({
        kind: 'refused',
        title:
          err instanceof ApiError
            ? err.code === 'read_only'
              ? 'this pane is read-only'
              : err.code
            : 'hub unreachable',
      });
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text;
    setText('');
    if (t) await send({ text: t });
    await send({ key: 'Enter' });
  };

  if (pane.isError) {
    const err = pane.error;
    const msg =
      err instanceof ApiError && err.status === 404
        ? 'no such pane, or not yours to see'
        : err instanceof ApiError && err.status === 503
          ? 'this host is offline'
          : 'the hub could not be reached';
    return (
      <div className="mx-empty mx-bad" data-testid="pane-error">
        {msg}
      </div>
    );
  }
  const p = pane.data?.pane;
  const windowPath = p ? `/w/${p.host}/${p.session}/${p.window_index}` : undefined;
  return (
    <div className="mx-pane" data-testid="pane">
      <div className="mx-pane-head">
        {p ? <PaneTitle pane={p} /> : <span>{address}</span>}
        {p && (
          <>
            <span className="mx-dim">
              {address} ·{' '}
              <span data-testid="pane-size">
                {p.width}×{p.height}
              </span>
            </span>
            <span className={`mx-mode ${p.mode}`}>{p.mode}</span>
            {writable && (
              <button
                type="button"
                className={`mx-toggle${fitOn ? ' on' : ''}`}
                onClick={() => setFit(!fitOn)}
                title="size the host pane to this box (f)"
                data-testid="fit"
                data-on={fitOn ? '1' : '0'}
              >
                fit {fitOn ? 'on' : 'off'}
                {fitOn && fitted ? ` ${fitted.cols}×${fitted.rows}` : ''}
              </button>
            )}
            {windowPath && (
              <Link to={windowPath} className="mx-dim" data-testid="to-window">
                window ▸
              </Link>
            )}
            {p.attention && (
              <span className="mx-attention" data-testid="pane-attention">
                <Badge attention={p.attention} /> {p.attention.kind}
                {p.attention.text ? `: ${p.attention.text}` : ''}
              </span>
            )}
          </>
        )}
      </div>
      <Screen
        content={pane.data?.content ?? ''}
        burn={!pane.isPlaceholderData}
        cols={fitOn ? undefined : p?.width}
        rows={fitOn ? undefined : p?.height}
        boxRef={box}
      />
      <form className="mx-input" onSubmit={submit}>
        <span className="mx-prompt">{writable ? '>' : '○'}</span>
        <input
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!writable}
          placeholder={writable ? 'type, Enter sends' : 'read-only pane'}
          aria-label="input"
          autoComplete="off"
          data-testid="input"
        />
        <button type="submit" disabled={!writable}>
          send
        </button>
      </form>
      <KeyBar onKey={(k) => void send({ key: k })} disabled={!writable} />
      {!writable && p && (
        <div className="mx-readonly" data-testid="readonly">
          read-only: your grant or the pane's mark does not allow typing
        </div>
      )}
    </div>
  );
}
