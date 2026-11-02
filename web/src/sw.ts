// The service worker: registered on a built page, with the one thing the
// page needs to know from it, that a new build waits to take over.

// A registration as the page sees it: enough of the browser's shape for
// the logic to be tested without one.
export interface Reg {
  waiting: { postMessage: (m: unknown) => void } | null;
  installing: {
    state: string;
    addEventListener: (ev: 'statechange', fn: () => void) => void;
  } | null;
  addEventListener: (ev: 'updatefound', fn: () => void) => void;
}

// watch calls onWaiting when a new worker is installed while an older one
// controls the page: at once if one waits already, or when the next
// install ends. A first install (no controller) is not an update.
export function watch(reg: Reg, controlled: () => boolean, onWaiting: () => void) {
  if (reg.waiting && controlled()) onWaiting();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener('statechange', () => {
      if (w.state === 'installed' && controlled()) onWaiting();
    });
  });
}

// apply asks the waiting worker to take over; the page reloads when it does.
export function apply(reg: Reg, reload: () => void, onControllerChange: (fn: () => void) => void) {
  onControllerChange(reload);
  reg.waiting?.postMessage('mx-skip-waiting');
}

// A listener the shell sets, for the status bar's line.
let waitingReg: Reg | null = null;
const listeners = new Set<() => void>();

export function onUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function updateWaiting(): boolean {
  return waitingReg !== null;
}

export function reloadWithUpdate() {
  if (!waitingReg) return;
  apply(
    waitingReg,
    () => window.location.reload(),
    (fn) => navigator.serviceWorker.addEventListener('controllerchange', fn, { once: true }),
  );
}

// register installs the worker on a built page, where the browser has
// service workers and the origin is secure (the browser's own rule).
export function register() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        watch(
          reg as unknown as Reg,
          () => !!navigator.serviceWorker.controller,
          () => {
            waitingReg = reg as unknown as Reg;
            for (const fn of listeners) fn();
          },
        );
      })
      .catch(() => {
        // Without a worker the client is what it was.
      });
  });
}
