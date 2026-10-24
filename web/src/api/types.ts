// Shapes from docs/protocol/v1.md.
export type Kind = 'question' | 'permission' | 'idle' | 'done' | 'working';

export interface Attention {
  kind: Exclude<Kind, 'working'>;
  at: number;
  text?: string;
}

export interface Pane {
  host: string;
  address: string;
  session_id: string;
  session: string;
  window_id: string;
  window_index: number;
  window: string;
  window_layout: string;
  window_active: boolean;
  pane_id: string;
  pane_index: number;
  pane_active: boolean;
  width: number;
  height: number;
  title: string;
  command: string;
  activity: number;
  mode: 'read' | 'write';
  alias?: string;
  attention?: Attention;
}

export interface Host {
  name: string;
  online: boolean;
}

export interface Window {
  index: number;
  name: string;
  layout: string;
  active: boolean;
  panes: Pane[];
}

export interface Session {
  name: string;
  windows: Window[];
}

export interface Tree {
  host: string;
  sessions: Session[];
}

export interface PaneContent {
  pane: Pane;
  content: string;
}

export interface WindowContent {
  host: string;
  session: string;
  window: { index: number; name: string; layout: string; active: boolean };
  panes: PaneContent[];
}

export type Resize =
  { cols: number; rows: number; scope?: 'pane' | 'window'; layout?: string } | { fit: 'auto' };

export interface Event {
  seq: number;
  at: number;
  host: string;
  address: string;
  pane_id: string;
  alias?: string;
  kind: Kind;
  text?: string;
}

export interface Events {
  events: Event[];
  next: number;
}

export interface Me {
  id: string;
  name: string;
  method: string;
  read: string[];
  write: string[];
  expires: number;
}

export interface AuthMethods {
  methods: string[];
  [provider: string]: { label: string } | string[];
}

export const KEYS = [
  'Enter',
  'Tab',
  'BSpace',
  'Escape',
  'Up',
  'Down',
  'Left',
  'Right',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'C-c',
  'C-d',
  'C-z',
  'C-l',
] as const;
export type Key = (typeof KEYS)[number];
