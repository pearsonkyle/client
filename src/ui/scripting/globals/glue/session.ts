// The glue API the real Blizzard login, realm-select and character-select screens call.
//
// Signatures come from reading the 3.3.5a Lua itself (AccountLogin.lua, RealmList.lua,
// CharacterSelect.lua) rather than from documentation - the Lua is the spec. Where the
// Lua expects several return values, the order here matches its destructuring exactly.

import ScriptingContext from '../../ScriptingContext';
import EventType from '../../EventType';
import { session } from '../../../../game/GameSession';
import { Realm } from '../../../../net/auth/AuthClient';
import { CharacterClass, Race } from '../../../../net/world/types';
import {
  lua_State,
  lua_pushboolean,
  lua_pushnil,
  lua_pushnumber,
  lua_pushstring,
  lua_tojsstring,
  lua_tonumber,
} from '../../lua';

const signal = (type: EventType, format?: string, ...args: Array<string | number | boolean>) => {
  ScriptingContext.instance.signalEvent(type, format, ...args);
};

/**
 * RealmList.lua groups realms into category tabs. We have exactly one realm list, so
 * there is one category and every realm lives in it.
 */
const CATEGORY = 'Realms';

const realmsInCategory = (): Realm[] => session.realms;

// ------------------------------------------------------------------- login

let statusDialogOpen = false;

const openStatus = (text: string) => {
  if (statusDialogOpen) {
    signal(EventType.UPDATE_STATUS_DIALOG, '%s', text);
  } else {
    statusDialogOpen = true;
    signal(EventType.OPEN_STATUS_DIALOG, '%ss', 'CANCEL', text);
  }
};

const closeStatus = () => {
  if (statusDialogOpen) {
    statusDialogOpen = false;
    signal(EventType.CLOSE_STATUS_DIALOG);
  }
};

session.on('status', (text) => openStatus(text));

session.on('realms', () => {
  closeStatus();
  signal(EventType.OPEN_REALM_LIST);
});

session.on('characters', () => {
  closeStatus();
  signal(EventType.CHARACTER_LIST_UPDATE);
});

session.on('error', (message) => {
  closeStatus();
  // GlueDialog_Show takes a string key; passing the message directly shows it verbatim,
  // which is more useful during development than a localised generic failure.
  signal(EventType.DISCONNECTED_FROM_SERVER, '%s', message);
});

export const DefaultServerLogin = (L: lua_State) => {
  const account = lua_tojsstring(L, 1) ?? '';
  const password = lua_tojsstring(L, 2) ?? '';

  openStatus('Connecting...');
  void session.login(account, password).catch(() => {
    // GameSession already emitted 'error'; swallow so the rejection is not unhandled.
  });

  return 0;
};

export const CancelLogin = () => {
  closeStatus();
  session.disconnect();
  return 0;
};

export const IsConnectedToServer = (L: lua_State) => {
  lua_pushboolean(L, session.isConnected ? 1 : 0);
  return 1;
};

export const DisconnectFromServer = () => {
  session.disconnect();
  return 0;
};

export const StatusDialogClick = () => {
  closeStatus();
  session.disconnect();
  return 0;
};

// -------------------------------------------------------------- realm list

export const RequestRealmList = () => {
  if (session.realms.length > 0) {
    signal(EventType.OPEN_REALM_LIST);
  }
  return 0;
};

export const GetRealmCategories = (L: lua_State) => {
  lua_pushstring(L, CATEGORY);
  return 1;
};

export const GetNumRealms = (L: lua_State) => {
  lua_pushnumber(L, realmsInCategory().length);
  return 1;
};

/**
 * RealmList.lua destructures this as:
 *   name, numCharacters, invalidRealm, realmDown, currentRealm, pvp, rp, load, locked,
 *   major, minor, revision, build, type
 */
