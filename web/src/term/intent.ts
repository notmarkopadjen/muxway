// A request from elsewhere in the app, the selector, that the pane list
// open its new-session form for a host. Kept until the list listens.
type Listener = (host: string) => void;
let pending: string | null = null;
const listeners = new Set<Listener>();

export function requestSession(host: string) {
  if (listeners.size) listeners.forEach((fn) => fn(host));
  else pending = host;
}

export function onSessionRequest(fn: Listener): () => void {
  listeners.add(fn);
  if (pending) {
    const host = pending;
    pending = null;
    fn(host);
  }
  return () => {
    listeners.delete(fn);
  };
}
