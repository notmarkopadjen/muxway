import {
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
  ['Enter', 'open the selected pane'],
  ['Esc', 'back to the panes'],
  ['p', 'go to a pane or window'],
  ['/', 'filter panes'],
  ['f', 'fit: the host pane (window view: the window) follows this box'],
  ['b', 'the main board; from a pane: put it on the board'],
  ['] / [', 'window view and board: next / previous pane'],
  ['x / 0 / + / -', 'window view: hide, host layout, bigger, smaller'],
  [
    'a / A / x / s / z / = / F / w',
    'board: add beside / below, remove, swap, zoom, equalise, fit all, its window',
  ],
  ['i', 'focus the input line'],
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
