import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

// Who is signed in, as a button; behind it what used to line the header:
// the hubs, the help, the admin page for an admin, and logging out.
export function Profile({
  name,
  admin,
  onHubs,
  onHelp,
  onLogout,
}: {
  name: string;
  admin: boolean;
  onHubs: () => void;
  onHelp: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="mx-profile" ref={box}>
      <button
        type="button"
        className={`mx-profile-button${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="who"
      >
        {name} <span className="mx-caret">▾</span>
      </button>
      {open && (
        <div className="mx-menu" role="menu" data-testid="profile-menu">
          <button type="button" role="menuitem" onClick={pick(onHubs)} data-testid="open-hubs">
            hubs <kbd>H</kbd>
          </button>
          <button type="button" role="menuitem" onClick={pick(onHelp)} data-testid="open-help">
            help <kbd>?</kbd>
          </button>
          {admin && (
            <Link
              to="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              data-testid="open-admin"
            >
              admin
            </Link>
          )}
          <button type="button" role="menuitem" onClick={pick(onLogout)} data-testid="logout">
            logout
          </button>
        </div>
      )}
    </div>
  );
}
