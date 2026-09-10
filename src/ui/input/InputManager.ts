// Routes browser input into the frame engine.
//
// The engine already declares OnEnter/OnLeave/OnMouseDown/OnMouseUp/OnClick/OnChar and
// friends, and can run them - nothing was ever dispatching them. This does the hit
// testing and the bookkeeping (which frame is hovered, which is pressed, which edit box
// has focus) that turns DOM events into those scripts.

import EditBox from '../components/simple/EditBox';
import Frame from '../components/simple/Frame';
import UIRoot from '../components/UIRoot';

/** Buttons as WoW names them. */
const MOUSE_BUTTONS = ['LeftButton', 'MiddleButton', 'RightButton'] as const;

// Keys the UI cares about by name; anything else is passed through uppercased.
const KEY_NAMES: Record<string, string> = {
  ' ': 'SPACE',
  Enter: 'ENTER',
  Escape: 'ESCAPE',
  Tab: 'TAB',
  Backspace: 'BACKSPACE',
  Delete: 'DELETE',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  Home: 'HOME',
  End: 'END',
  Shift: 'SHIFT',
  Control: 'CTRL',
  Alt: 'ALT',
};

export class InputManager {
  private readonly canvas: HTMLCanvasElement;
  private hovered: Frame | null = null;
  private pressed: Frame | null = null;
  private pressedButton = 'LeftButton';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    // Listen for the release on the window: dragging off the canvas and releasing there
    // should still end the press, or the button stays stuck down.
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mouseleave', this.onMouseLeave);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  /**
   * Converts a DOM event's client coordinates into the layout engine's units.
   *
   * The UI's origin is bottom-left, the DOM's is top-left, hence the flipped Y.
   */
  private toLayout(event: MouseEvent): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    const { rect } = UIRoot.instance;

    const u = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const v = (event.clientY - bounds.top) / Math.max(1, bounds.height);

    return {
      x: rect.minX + u * (rect.maxX - rect.minX),
      y: rect.minY + (1 - v) * (rect.maxY - rect.minY),
    };
  }

  /**
   * Topmost interactive frame under the point.
   *
   * Strata are searched from the front, and levels within a strata from the top, so the
   * frame the user perceives as being on top is the one that gets the event.
   */
  private frameAt(x: number, y: number): Frame | null {
    const strata = [...UIRoot.instance.strata];

    for (let s = strata.length - 1; s >= 0; s--) {
      const levels = strata[s]?.levels ?? [];
      for (let l = levels.length - 1; l >= 0; l--) {
        const level = levels[l];
        if (!level) {
          continue;
        }
        // Within a level, later frames render on top.
        const frames = [...level.frames];
        for (let f = frames.length - 1; f >= 0; f--) {
          const frame = frames[f];
          if (frame instanceof Frame && frame.hitTest(x, y)) {
            return frame;
          }
        }
      }
    }

    return null;
  }

  private setHovered(frame: Frame | null): void {
    if (this.hovered === frame) {
      return;
    }

    const previous = this.hovered;
    this.hovered = frame;

    if (previous) {
      previous.runScript('OnLeave', true);
    }

    if (frame) {
      frame.runScript('OnEnter', true);
    }
  }

  private onMouseMove = (event: MouseEvent) => {
    const { x, y } = this.toLayout(event);
    this.setHovered(this.frameAt(x, y));
  };

  private onMouseLeave = () => {
    this.setHovered(null);
  };

  private onMouseDown = (event: MouseEvent) => {
    const { x, y } = this.toLayout(event);
    const frame = this.frameAt(x, y);
    const button = MOUSE_BUTTONS[event.button] ?? 'LeftButton';

    // Clicking anywhere that is not an edit box drops keyboard focus, which is what
    // makes tabbing and clicking between fields feel right.
    if (!(frame instanceof EditBox)) {
      EditBox.focused?.clearFocus();
    }

    if (!frame) {
      return;
    }

    event.preventDefault();

    this.pressed = frame;
    this.pressedButton = button;
    frame.runScript('OnMouseDown', button);

    if (frame instanceof EditBox) {
      frame.setFocus();
    }
  };

  private onMouseUp = (event: MouseEvent) => {
    const pressed = this.pressed;
    if (!pressed) {
      return;
    }
    this.pressed = null;

    const button = MOUSE_BUTTONS[event.button] ?? 'LeftButton';
    pressed.runScript('OnMouseUp', button);

    // A click only counts if the release lands on the frame that was pressed.
    const { x, y } = this.toLayout(event);
    if (button === this.pressedButton && pressed.hitTest(x, y)) {
      pressed.runScript('OnClick', button, false);
    }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const focused = EditBox.focused;

    // Let the browser keep its own shortcuts and let the DOM overlay's inputs work.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (document.activeElement instanceof HTMLInputElement) {
      return;
    }

    const key = KEY_NAMES[event.key] ?? event.key.toUpperCase();

    if (focused) {
      event.preventDefault();
      focused.runScript('OnKeyDown', key);

      switch (event.key) {
        case 'Enter':
          focused.runScript('OnEnterPressed');
          return;
        case 'Escape':
          focused.runScript('OnEscapePressed');
          return;
        case 'Tab':
          focused.runScript('OnTabPressed');
          return;
        case 'Backspace':
          focused.backspace();
          return;
        default:
          break;
      }

      // Printable characters only: `key` is a single code point for those and a word
      // for everything else.
      if ([...event.key].length === 1) {
        focused.insert(event.key);
        focused.runScript('OnChar', event.key);
      }
      return;
    }

    this.hovered?.runScript('OnKeyDown', key);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    const key = KEY_NAMES[event.key] ?? event.key.toUpperCase();
    (EditBox.focused ?? this.hovered)?.runScript('OnKeyUp', key);
  };
}
