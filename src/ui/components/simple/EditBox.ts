import DrawLayerType from '../../DrawLayerType';
import FramePointType from '../abstract/FramePointType';
import Script from '../../scripting/Script';
import { Status } from '../../../utils/logging';
import XMLNode from '../../XMLNode';

import Frame from './Frame';
import FontString from './FontString';

import * as scriptFunctions from './EditBox.script';

class EditBox extends Frame {
  static get scriptFunctions() {
    return {
      ...super.scriptFunctions,
      ...scriptFunctions,
    };
  }

  /** The currently focused edit box, if any. Only one can have focus at a time. */
  static focused: EditBox | null = null;

  text = '';
  password = false;
  numeric = false;
  multiLine = false;
  maxLetters = 0;
  autoFocus = false;

  /** Renders `text`; the XML never declares this, the real client draws it natively. */
  display: FontString | null = null;

  constructor(parent: Frame | null) {
    super(parent);

    // Typing into a box requires both: the click that focuses it and the keys after.
    this.mouseEnabled = true;
    this.keyboardEnabled = true;

    this.scripts.register(
      new Script('OnEnterPressed'),
      new Script('OnEscapePressed'),
      new Script('OnSpacePressed'),
      new Script('OnTabPressed'),
      new Script('OnTextChanged', ['userInput']),
      new Script('OnTextSet'),
      new Script('OnCursorChanged', ['x', 'y', 'w', 'h']),
      new Script('OnInputLanguageChanged', ['language']),
      new Script('OnEditFocusGained'),
      new Script('OnEditFocusLost'),
      new Script('OnCharComposition', ['text']),
    );
  }

  loadXML(node: XMLNode, status: Status) {
    super.loadXML(node, status);

    const letters = node.attributes.get('letters');
    if (letters !== undefined) {
      this.maxLetters = Number(letters);
    }

    const password = node.attributes.get('password');
    if (password !== undefined) {
      this.password = password === 'true';
    }

    const numeric = node.attributes.get('numeric');
    if (numeric !== undefined) {
      this.numeric = numeric === 'true';
    }

    const multiLine = node.attributes.get('multiLine');
    if (multiLine !== undefined) {
      this.multiLine = multiLine === 'true';
    }

    const autoFocus = node.attributes.get('autoFocus');
    if (autoFocus !== undefined) {
      this.autoFocus = autoFocus === 'true';
    }
  }

  /** The string as it should appear - masked when this is a password field. */
  get displayText(): string {
    return this.password ? '*'.repeat(this.text.length) : this.text;
  }

  private ensureDisplay(): FontString {
    if (!this.display) {
      // OVERLAY so the typed text sits above the box's backdrop and any placeholder.
      const display = new FontString(this, DrawLayerType.OVERLAY, true);
      display.justifyH = 'LEFT';
      display.justifyV = 'MIDDLE';
      display.setPoint(FramePointType.LEFT, this, FramePointType.LEFT, 8, 2);
      this.display = display;
    }
    return this.display;
  }

  setText(text: string, userInput = false): void {
    const limited = this.maxLetters > 0 ? text.slice(0, this.maxLetters) : text;
    if (limited === this.text) {
      return;
    }

    this.text = limited;
    this.ensureDisplay().setText(this.displayText);

    this.runScript('OnTextChanged', userInput);
    if (!userInput) {
      this.runScript('OnTextSet');
    }
  }

  /** Masking changes what is drawn, not what is stored. */
  setPassword(password: boolean): void {
    if (password !== this.password) {
      this.password = password;
      this.display?.setText(this.displayText);
    }
  }

  insert(text: string): void {
    const filtered = this.numeric ? text.replace(/[^0-9]/g, '') : text;
    if (filtered.length > 0) {
      this.setText(this.text + filtered, true);
    }
  }

  backspace(): void {
    if (this.text.length > 0) {
      this.setText(this.text.slice(0, -1), true);
    }
  }

  setFocus(): void {
    if (EditBox.focused === this) {
      return;
    }
    EditBox.focused?.clearFocus();
    EditBox.focused = this;
    this.runScript('OnEditFocusGained');
  }

  clearFocus(): void {
    if (EditBox.focused !== this) {
      return;
    }
    EditBox.focused = null;
    this.runScript('OnEditFocusLost');
  }

  get hasFocus(): boolean {
    return EditBox.focused === this;
  }
}

export default EditBox;
