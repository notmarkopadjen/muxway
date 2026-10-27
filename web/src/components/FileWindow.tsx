import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { previewFile, readDiff, readFile } from '../api/queries';
import type { ChangeKind, Diff } from '../api/types';
import { setPreview, usePreview } from '../settings';
import { viewsOf } from '../term/changes';
import { languageOf } from '../term/code';
import { Code, render } from '../term/markdown';
import { size } from './InputPanel';

// A file of the host, shown in a window over the page: an image as
// itself, a PDF in a frame, a text as it is, an archive as its download
// only, with its name, size and a download in the bar. Escape, the bar's × or a click
// outside closes it. A file of the inbox is asked for by name; one the
// pane printed the path of, by that path, from under the host's roots. A
// change of the repository opens with a diff / file switch: its diff
// against the last commit, or the file as the preview shows it.
export type Shown =
  | { address: string; name: string }
  | { address: string; path: string; change?: { kind: ChangeKind; root: string } };

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

// A diff drawn as rows of text: added rows in the ok colour, removed
// rows dim and struck, hunk and file headers dim.
function rowKind(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'h';
  if (line.startsWith('+')) return '+';
  if (line.startsWith('-')) return '-';
  if (line.startsWith('@@')) return '@';
  if (
    /^(diff |index |similarity |rename |new file|deleted file|old mode|new mode|Binary files)/.test(
      line,
    )
  )
    return 'h';
  return ' ';
}

function DiffView({ diff }: { diff: Diff }) {
  if (diff.binary)
    return (
      <span className="mx-dim" data-testid="diff-binary">
        a binary file: no text to show
      </span>
    );
  const lines = diff.diff.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return (
    <pre className="mx-picture-text mx-diff" data-testid="diff">
      {lines.map((l, i) => (
        <span key={i} className="mx-diff-line" data-d={rowKind(l)}>
          {l}
          {'\n'}
        </span>
      ))}
      {diff.cut ? <span className="mx-dim">… cut at 1 MiB\n</span> : null}
      {!lines.length ? <span className="mx-dim">no difference\n</span> : null}
    </pre>
  );
}

export function FileWindow({
  shown,
  onClose,
  onFile,
  onPath,
}: {
  shown: Shown;
  onClose: () => void;
  onFile?: (name: string) => void;
  onPath?: (path: string) => void;
}) {
  const [got, setGot] = useState<Got | null>(null);
  const view = usePreview();
  const name = fileNameOf(shown);
  const markdown = /\.(md|markdown)$/i.test(name);
  const lang = languageOf(name);
  // A change's path is the repository's; the file is read by its whole path.
  const change = 'change' in shown ? shown.change?.kind : undefined;
  const views = change ? viewsOf(change) : [];
  const key = 'name' in shown ? `n:${shown.name}` : `p:${shown.path}:${change ?? ''}`;
  const filePath =
    'path' in shown ? (shown.change ? `${shown.change.root}/${shown.path}` : shown.path) : '';
  // A change opens on its diff when it has one; the file is a click away,
  // and each is fetched once.
  const [side, setSide] = useState<'diff' | 'file'>(views[0] ?? 'file');
  const [diff, setDiff] = useState<Diff | { error: string } | null>(null);
  // Which of the two has been wanted for this key: once wanted, fetched
  // and kept until the key changes, so a switch back shows it at once.
  const [wanted, setWanted] = useState({ key, file: false, diff: false });
  const wantDiff = side === 'diff' && !!change;
  const wantFile = side === 'file' || !change;
  if (wanted.key !== key) {
    setWanted({ key, file: wantFile, diff: wantDiff });
    setSide(views[0] ?? 'file');
  } else if ((wantDiff && !wanted.diff) || (wantFile && !wanted.file)) {
    setWanted({ key, file: wanted.file || wantFile, diff: wanted.diff || wantDiff });
  }
  const fetchDiff = wanted.key === key && wanted.diff;
  const fetchFile = wanted.key === key && wanted.file;
  useEffect(() => {
    if (!fetchDiff || !('path' in shown)) return;
    let gone = false;
    setDiff(null);
    readDiff(shown.address, shown.path)
      .then((d) => {
        if (!gone) setDiff(d);
      })
      .catch((err) => {
        if (!gone) setDiff({ error: err instanceof ApiError ? err.code : 'hub unreachable' });
      });
    return () => {
      gone = true;
    };
  }, [shown, key, fetchDiff]);
  useEffect(() => {
    if (!fetchFile) return;
    let url: string | undefined;
    let gone = false;
    setGot(null);
    const fetched =
      'name' in shown ? readFile(shown.address, shown.name) : previewFile(shown.address, filePath);
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
  }, [shown, key, fetchFile]);
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
          <span>{change ? '┌─ change ─ ' : '┌─ file ─ '}</span>
          <span className="mx-picture-name" data-testid="picture-name" title={label}>
            {label}
          </span>
          <span className="mx-spacer">─</span>
          {side !== 'diff' && got && 'bytes' in got && (
            <span className="mx-dim" data-testid="picture-size">
              {size(got.bytes)}
              {lines ? ` · ${lines} lines` : ''}
            </span>
          )}
          {views.length > 1 && (
            <span className="mx-picture-view" data-testid="picture-side" data-view={side}>
              <button
                type="button"
                className={side === 'diff' ? 'on' : undefined}
                onClick={() => setSide('diff')}
                title="the change against the last commit"
                data-testid="picture-diff"
              >
                diff
              </button>
              <button
                type="button"
                className={side === 'file' ? 'on' : undefined}
                onClick={() => setSide('file')}
                title="the file as it is now"
                data-testid="picture-file"
              >
                file
              </button>
            </span>
          )}
          {markdown && side !== 'diff' && got && 'kind' in got && got.kind === 'text' && (
            <span className="mx-picture-view" data-testid="picture-view" data-view={view}>
              <button
                type="button"
                className={view === 'rendered' ? 'on' : undefined}
                onClick={() => setPreview('rendered')}
                title="the file rendered"
                data-testid="picture-rendered"
              >
                rendered
              </button>
              <button
                type="button"
                className={view === 'plain' ? 'on' : undefined}
                onClick={() => setPreview('plain')}
                title="the file as it is"
                data-testid="picture-plain"
              >
                plain
              </button>
            </span>
          )}
          {side !== 'diff' && got && 'url' in got && (
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
          {wantDiff ? (
            !diff ? (
              <span className="mx-dim">loading…</span>
            ) : 'error' in diff ? (
              <span className="mx-bad" data-testid="picture-error">
                {diff.error === 'not_found' ? 'the host has no diff for this path' : diff.error}
              </span>
            ) : (
              <DiffView diff={diff} />
            )
          ) : !got ? (
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
          ) : got.kind === 'text' && markdown && view === 'rendered' ? (
            <div className="mx-picture-text mx-md" data-testid="picture-rendered-body">
              {render(got.text, { onFile, onPath })}
              {got.cut ? <p className="mx-dim">… cut at 1 MiB; the download has the rest</p> : null}
            </div>
          ) : got.kind === 'text' && lang ? (
            <div className="mx-picture-text" data-testid="picture-text" data-lang={lang}>
              <Code
                lang={lang}
                text={got.text + (got.cut ? '\n… cut at 1 MiB; the download has the rest\n' : '')}
              />
            </div>
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
