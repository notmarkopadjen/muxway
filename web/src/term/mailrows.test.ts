import { describe, expect, it } from 'vitest';
import type { Mail, Talk } from '../api/types';
import { mailRows, partnersOf } from './mailrows';

const self = { host: 'alice-laptop', pane_id: '%1', address: 'alice-laptop/work/0.0' };
const build = { host: 'alice-laptop', address: 'alice-laptop/work/0.1', pane_id: '%2' };
const review = { host: 'alice-laptop', address: 'alice-laptop/work/0.2', pane_id: '%3' };
const me = { host: 'alice-laptop', address: self.address, pane_id: self.pane_id };

const box: Mail[] = [
  { id: 7, at: 100, actor: { id: 'a', name: 'reviewer' }, from: build, text: 'run the tests' },
  {
    id: 9,
    at: 300,
    actor: { id: 'b', name: 'alice' },
    from: null,
    text: 'ok, go ahead',
    read_at: 310,
    replied: true,
  },
];
const feed: Talk[] = [
  {
    seq: 1,
    at: 100,
    actor: { id: 'a', name: 'reviewer' },
    from: build,
    to: me,
    kind: 'mail',
    text: 'run the tests',
    id: 7,
  },
  {
    seq: 2,
    at: 200,
    actor: { id: 'r', name: 'reply' },
    from: me,
    to: build,
    kind: 'mail',
    text: 'tests green',
    id: 8,
    reply_to: 7,
  },
  {
    seq: 3,
    at: 250,
    actor: { id: 'c', name: 'console' },
    from: me,
    to: review,
    kind: 'mail',
    text: 'x'.repeat(200),
    id: 10,
    bytes: 900,
  },
  {
    seq: 4,
    at: 260,
    actor: { id: 'c', name: 'console' },
    from: me,
    to: me,
    kind: 'mail',
    text: 'to myself',
    id: 11,
  },
  {
    seq: 5,
    at: 270,
    actor: { id: 'c', name: 'console' },
    from: me,
    to: build,
    kind: 'text',
    text: 'ls',
  },
  {
    seq: 6,
    at: 280,
    actor: { id: 'o', name: 'alice' },
    from: null,
    to: build,
    kind: 'mail',
    text: 'merge it',
    id: 12,
  },
  {
    seq: 7,
    at: 290,
    actor: { id: 'o', name: 'alice' },
    from: null,
    to: { host: 'alice-laptop', address: 'alice-laptop/work/0.9', pane_id: '%9' },
    kind: 'mail',
    text: 'elsewhere',
    id: 13,
  },
];

describe('the mail window rows', () => {
  it('merges what came in and what went out by time, whole where the partner reads', () => {
    const rows = mailRows(self, box, feed, {
      [build.address]: [
        {
          id: 8,
          at: 200,
          actor: { id: 'r', name: 'reply' },
          from: me,
          text: 'tests green, two warnings',
          read_at: 201,
          reply_to: 7,
        },
      ],
    });
    expect(rows.map((r) => [r.dir, r.who?.address ?? 'you', r.text, r.cut ?? false])).toEqual([
      ['in', build.address, 'run the tests', false],
      ['out', build.address, 'tests green, two warnings', false],
      ['out', review.address, 'x'.repeat(200), true],
      ['out', build.address, 'merge it', false],
      ['in', 'you', 'ok, go ahead', false],
    ]);
    // The owner's own mail to a pane of the conversation is a row; to a
    // pane outside it, not.
    expect(rows[3].yours).toBe(true);
    expect(rows.some((r) => r.text === 'elsewhere')).toBe(false);
    expect(rows[0].unread).toBe(true);
    expect(rows[1].unread).toBe(false);
    expect(rows[1].replyTo).toBe(7);
    expect(rows[2].unread).toBeUndefined();
    expect(rows[4].unread).toBe(false);
    expect(rows[4].replied).toBe(true);
  });

  it('names the partners, newest first, never the pane itself', () => {
    const rows = mailRows(self, box, feed, {});
    expect(partnersOf(rows, self.address)).toEqual([build.address, review.address]);
  });

  it('is empty without a mailbox or a feed', () => {
    expect(mailRows(self, undefined, undefined, {})).toEqual([]);
  });
});
