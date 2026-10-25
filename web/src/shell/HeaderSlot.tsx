import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The header has one row: the brand, then what the view puts there (the
// pane view its tabs and buttons), then the profile button. A view puts
// its part in through InHeader.
export const HeaderSlot = createContext<HTMLElement | null>(null);

export function InHeader({ children }: { children: ReactNode }) {
  const el = useContext(HeaderSlot);
  return el ? createPortal(children, el) : null;
}
