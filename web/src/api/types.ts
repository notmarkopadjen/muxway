// Shapes from docs/protocol/v1.md.
export type Kind = 'question' | 'permission' | 'idle' | 'done' | 'working';

export interface Attention {
  kind: Exclude<Kind, 'working'>;
  at: number;
  text?: string;
  choices?: string[]; // a question asked with fixed answers (muxway ask)
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
  cursor_x?: number; // the cursor's cell, 1-based, where the program waits
  cursor_y?: number;
  last?: boolean; // the only pane of its session: closing it ends the session
  talk?: TalkPartner[]; // the panes this one talked with in the last ten minutes
  mail?: MailState; // mail its process has not read
  hub?: string; // the hub of the hubs box it came from; none for this page's own
}

// What waits in a pane's mailbox: how many unread, and when the newest came.
export interface MailState {
  unread: number;
  at: number;
}

// A pane another pane talked with lately, at its current address.
export interface TalkPartner {
  address: string;
  pane_id: string;
  at: number;
  way: 'to' | 'from' | 'both';
}

// One entry of the talk feed: a mail or a write from one pane to another.
// A mail from a client that is not a pane has no `from`.
export interface Talk {
  seq: number;
  at: number;
  actor: { id: string; name: string };
  from: TalkEnd | null;
  to: TalkEnd;
  kind: 'text' | 'key' | 'answer' | 'mail';
  bytes?: number;
  text: string;
  id?: number; // a mail's id
  reply_to?: number; // the mail a reply answers
  hub?: string; // as on a pane
}

export interface TalkEnd {
  host: string;
  address: string;
  pane_id: string;
  alias?: string;
}

export interface Host {
  name: string;
  online: boolean;
  sessions?: boolean; // the agent starts sessions for clients
  close?: boolean; // the agent closes writable panes for clients
  keys?: number; // 2: the agent takes the whole key grammar
  preview?: boolean; // the agent serves files under roots its owner named
  repeat?: boolean; // the agent takes a count with a key
  ask?: boolean; // the agent takes answers to questions
  mail?: boolean; // the agent holds mail for its panes
  hub?: string; // as on a pane
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
  trimmed?: number; // blank rows at the screen's bottom left out of content
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
  choices?: string[];
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

// Git's view of the repository a pane works in, from under the host's
// preview roots: see GET /v1/panes/{address}/git.
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflict';
export interface Change {
  path: string;
  from?: string; // the old path of a rename
  kind: ChangeKind;
  staged?: boolean;
}
export interface Changes {
  root: string;
  branch: string;
  ahead?: number;
  behind?: number;
  truncated?: boolean;
  entries: Change[];
}
// One change's diff against the last commit.
export interface Diff {
  diff: string;
  binary?: boolean;
  cut?: boolean;
}
