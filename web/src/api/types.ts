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
  zoomed?: boolean;
  mouse?: boolean;
}

export interface Host {
  name: string;
  online: boolean;
  sessions?: boolean; // the agent starts sessions for clients
  close?: boolean; // the agent closes writable panes for clients
  keys?: number; // 2: the agent takes the whole key grammar
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
  | { cols: number; rows: number; scope?: 'pane' | 'window'; layout?: string; zoom?: boolean }
  | { scope: 'window'; layout: string }
  | { fit: 'auto' };

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
  admin?: boolean;
}

export interface AdminToken {
  id: string;
  name: string;
  read: string[];
  write: string[];
  admin: boolean;
  created: number;
  expires: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  read: string[];
  write: string[];
  admin: boolean;
  created: number;
  expires: number;
}

export interface AdminClient {
  kind: 'session' | 'bearer';
  id?: string;
  client: string;
  principal: string;
  method: string;
  addr: string;
  since: number;
  seen: number;
  expires?: number;
}

export interface Access {
  allow: string[];
  deny: string[];
}

export interface AdminOverview {
  hub: {
    version: string;
    tls: boolean;
    trust_proxy: boolean;
    providers: string[];
    transcriber: boolean;
    web: boolean;
    public_url: string;
    session_ttl: number;
  };
  agents: { host: string; online: boolean; paired: number; connected?: number; addr?: string }[];
  tokens: AdminToken[];
  users: AdminUser[];
  clients: AdminClient[];
  locked: { addr: string; until: number }[];
  access: Access;
  you: { id: string; addr: string };
}

export interface LogRecord {
  seq: number;
  at: number;
  level: string;
  msg: string;
  attrs?: Record<string, string>;
}

export interface AuthMethods {
  methods: string[];
  [provider: string]: { label: string } | string[];
}

export const BUTTONS = ['left', 'middle', 'right', 'wheelup', 'wheeldown'] as const;
export type Button = (typeof BUTTONS)[number];
export interface Mouse {
  button: Button;
  x: number;
  y: number;
  count?: number; // wheel notches in one go, 1 to 50
}

export const KEYS = [
  'Enter',
  'Tab',
  'BTab',
  'BSpace',
  'Escape',
  'Space',
  'Up',
  'Down',
  'Left',
  'Right',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Insert',
  'Delete',
  'C-c',
  'C-d',
  'C-z',
  'C-l',
  'C-a',
  'C-e',
  'C-u',
  'C-k',
  'C-w',
  'C-r',
  'C-x',
  'C-n',
  'C-p',
  'C-f',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
] as const;
export type Key = (typeof KEYS)[number];
