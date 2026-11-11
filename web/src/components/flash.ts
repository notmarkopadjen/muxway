// A rate limit is shown as a flash of the page's edge, not a toast: a
// burst of keys that trips the hub's limit says nothing the owner can
// act on, and toasts would pile up over the pane. The root carries
// `data-flash` while it lasts; a refusal during the flash starts the
// time again, so a burst is one flash that ends with it.
export const FLASH_MS = 1800;

export interface FlashPort {
  set: () => void;
  clear: () => void;
  after: (ms: number, f: () => void) => number;
  cancel: (id: number) => void;
}

const dom: FlashPort = {
  set: () => document.documentElement.setAttribute('data-flash', ''),
  clear: () => document.documentElement.removeAttribute('data-flash'),
  after: (ms, f) => window.setTimeout(f, ms),
  cancel: (id) => window.clearTimeout(id),
};

export function makeFlash(port: FlashPort = dom) {
  let timer: number | null = null;
  return () => {
    if (timer !== null) port.cancel(timer);
    else port.set();
    timer = port.after(FLASH_MS, () => {
      timer = null;
      port.clear();
    });
  };
}

export const flash = makeFlash();

// Whether a refused request is shown as the flash rather than a toast.
export const isFlash = (kind: string, title: unknown) =>
  kind === 'refused' && title === 'rate_limited';
