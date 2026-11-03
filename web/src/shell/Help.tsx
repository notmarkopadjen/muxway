import {
  cycleFont,
  cycleOpenMode,
  getFont,
  getMotion,
  getNames,
  getNotify,
  getOpenWith,
  getSuggest,
  getTheme,
  OPEN_COMMAND_MAX,
  setOpenCommand,
  toggleMotion,
  toggleNames,
  toggleNotify,
  toggleSuggest,
  cycleTheme,
  useHelper,
  useSettings,
} from '../settings';
import { forgetRecent, useRecent } from '../term/commands';
import { Box } from '../components/Box';

const KEYS: [string, string][] = [
  ['j / k', 'move down / up'],
  ['space', 'pick a pane, up to four'],
  ['Enter', 'open the selected pane, or the picked ones side by side'],
  ['Esc', 'back to the panes; or leave the input line (first closing its completion list)'],
  ['p', 'go to a pane or window, or start a session'],
  ['I / o', 'the inbox: every pane that waits for you, oldest first / open the oldest'],
  [
    'T / M',
    'messages: what panes said to panes, mail and typed, across hosts, oldest first; Enter lays the two side by side / the same with the line focused, to mail the open pane (nothing is typed for it)',
  ],
  [
    'L',
    'tiles: lay the pane the focused tile talks with beside it (opens it, or swaps it next to the tile); the ⛓ on the header the same. Panes that talk share one frame, on the strip and on the tiles',
  ],
  ['+ / S', "one more pane in the selected row's window / a new session on its host"],
  [
    'N',
    'name the focused pane (or click its tab or its header name again, slowly): the name is its alias, a-z 0-9 and -, shown first everywhere and an address for agents; Enter saves, Esc leaves, empty takes it away',
  ],
  ['/', 'filter panes'],
  ['f', 'fit: the host pane (window view: the window) follows this box, at the chosen font'],
  ['r', 'fit again, after another client sized the window'],
  [
    '] / [',
    "next / previous pane: the tile, or with one tile open the strip's neighbour, round at the ends (window view: pane)",
  ],
  [
    '} / {',
    "move the focused pane's tab one place along the strip (or drag a tab); the order is kept in this browser",
  ],
  [
    '1 – 4 / l / x / F / z / w',
    "tiles: focus one, next arrangement, close the pane on its host (asks y / n; elsewhere the tile), fit all, zoom (one pane alone and back; or double-click a tile, its header or tab), the mirror layout; Shift+click a tab to open it beside; drag a header onto a tile's middle to swap, onto its edge to split",
  ],
  [
    '+ / -',
    'tiles: the add menu (one more pane beside the focused one, a new session, a minimised pane back, any other pane as one more tile) / minimise the focused tile to the row above the keys; a click on its tab there brings it back',
  ],
  [
    'x / z / 0 / = / + / -',
    "window view: hide, this pane alone (or Enter, double-click), host layout, equal shares, bigger, smaller; l (▦): the next arrangement of the window's panes, on the host",
  ],
  [
    'i',
    'direct: keys go to the focused pane as pressed, Esc included; Shift+Esc, a click on the line or the ▮ button leaves. A click on the tile (window view: the cell) the same',
  ],
  [':', 'focus the input line; Esc leaves it'],
  [
    'Enter / Shift+Enter',
    'input line: send (with the list open, the highlighted completion) / a new line',
  ],
  ['Tab', 'input line: take the completion; from an empty line, Tab goes to the pane'],
  ['Shift+Esc', 'input line: send Escape to the pane and keep typing'],
  [
    'K',
    'the keyboard window for the focused pane, open and closed; Esc closes it too. The ⌨ button the same',
  ],
  [
    'v',
    'speak: held, records until released; tapped, again stops; Esc drops it. The ◉ button the same',
  ],
  [
    'click / Shift+click a name',
    "in a writable shell pane on a host with preview roots, a name of the pane's directory on the screen: a directory is entered (cd), a file opens the way *a file opens with* says (the preview window, cat, or your own command with {} for the name) / only the quoted name goes onto the pane's line",
  ],
  [
    'Right / Ctrl+Right',
    'the ghost word: while a shell pane is typed into, direct or on the line, the rest of a line sent before, a command the screen shows, or a name of the directory is drawn dim after the cursor; Right accepts it, Ctrl+Right one word; any other key ignores it; *suggest* turns it off',
  ],
  ['g then a letter', 'jump to the first host starting with it'],
  [
    'H',
    "hubs: the other hubs this browser knows; each signs you in on its own page, once, and the list then shows every hub's panes",
  ],
  ['t', 'next theme (amber, green, paper)'],
  ['m', 'effects on / off'],
  ['n', 'browser notifications on / off'],
  ['?', 'this help'],
];

export function Help({ onClose }: { onClose: () => void }) {
  useSettings();
  const helper = useHelper();
  const recent = useRecent();
  return (
    <div className="mx-help" onClick={onClose} data-testid="help">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title="help" className="mx-help-keys">
          <dl>
            {KEYS.map(([k, d]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{d}</dd>
              </div>
            ))}
          </dl>
          <div className="mx-toggles">
            <button type="button" onClick={() => cycleTheme()}>
              theme: {getTheme()}
            </button>
            <button type="button" onClick={() => toggleMotion()}>
              effects: {getMotion() ? 'on' : 'off'}
            </button>
            <button type="button" onClick={() => cycleFont()} data-testid="font">
              font: {getFont()}px
            </button>
            <button type="button" onClick={() => void toggleNotify()}>
              notifications: {getNotify() ? 'on' : 'off'}
            </button>
            <button type="button" onClick={() => toggleNames()} data-testid="names">
              names: {getNames() ? 'on' : 'off'}
            </button>
            <button type="button" onClick={() => toggleSuggest()} data-testid="suggest">
              suggest: {getSuggest() ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={() => forgetRecent()}
              disabled={!recent.length}
              title="the lines sent to shells from this browser, which the ghost word and the command row draw from"
              data-testid="forget"
            >
              forget {recent.length} sent {recent.length === 1 ? 'line' : 'lines'}
            </button>
            <button type="button" onClick={() => cycleOpenMode()} data-testid="open-with">
              a file opens with: {getOpenWith().mode}
            </button>
            {helper.open.mode === 'command' && (
              <input
                type="text"
                className="mx-open-command"
                data-testid="open-command"
                aria-label="the command a file opens with, {} for its name"
                placeholder="vim {}"
                maxLength={OPEN_COMMAND_MAX}
                value={helper.open.command}
                onChange={(e) => setOpenCommand(e.target.value)}
              />
            )}
            <button type="button" onClick={onClose}>
              close
            </button>
          </div>
        </Box>
      </div>
    </div>
  );
}
