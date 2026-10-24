import { describe, expect, it } from 'vitest';
import { checkHub, fragment, fromFragment, hubOrigin, normalize, shownName } from './hubs';

const HOME = 'https://hub.example.com';
const WORK = 'https://work.example.com';

describe('hubOrigin', () => {
  it('takes an https origin, with a port, and loopback over http', () => {
    expect(hubOrigin(WORK)).toBe(WORK);
    expect(hubOrigin(' https://work.example.com/ ')).toBe(WORK);
    expect(hubOrigin('https://work.example.com:8443')).toBe('https://work.example.com:8443');
    expect(hubOrigin('http://localhost:7600')).toBe('http://localhost:7600');
    expect(hubOrigin('http://127.0.0.1:7600/')).toBe('http://127.0.0.1:7600');
  });
  it('refuses other schemes, plain http, paths, queries and credentials', () => {
    for (const s of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'file:///etc/passwd',
      'http://work.example.com',
      'https://work.example.com/panes',
      'https://work.example.com/?x=1',
      'https://work.example.com/#hubs=[]',
      'https://alice:pw@work.example.com',
      'https://alice@work.example.com',
      'work.example.com',
      '',
    ])
      expect(hubOrigin(s), s).toBeNull();
  });
});

describe('normalize', () => {
  it('puts this page first and keeps well shaped entries, one per origin', () => {
    expect(normalize(null, HOME)).toEqual([{ name: '', url: HOME }]);
    expect(
      normalize(
        [
          { name: 'work', url: WORK + '/' },
          { name: 'again', url: WORK },
          { name: 'home', url: HOME },
          { name: 'Bad Name', url: 'https://x.example.com' },
          { name: 'evil', url: 'javascript:alert(1)' },
          { name: 'nameless', url: 'https://y.example.com', extra: 1 },
          { url: 'https://z.example.com' },
          'junk',
        ],
        HOME,
      ),
    ).toEqual([
      { name: 'home', url: HOME },
      { name: 'work', url: WORK },
      { name: 'nameless', url: 'https://y.example.com' },
    ]);
  });
  it('shows an unnamed hub by its host', () => {
    expect(shownName({ name: '', url: 'https://hub.example.com:8443' })).toBe(
      'hub.example.com:8443',
    );
    expect(shownName({ name: 'home', url: HOME })).toBe('home');
  });
});

describe('checkHub', () => {
  const hubs = [
    { name: 'home', url: HOME },
    { name: 'work', url: WORK },
  ];
  it('refuses a bad name, a bad url, a known hub and a taken name', () => {
    expect(checkHub('Work', WORK, hubs)).toMatch(/name/);
    expect(checkHub('lab', 'http://lab.example.com', hubs)).toMatch(/url/);
    expect(checkHub('lab', WORK, hubs)).toMatch(/in the list/);
    expect(checkHub('work', 'https://lab.example.com', hubs)).toMatch(/taken/);
    expect(checkHub('lab', 'https://lab.example.com', hubs)).toBeNull();
  });
});

describe('fragment', () => {
  it('round-trips names and origins, drops a bad entry and keeps the rest', () => {
    const hubs = [
      { name: 'home', url: HOME },
      { name: 'work', url: WORK },
    ];
    const got = fromFragment(fragment(hubs), [{ name: '', url: WORK }], WORK);
    expect(got).toEqual([
      { name: 'work', url: WORK },
      { name: 'home', url: HOME },
    ]);
    const bad =
      '#hubs=' +
      encodeURIComponent(JSON.stringify([...hubs, { name: 'x', url: 'javascript:alert(1)' }]));
    expect(fromFragment(bad, [{ name: '', url: WORK }], WORK)).toEqual(got);
    expect(fromFragment('#hubs=%7Bnot', [{ name: '', url: WORK }], WORK)).toEqual([
      { name: '', url: WORK },
    ]);
    expect(fromFragment('#other', [], WORK)).toBeNull();
    expect(fromFragment('', [], WORK)).toBeNull();
  });
  it('leaves an unnamed first entry out of what is carried', () => {
    expect(
      fragment([
        { name: '', url: HOME },
        { name: 'work', url: WORK },
      ]),
    ).toBe('#hubs=' + encodeURIComponent(JSON.stringify([{ name: 'work', url: WORK }])));
  });
});
