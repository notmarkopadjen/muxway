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
  ['p', 'go to a pane or window'],
  ['/', 'filter panes'],
  ['f', 'fit: the host pane (window view: the window) follows this box, at the chosen font'],
  ['r', 'fit again, after another client sized the window'],
  ['b', 'the main board; from a pane: put it on the board'],
  [
    '] / [',
    "next / previous pane: the tile, or with one tile open the strip's neighbour (window view and board: pane)",
  ],
  [
    '1 – 4 / l / x / F / z',
    'tiles: focus one, next arrangement, close, fit all, the whole window (or double-click); Shift+click a tab to open it beside',
  ],
  [
    'x / z / 0 / = / + / -',
    'window view: hide, this pane alone (or Enter, double-click), host layout, equal shares, bigger, smaller',
  ],
  [
    'a / A / x / s / z / = / F / w',
    'board: add beside / below, remove, swap, zoom (or double-click), equalise, fit all, its window',
  ],
  ['i', 'focus the input line; Esc leaves it'],
  [
    'Enter / Shift+Enter',
    'input line: send (with the list open, the highlighted completion) / a new line',
  ],
  ['Tab', 'input line: take the completion; from an empty line, Tab goes to the pane'],
  ['Shift+Esc', 'input line: send Escape to the pane and keep typing'],
  ['v', 'speak: record a clip for the hub to transcribe onto the line; again stops, Esc drops it'],
  ['g then a letter', 'jump to the first host starting with it'],
  ['t', 'next theme (green, amber, paper)'],
  ['m', 'effects on / off'],
  ['n', 'browser notifications on / off'],
  ['?', 'this help'],
];

export function Help({ onClose }: { onClose: () => void }) {
  useSettings();
  return (
    <div className="mx-help" onClick={onClose} data-testid="help">
      <div onClick={(e) => e.stopPropagation()}>
        <Box title="help">
          <dl>
            {KEYS.map(([k, d]) => (
              <>
                <dt key={k + 'k'}>{k}</dt>
                <dd key={k + 'd'}>{d}</dd>
              </>
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
