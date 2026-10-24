import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Box } from '../components/Box';
import {
  addHub,
  checkHub,
  fragment,
  removeHub,
  renameHub,
  shownName,
  useHubs,
  HUB_NAME,
} from '../hubs';

// The hubs box: the hubs this browser knows, the current one marked, and
// a plain link to each other one. Going there is a navigation to that
// hub's own page and sign-in; the list goes along in the fragment when
// asked, nothing else does.
export function Hubs({ onClose }: { onClose: () => void }) {
  const hubs = useHubs();
  const here = location.origin;
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [error, setError] = useState('');
  const [carry, setCarry] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const problem = checkHub(n, url, hubs);
    if (problem) {
      setError(problem);
      return;
    }
    addHub(n, url);
    setName('');
    setUrl('https://');
    setError('');
  };
  const rename = (hubUrl: string) => {
    const n = draft.trim();
    if (n === '' && hubUrl !== here) return;
    if (n !== '' && (!HUB_NAME.test(n) || hubs.some((h) => h.name === n && h.url !== hubUrl))) {
      setError('name: a-z, 0-9 and -, up to 32, not taken');
      return;
    }
    renameHub(hubUrl, n);
    setEditing(null);
    setError('');
  };
  const carried = carry ? fragment(hubs) : '';

  return (
    <div className="mx-help" onClick={onClose} data-testid="hubs">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title="hubs" enter={false}>
          <ul className="mx-hubs">
            {hubs.map((h) => (
              <li key={h.url} data-testid="hub-row" data-url={h.url}>
                <span className="mx-hub-mark">{h.url === here ? '▸' : ' '}</span>
                {editing === h.url ? (
                  <input
                    className="mx-hub-name"
                    value={draft}
                    autoFocus
                    aria-label="new name"
                    data-testid="hub-rename"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') rename(h.url);
                      else if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    onBlur={() => rename(h.url)}
                  />
                ) : (
                  <button
                    type="button"
                    className="mx-hub-name"
                    title="rename"
                    data-testid="hub-name"
                    onClick={() => {
                      setDraft(h.name);
                      setEditing(h.url);
                    }}
                  >
                    {shownName(h)}
                  </button>
                )}
                <span className="mx-hub-url">{h.url}</span>
                {h.url === here ? (
                  <span className="mx-dim">here</span>
                ) : (
                  <>
                    <a href={h.url + '/' + carried} rel="noreferrer" data-testid="hub-go">
                      go
                    </a>
                    <button
                      type="button"
                      title="remove"
                      data-testid="hub-remove"
                      onClick={() => removeHub(h.url)}
                    >
                      ×
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <form className="mx-hub-add" onSubmit={add}>
            <input
              ref={field}
              value={name}
              placeholder="name"
              aria-label="name"
              maxLength={32}
              data-testid="hub-add-name"
              onChange={(e) => setName(e.target.value)}
            />
            <input
              value={url}
              placeholder="https://hub.example.com"
              aria-label="url"
              data-testid="hub-add-url"
              onChange={(e) => setUrl(e.target.value)}
            />
            <button type="submit" data-testid="hub-add">
              add
            </button>
          </form>
          {error && (
            <div className="mx-error" role="alert" data-testid="hub-error">
              {error}
            </div>
          )}
          <div className="mx-toggles">
            <button
              type="button"
              title="names and addresses only"
              data-testid="hub-carry"
              onClick={() => setCarry((c) => !c)}
            >
              carry this list along when going: {carry ? 'on' : 'off'}
            </button>
            <button type="button" onClick={onClose}>
              close
            </button>
          </div>
          <p className="mx-dim mx-hub-note">
            each hub signs you in on its own page; nothing but these links is shared.
          </p>
        </Box>
      </div>
    </div>
  );
}
