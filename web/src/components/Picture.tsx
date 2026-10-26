import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { readFile } from '../api/queries';
import { isImage } from '../term/links';
import { size } from './InputPanel';

// A file of the host's inbox, shown in a window over the page: an image
// as itself, with its name and size in the bar. Escape, the bar's × or a
// click outside closes it. Any other type opens in a tab of its own.
export interface Shown {
  address: string;
  name: string;
}

// What a click on a file link does: an image goes to the window, the
// rest to a new tab, filled once the bytes are here so the tab is the
// click's own and not a popup.
export function showFile(s: Shown, open: (s: Shown) => void, refused: (why: string) => void) {
  if (isImage(s.name)) {
    open(s);
    return;
  }
  const tab = window.open('', '_blank');
  readFile(s.address, s.name)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
    })
    .catch((err) => {
      tab?.close();
      refused(err instanceof ApiError ? err.code : 'hub unreachable');
    });
}

export function Picture({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const { address, name } = shown;
  const [got, setGot] = useState<{ url?: string; bytes?: number; error?: string }>({});
  useEffect(() => {
    let url: string | undefined;
    let gone = false;
    setGot({});
    readFile(address, name)
      .then((blob) => {
        if (gone) return;
        url = URL.createObjectURL(blob);
        setGot({ url, bytes: blob.size });
      })
      .catch((err) => {
        if (!gone) setGot({ error: err instanceof ApiError ? err.code : 'hub unreachable' });
      });
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [address, name]);
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
  return (
    <div className="mx-picture-back" data-testid="picture-back" onClick={onClose}>
      <div
        className="mx-picture"
        role="dialog"
        aria-label={name}
        data-testid="picture"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mx-picture-bar">
          <span>┌─ file ─ </span>
          <span className="mx-picture-name" data-testid="picture-name">
            {name}
          </span>
          <span className="mx-spacer">─</span>
          {got.bytes !== undefined && <span className="mx-dim">{size(got.bytes)}</span>}
          <button type="button" onClick={onClose} title="close (Esc)" data-testid="picture-close">
            ×
          </button>
        </div>
        <div className="mx-picture-body">
          {got.url ? (
            <img src={got.url} alt={name} data-testid="picture-image" />
          ) : got.error ? (
            <span className="mx-bad" data-testid="picture-error">
              {got.error === 'not_found' ? 'gone from the host' : got.error}
            </span>
          ) : (
            <span className="mx-dim">loading…</span>
          )}
        </div>
      </div>
    </div>
  );
}
