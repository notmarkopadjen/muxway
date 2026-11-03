import type { Mail, Talk } from '../api/types';

// The rows of a pane's mail window: what came into its mailbox, what it
// sent, and what the owner (a client that is not a pane) mailed to the
// panes it talks with, from the feed, merged by time. A sent mail's
// whole text comes from the recipient's mailbox when the token reads
// that pane; else the feed's excerpt, marked cut.

export interface MailRow {
  key: string;
  dir: 'in' | 'out';
  // The other pane: its address and id, or nothing for a client that is
  // not a pane (the owner's own mail).
  who?: { address: string; pane_id: string };
  at: number;
  actor: string;
  text: string;
  cut?: boolean;
  id?: number;
  replyTo?: number;
  unread?: boolean;
  replied?: boolean;
  // Sent by a client that is not a pane: the owner's own.
  yours?: boolean;
}

export interface Self {
  host: string;
  pane_id: string;
  address: string;
}

export function mailRows(
  self: Self,
  box: Mail[] | undefined,
  feed: Talk[] | undefined,
  partnerBoxes: Record<string, Mail[]>,
): MailRow[] {
  const rows: MailRow[] = [];
  for (const m of box ?? []) {
    rows.push({
      key: `in${m.id}`,
      dir: 'in',
      who: m.from ? { address: m.from.address, pane_id: m.from.pane_id } : undefined,
      at: m.at,
      actor: m.actor.name,
      text: m.text,
      id: m.id,
      replyTo: m.reply_to,
      unread: !m.read_at,
      replied: m.replied,
    });
  }
  const own = (feed ?? []).filter(
    (e) =>
      e.kind === 'mail' &&
      e.from &&
      e.from.host === self.host &&
      e.from.pane_id === self.pane_id &&
      !(e.to.host === self.host && e.to.pane_id === self.pane_id),
  );
  const sent = (e: Talk, yours?: boolean): MailRow => {
    const whole = partnerBoxes[e.to.address]?.find((m) => m.id === e.id);
    return {
      key: `out${e.hub ?? ''}${e.seq}`,
      dir: 'out',
      who: { address: e.to.address, pane_id: e.to.pane_id },
      at: e.at,
      actor: e.actor.name,
      text: whole ? whole.text : e.text,
      cut: !whole && (e.bytes ?? e.text.length) > e.text.length,
      id: e.id,
      replyTo: e.reply_to,
      unread: whole ? !whole.read_at : undefined,
      replied: whole?.replied,
      yours,
    };
  };
  for (const e of own) rows.push(sent(e));
  // The owner's mail to the panes of this conversation, the mail window
  // being where it was written.
  const partners = new Set(rows.map((r) => r.who?.address).filter((a) => a !== undefined));
  for (const e of feed ?? [])
    if (e.kind === 'mail' && !e.from && partners.has(e.to.address)) rows.push(sent(e, true));
  return rows.sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
}

// The panes a window's rows name, newest first, without the pane itself.
export function partnersOf(rows: MailRow[], self: string): string[] {
  const seen = new Set<string>();
  for (const r of [...rows].reverse()) if (r.who && r.who.address !== self) seen.add(r.who.address);
  return [...seen];
}
