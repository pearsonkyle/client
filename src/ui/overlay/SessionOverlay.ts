// A DOM control surface for the game session.
//
// The FrameXML engine renders Blizzard's art but cannot yet draw text (FontString.draw
// is a stub) or route input to frames, so the real login screen is not usable yet. This
// overlay drives the same GameSession the Lua glue API drives, which means the whole
// network path - SRP6, the world handshake, character select, chat - is exercised for
// real. It retires once the frame engine can take over.
//
// Disable with ?overlay=0.

import { GameSession, SessionState } from '../../game/GameSession';
import { CharacterClass, ChatMessageType, Race } from '../../net/world/types';

const STYLE = `
.wo-overlay {
  position: fixed; top: 12px; right: 12px; width: 320px; max-height: calc(100vh - 24px);
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  background: rgba(8, 10, 16, 0.92); border: 1px solid #2b3550; border-radius: 8px;
  color: #dfe6f5; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); z-index: 10; overflow: hidden;
}
.wo-overlay[data-collapsed="true"] > :not(.wo-head) { display: none; }
.wo-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.wo-title { font-weight: 600; letter-spacing: 0.02em; color: #ffd47f; }
.wo-toggle {
  background: none; border: 1px solid #2b3550; color: #8fa0c4; border-radius: 4px;
  cursor: pointer; padding: 2px 8px; font: inherit;
}
.wo-status { color: #8fa0c4; min-height: 1.4em; }
.wo-status[data-kind="error"] { color: #ff8f7a; }
.wo-row { display: flex; gap: 6px; }
.wo-overlay input[type="text"], .wo-overlay input[type="password"] {
  flex: 1; min-width: 0; padding: 6px 8px; border-radius: 4px;
  border: 1px solid #2b3550; background: #10141f; color: #dfe6f5; font: inherit;
}
.wo-overlay button.wo-action {
  padding: 6px 12px; border-radius: 4px; border: 1px solid #3a4a72;
  background: #1b2236; color: #ffd47f; cursor: pointer; font: inherit;
}
.wo-list { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; max-height: 200px; }
.wo-item {
  text-align: left; padding: 6px 8px; border-radius: 4px; border: 1px solid #2b3550;
  background: #131826; color: #dfe6f5; cursor: pointer; font: inherit;
}
.wo-item:hover { border-color: #4a5c88; }
.wo-item[aria-selected="true"] { border-color: #ffd47f; background: #1d2233; }
.wo-item small { display: block; color: #8fa0c4; }
.wo-chat {
  display: flex; flex-direction: column; gap: 3px; overflow-y: auto;
  max-height: 220px; padding: 6px; background: #0b0e16; border-radius: 4px;
  border: 1px solid #1c2233; font-size: 12px;
}
.wo-chat div { word-break: break-word; }
.wo-chat .wo-sys { color: #8fa0c4; font-style: italic; }
.wo-hint { color: #6d7c9c; font-size: 11px; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
};

const button = (label: string, className: string, onClick: () => void) => {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
};

export class SessionOverlay {
  private readonly session: GameSession;
  private readonly root = el('div', 'wo-overlay');
  private readonly status = el('div', 'wo-status');
  private readonly body = el('div', 'wo-body');
  private readonly chat = el('div', 'wo-chat');
  private busy = false;

  constructor(session: GameSession) {
    this.session = session;

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);

    const head = el('div', 'wo-head');
    head.append(el('span', 'wo-title', 'Wowser'));
    head.append(
      button('–', 'wo-toggle', () => {
        const collapsed = this.root.dataset.collapsed === 'true';
        this.root.dataset.collapsed = String(!collapsed);
      }),
    );

    this.root.append(head, this.status, this.body);
    document.body.append(this.root);

    session.on('state', () => this.render());
    session.on('status', (text) => this.setStatus(text));
    session.on('error', (message) => this.setStatus(message, 'error'));
    session.on('realms', () => this.render());
    session.on('characters', () => this.render());
    session.on('chat', (message) => this.appendChat(message.senderName ?? `guid:${message.senderGuid}`, message.text, message.type));
    session.on('motd', (lines) => lines.filter(Boolean).forEach((line) => this.appendChat('', line, -1)));
    session.on('enteredWorld', (position, character) => {
      this.appendChat('', `Entered world as ${character.name} — map ${position.map} (${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)})`, -1);
    });

    this.render();
  }

  private setStatus(text: string, kind: 'info' | 'error' = 'info'): void {
    this.status.textContent = text;
    this.status.dataset.kind = kind;
  }

  private appendChat(sender: string, text: string, type: number): void {
    const line = el('div');
    if (type === -1) {
      line.className = 'wo-sys';
      line.textContent = text;
    } else {
      const label = type === ChatMessageType.SAY ? 'says' : ChatMessageType[type] ?? String(type);
      line.textContent = `${sender} ${label}: ${text}`;
    }
    this.chat.append(line);
    this.chat.scrollTop = this.chat.scrollHeight;
  }

  /** Runs an async action, keeping the UI from firing it twice. */
  private run(action: () => Promise<unknown>): void {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.render();
    void action()
      .catch(() => undefined)
      .finally(() => {
        this.busy = false;
        this.render();
      });
  }

  private render(): void {
    const state: SessionState = this.session.state;
    this.body.replaceChildren();

    if (state === 'disconnected' || state === 'connecting' || state === 'authenticating') {
      this.renderLogin();
      return;
    }

    if (state === 'realmlist') {
      this.renderRealms();
      return;
    }

    if (state === 'charlist' || state === 'entering') {
      this.renderCharacters();
      return;
    }

    this.renderInWorld();
  }

  private renderLogin(): void {
    const account = el('input');
    account.type = 'text';
    account.placeholder = 'Account';
    account.value = localStorage.getItem('wowser.account') ?? '';
    account.autocapitalize = 'characters';

    const password = el('input');
    password.type = 'password';
    password.placeholder = 'Password';

    const submit = () => {
      if (!account.value || !password.value) {
        this.setStatus('Account and password are required.', 'error');
        return;
      }
      localStorage.setItem('wowser.account', account.value);
      this.run(() => this.session.login(account.value, password.value));
    };

    for (const field of [account, password]) {
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          submit();
        }
      });
    }

    const login = button(this.busy ? 'Connecting…' : 'Login', 'wo-action', submit);
    login.disabled = this.busy;

    this.body.replaceChildren(
      el('div', 'wo-row'),
      account,
      password,
      login,
      el('div', 'wo-hint', 'Credentials go to the local AzerothCore server through the bridge.'),
    );
  }

  private renderRealms(): void {
    const list = el('div', 'wo-list');
    for (const realm of this.session.realms) {
      const item = button(realm.name, 'wo-item', () => this.run(() => this.session.selectRealm(realm)));
      item.append(
        el(
          'small',
          undefined,
          `${realm.host}:${realm.port} · ${realm.characterCount} character${realm.characterCount === 1 ? '' : 's'} · ${realm.online ? 'online' : 'offline'}`,
        ),
      );
      list.append(item);
    }

    this.body.replaceChildren(
      el('div', 'wo-hint', 'Select a realm'),
      list,
      button('Log out', 'wo-action', () => this.session.disconnect()),
    );
  }

  private renderCharacters(): void {
    const list = el('div', 'wo-list');

    this.session.characters.forEach((character, index) => {
      const item = button(character.name, 'wo-item', () => {
        this.session.selectCharacter(index);
        this.render();
      });
      item.setAttribute('aria-selected', String(index === this.session.selectedIndex));
      item.append(
        el(
          'small',
          undefined,
          `level ${character.level} ${Race[character.race] ?? character.race} ${CharacterClass[character.class] ?? character.class} · map ${character.map}`,
        ),
      );
      list.append(item);
    });

    const children: HTMLElement[] = [el('div', 'wo-hint', 'Select a character'), list];

    if (this.session.characters.length > 0) {
      const enter = button(this.busy ? 'Entering…' : 'Enter World', 'wo-action', () =>
        this.run(() => this.session.enterWorld()),
      );
      enter.disabled = this.busy;
      children.push(enter);
    }

    const name = el('input');
    name.type = 'text';
    name.placeholder = 'New character name';

    const create = button('Create', 'wo-action', () => {
      if (!name.value) {
        this.setStatus('Enter a name for the new character.', 'error');
        return;
      }
      this.run(() =>
        this.session.createCharacter({
          name: name.value,
          race: Race.HUMAN,
          class: CharacterClass.WARRIOR,
        }),
      );
    });

    const row = el('div', 'wo-row');
    row.append(name, create);

    children.push(row, el('div', 'wo-hint', 'New characters are Human Warriors for now.'));
    children.push(button('Back', 'wo-action', () => this.session.disconnect()));

    this.body.replaceChildren(...children);
  }

  private renderInWorld(): void {
    const character = this.session.selectedCharacter;
    const position = this.session.position;

    const input = el('input');
    input.type = 'text';
    input.placeholder = 'Say something…';
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && input.value) {
        this.session.say(input.value);
        input.value = '';
      }
      // The frame engine will eventually want these keys; until then, keep them here.
      event.stopPropagation();
    });

    this.body.replaceChildren(
      el(
        'div',
        'wo-hint',
        character && position
          ? `${character.name} · map ${position.map} · ${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)}`
          : 'In world',
      ),
      this.chat,
      input,
      button('Log out', 'wo-action', () => this.session.disconnect()),
    );
  }
}
