import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// Transient notices, bottom right, dismissed by a click or after a while.
export interface ToastItem {
  id: number;
  kind: string;
  title: ReactNode;
  meta?: string;
  text?: string;
  onClick?: () => void;
  // Fixed answers a question offers, taken without opening the pane.
  actions?: { label: string; onClick: () => void }[];
}

interface ToastApi {
  push: (t: Omit<ToastItem, 'id'>) => void;
  toasts: ToastItem[];
}

const Ctx = createContext<ToastApi | null>(null);
const TTL = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = next.current++;
      setToasts((l) => [...l.slice(-4), { ...t, id }]);
      window.setTimeout(() => dismiss(id), TTL);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ push, toasts }), [push, toasts]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="mx-toaster" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="mx-toast"
            data-testid="toast"
            onClick={() => {
              dismiss(t.id);
              t.onClick?.();
            }}
          >
            <span className="mx-kind">{t.kind}</span>
            {t.title}
            {t.meta && <span className="mx-dim"> {t.meta}</span>}
            {t.text && <span className="mx-text">{t.text}</span>}
            {t.actions && (
              <span className="mx-choices" data-testid="toast-choices">
                {t.actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dismiss(t.id);
                      a.onClick();
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('ToastProvider missing');
  return api;
}
