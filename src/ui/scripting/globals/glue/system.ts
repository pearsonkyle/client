// Glue API the options and account-message screens call.
//
// None of it is needed to reach the world, but a nil global here throws a Lua error the
// moment its screen loads, and the ScriptErrors frame then covers the login screen. The
// video functions report what the browser can actually tell us; the rest are honest
// stubs for features that do not exist outside a native client.

import {
  lua_State,
  lua_pushboolean,
  lua_pushnil,
  lua_pushnumber,
  lua_pushstring,
} from '../../lua';

// ------------------------------------------------------------------ video

/** The browser has one "resolution": the size of the canvas. */
const resolution = (): string => {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const height = typeof window === 'undefined' ? 768 : window.innerHeight;
  return `${width}x${height}`;
};

export const GetScreenResolutions = (L: lua_State) => {
  lua_pushstring(L, resolution());
  return 1;
};

export const GetCurrentResolution = (L: lua_State) => {
  lua_pushnumber(L, 1);
  return 1;
};

export const SetScreenResolution = () => 0;

export const IsPlayerResolutionAvailable = (L: lua_State) => {
  lua_pushboolean(L, 0);
  return 1;
};

export const GetRefreshRates = (L: lua_State) => {
  lua_pushnumber(L, 60);
  return 1;
};

export const GetVideoCaps = (L: lua_State) => {
  // hasAnisotropic, hasPixelShaders, hasVertexShaders, hasTrilinear, maxAnisotropy, ...
  lua_pushboolean(L, 1);
  lua_pushboolean(L, 1);
  lua_pushboolean(L, 1);
  lua_pushboolean(L, 1);
  lua_pushnumber(L, 16);
  return 5;
};

export const GetMultisampleFormats = (L: lua_State) => {
  // One format: 32-bit colour, 24-bit depth, no multisampling.
  lua_pushnumber(L, 32);
  lua_pushnumber(L, 24);
  lua_pushnumber(L, 0);
  return 3;
};

export const GetCurrentMultisampleFormat = (L: lua_State) => {
  lua_pushnumber(L, 1);
  return 1;
};

export const SetMultisampleFormat = () => 0;

export const IsStereoVideoAvailable = (L: lua_State) => {
  lua_pushboolean(L, 0);
  return 1;
};

export const ResetLights = () => 0;

export const SetLogo = () => 0;

// ------------------------------------------------------- account messages

export const AccountMsg_GetNumUnreadMsgs = (L: lua_State) => {
  lua_pushnumber(L, 0);
  return 1;
};

export const AccountMsg_GetIndexNextUnreadMsg = (L: lua_State) => {
  lua_pushnumber(L, 0);
  return 1;
};

export const AccountMsg_GetHeaderSubject = (L: lua_State) => {
  lua_pushstring(L, '');
  return 1;
};

export const AccountMsg_LoadHeaders = () => 0;

export const AccountMsg_LoadBody = () => 0;

export const AccountMsg_SetMsgRead = () => 0;

// ------------------------------------------------------------ realm list

export const CancelRealmListQuery = () => 0;

export const RealmListDialogCancelled = () => 0;

export const GetSelectedCategory = (L: lua_State) => {
  lua_pushnumber(L, 1);
  return 1;
};

export const IsTournamentRealmCategory = (L: lua_State) => {
  lua_pushboolean(L, 0);
  return 1;
};

export const IsInvalidTournamentRealmCategory = (L: lua_State) => {
  lua_pushboolean(L, 0);
  return 1;
};

export const SetPreferredInfo = () => 0;

// ------------------------------------------------------------------ misc

/** Armour value of a character-select model; only the character screens use it. */
export const Armor = (L: lua_State) => {
  lua_pushnil(L);
  return 1;
};

// Normally defined in FrameXML, which the glue screens do not load.
export const CloseMenus = () => 0;

export const ShowUIPanel = () => 0;

export const UIDropDownMenu_DisableDropDown = () => 0;

export const UIDropDownMenu_EnableDropDown = () => 0;
