import {
  cycleFont,
  getFont,
  getMotion,
  getNotify,
  getTheme,
  toggleMotion,
  toggleNotify,
  cycleTheme,
  useSettings,
} from '../settings';
import { Box } from '../components/Box';

const KEYS: [string, string][] = [
  ['j / k', 'move down / up'],
  ['space', 'pick a pane, up to four'],
  ['Enter', 'open the selected pane, or the picked ones side by side'],
  ['Esc', 'back to the panes; or leave the input line (first closing its completion list)'],
  ['p', 'go to a pane or window, or start a session'],
  ['+ / S', "one more pane in the selected row's window / a new session on its host"],
  ['/', 'filter panes'],
  ['f', 'fit: the host pane (window view: the window) follows this box, at the chosen font'],
  ['r', 'fit again, after another client sized the window'],
  [
    '] / [',
    "next / previous pane: the tile, or with one tile open the strip's neighbour, round at the ends (window view: pane)",
  ],
  [
    '1 – 4 / l / x / F / z / w',
    "tiles: focus one, next arrangement, close the pane on its host (asks y / n; elsewhere the tile), fit all, zoom (one pane alone and back; or double-click a tile, its header or tab), the mirror layout; Shift+click a tab to open it beside; drag a header onto a tile's middle to swap, onto its edge to split",
  ],
  [
    'x / z / 0 / = / + / -',
    'window view: hide, this pane alone (or Enter, double-click), host layout, equal shares, bigger, smaller',
  ],
  ['i', 'focus the input line; Esc leaves it'],
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
  ['g then a letter', 'jump to the first host starting with it'],
  ['H', 'hubs: the other hubs this browser knows, as links; each signs you in on its own page'],
  ['t', 'next theme (amber, green, paper)'],
  ['m', 'effects on / off'],
  ['n', 'browser notifications on / off'],
  ['?', 'this help'],
];

export function Help({ onClose }: { onClose: () => void }) {
  useSettings();
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
            <button type="button" onClick={onClose}>
              close
            </button>
          </div>
        </Box>
      </div>
    </div>
  );
}