export const GetRealmInfo = (L: lua_State) => {
  // Lua indices are 1-based.
  const index = (lua_tonumber(L, 2) ?? 0) - 1;
  const realm = realmsInCategory()[index];

  if (!realm) {
    lua_pushnil(L);
    return 1;
  }

  lua_pushstring(L, realm.name);
  lua_pushnumber(L, realm.characterCount);
  lua_pushboolean(L, 0); // invalidRealm
  lua_pushboolean(L, realm.online ? 0 : 1); // realmDown
  lua_pushboolean(L, session.realm?.id === realm.id ? 1 : 0); // currentRealm
  lua_pushboolean(L, realm.type === 1 ? 1 : 0); // pvp
  lua_pushboolean(L, realm.type === 6 || realm.type === 8 ? 1 : 0); // rp
  lua_pushnumber(L, realm.population);
  lua_pushboolean(L, realm.locked ? 1 : 0);
  lua_pushnumber(L, 3); // major
  lua_pushnumber(L, 3); // minor
  lua_pushnumber(L, 5); // revision
  lua_pushnumber(L, 12340); // build
  lua_pushnumber(L, realm.type);
  return 14;
};

export const ChangeRealm = (L: lua_State) => {
  const index = (lua_tonumber(L, 2) ?? 0) - 1;
  const realm = realmsInCategory()[index];
  if (!realm) {
    return 0;
  }

  openStatus(`Connecting to ${realm.name}...`);
  void session.selectRealm(realm).catch(() => undefined);
  return 0;
};

/** GetServerName() -> serverName, isPVP, isRP, isDown */
export const GetServerName = (L: lua_State) => {
  const realm = session.realm;
  if (!realm) {
    lua_pushnil(L);
    return 1;
  }
  lua_pushstring(L, realm.name);
  lua_pushboolean(L, realm.type === 1 ? 1 : 0);
  lua_pushboolean(L, realm.type === 6 || realm.type === 8 ? 1 : 0);
  lua_pushboolean(L, realm.online ? 0 : 1);
  return 4;
};

export const RealmListUpdateRate = (L: lua_State) => {
  lua_pushnumber(L, 10);
  return 1;
};

export const IsInvalidLocale = (L: lua_State) => {
  lua_pushboolean(L, 0);
  return 1;
};

// --------------------------------------------------------- character select

export const GetNumCharacters = (L: lua_State) => {
  lua_pushnumber(L, session.characters.length);
  return 1;
};

/**
 * CharacterSelect.lua destructures this as:
 *   name, race, class, level, zone, sex, ghost, PCC, PRC, PFC
 * (PCC/PRC/PFC are the pending customise / race change / faction change flags.)
 */
export const GetCharacterInfo = (L: lua_State) => {
  const index = (lua_tonumber(L, 1) ?? 0) - 1;
  const character = session.characters[index];

  if (!character) {
    lua_pushnil(L);
    return 1;
  }

  lua_pushstring(L, character.name);
  lua_pushstring(L, Race[character.race] ?? String(character.race));
  lua_pushstring(L, CharacterClass[character.class] ?? String(character.class));
  lua_pushnumber(L, character.level);
  lua_pushstring(L, String(character.zone));
  lua_pushnumber(L, character.gender);
  lua_pushboolean(L, 0); // ghost
  lua_pushboolean(L, 0); // pending customise
  lua_pushboolean(L, 0); // pending race change
  lua_pushboolean(L, 0); // pending faction change
  return 10;
};

export const SelectCharacter = (L: lua_State) => {
  const index = (lua_tonumber(L, 1) ?? 0) - 1;
  session.selectCharacter(index);
  signal(EventType.UPDATE_SELECTED_CHARACTER, '%d', index + 1);
  return 0;
};

export const GetSelectedCharacter = (L: lua_State) => {
  lua_pushnumber(L, session.selectedIndex + 1);
  return 1;
};

export const UpdateCharacterList = () => {
  void session.refreshCharacters().catch(() => undefined);
  return 0;
};

export const EnterWorld = () => {
  openStatus('Entering world...');
  void session
    .enterWorld()
    .then(() => closeStatus())
    .catch(() => undefined);
  return 0;
};

export const GetCharacterSelectFacing = (L: lua_State) => {
  lua_pushnumber(L, 0);
  return 1;
};

export const SetCharacterSelectFacing = () => 0;

export const DeleteCharacter = () => 0;

export const GetCharacterListUpdate = () => 0;
