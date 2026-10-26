import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { previewFile, readFile } from '../api/queries';
import { size } from './InputPanel';

// A file of the host, shown in a window over the page: an image as
// itself, a PDF in a frame, a text as it is, an archive as its download
// only, with its name, size and a download in the bar. Escape, the bar's × or a click
// outside closes it. A file of the inbox is asked for by name; one the
// pane printed the path of, by that path, from under the host's roots.
export type Shown = { address: string; name: string } | { address: string; path: string };

// Text beyond this is left to the download.
const TEXT_SHOWN = 1 << 20;

function labelOf(s: Shown): string {
  return 'name' in s ? s.name : s.path;
}

function fileNameOf(s: Shown): string {
  return 'name' in s ? s.name : s.path.split('/').pop() || 'file';
}

type Got =
  | { url: string; bytes: number; kind: 'image' | 'pdf' | 'binary' }
  | { url: string; bytes: number; kind: 'text'; text: string; cut: boolean }
  | { error: string };

export function FileWindow({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const [got, setGot] = useState<Got | null>(null);
  const key = 'name' in shown ? `n:${shown.name}` : `p:${shown.path}`;
  useEffect(() => {
    let url: string | undefined;
    let gone = false;
    setGot(null);
    const fetched =
      'name' in shown
        ? readFile(shown.address, shown.name)
        : previewFile(shown.address, shown.path);
    fetched
      .then(async (blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        const typ = blob.type.split(';')[0];
        if (typ.startsWith('image/')) setGot({ url, bytes: blob.size, kind: 'image' });
        else if (typ === 'application/pdf') setGot({ url, bytes: blob.size, kind: 'pdf' });
        else if (!typ.startsWith('text/')) setGot({ url, bytes: blob.size, kind: 'binary' });
        else {
          const text = await blob.slice(0, TEXT_SHOWN).text();
          if (!gone)
            setGot({ url, bytes: blob.size, kind: 'text', text, cut: blob.size > TEXT_SHOWN });
        }
      })
      .catch((err) => {
        if (!gone) setGot({ error: err instanceof ApiError ? err.code : 'hub unreachable' });
      });
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shown.address, key]);
  // Escape closes the window, and nothing else hears it.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const label = labelOf(shown);
  const text = got && 'kind' in got && got.kind === 'text' ? got.text : '';
  const lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
  return (
    <div className="mx-picture-back" data-testid="picture-back" onClick={onClose}>
      <div
        className="mx-picture"
        role="dialog"
        aria-label={label}
        data-testid="picture"
        data-kind={got && 'kind' in got ? got.kind : undefined}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mx-picture-bar">
          <span>┌─ file ─ </span>
          <span className="mx-picture-name" data-testid="picture-name" title={label}>
            {label}
          </span>
          <span className="mx-spacer">─</span>
          {got && 'bytes' in got && (
            <span className="mx-dim" data-testid="picture-size">
              {size(got.bytes)}
              {lines ? ` · ${lines} lines` : ''}
            </span>
          )}
          {got && 'url' in got && (
            <a
              className="mx-picture-download"
              href={got.url}
              download={fileNameOf(shown)}
              title="download"
              data-testid="picture-download"
            >
              ⤓
            </a>
          )}
          <button type="button" onClick={onClose} title="close (Esc)" data-testid="picture-close">
            ×
          </button>
        </div>
        <div className="mx-picture-body">
          {!got ? (
            <span className="mx-dim">loading…</span>
          ) : 'error' in got ? (
            <span className="mx-bad" data-testid="picture-error">
              {got.error === 'not_found'
                ? 'name' in shown
                  ? 'gone from the host'
                  : 'the host does not preview this file'
                : got.error}
            </span>
          ) : got.kind === 'image' ? (
            <img src={got.url} alt={label} data-testid="picture-image" />
          ) : got.kind === 'pdf' ? (
            <iframe src={got.url} title={label} data-testid="picture-frame" />
          ) : got.kind === 'binary' ? (
            <span className="mx-dim" data-testid="picture-binary">
              no preview for this type; ⤓ downloads it
            </span>
          ) : got.kind === 'text' ? (
            <pre className="mx-picture-text" data-testid="picture-text">
              {got.text}
              {got.cut ? '\n… cut at 1 MiB; the download has the rest\n' : ''}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
