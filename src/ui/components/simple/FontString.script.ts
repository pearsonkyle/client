import ScriptRegion from '../abstract/ScriptRegion';
import {
  LUA_TNUMBER,
  lua_State,
  lua_pushboolean,
  lua_pushnumber,
  lua_pushstring,
  lua_tojsstring,
  lua_tonumber,
  lua_type,
} from '../../scripting/lua';

import { formatLua, readFormatArgs } from '../../scripting/format';

import FontString from './FontString';

export const IsObjectType = () => {
  return 0;
};

export const GetObjectType = () => {
  return 0;
};

export const GetDrawLayer = () => {
  return 0;
};

export const SetDrawLayer = () => {
  return 0;
};

export const SetVertexColor = () => {
  return 0;
};

export const GetAlpha = () => {
  return 0;
};

export const SetAlpha = () => {
  return 0;
};

export const SetAlphaGradient = () => {
  return 0;
};

export const Show = () => {
  return 0;
};

export const Hide = () => {
  return 0;
};

export const IsVisible = () => {
  return 0;
};

export const IsShown = () => {
  return 0;
};

export const GetFontObject = () => {
  return 0;
};

export const SetFontObject = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  const name = lua_tojsstring(L, 2);
  if (name !== null) {
    fontString.applyFontObject(name);
  }
  return 0;
};

export const GetFont = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  lua_pushstring(L, fontString.fontPath);
  lua_pushnumber(L, fontString.fontHeight);
  lua_pushstring(L, fontString.outline ? 'OUTLINE' : '');
  return 3;
};

export const SetFont = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  const path = lua_tojsstring(L, 2);
  if (path !== null) {
    fontString.setFont(path, lua_tonumber(L, 3) ?? fontString.fontHeight, lua_tojsstring(L, 4) ?? '');
  }
  lua_pushboolean(L, 1);
  return 1;
};

export const GetText = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  lua_pushstring(L, fontString.text);
  return 1;
};

export const GetFieldSize = () => {
  return 0;
};

export const SetText = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  // The game passes numbers here as often as strings.
  const value = lua_type(L, 2) === LUA_TNUMBER ? String(lua_tonumber(L, 2)) : lua_tojsstring(L, 2);
  fontString.setText(value ?? '');
  return 0;
};

export const SetFormattedText = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  const template = lua_tojsstring(L, 2) ?? '';
  fontString.setText(formatLua(template, readFormatArgs(L, 3)));
  return 0;
};

export const GetTextColor = (L: lua_State) => {
  const { color } = ScriptRegion.getObjectFromStack(L) as FontString;
  lua_pushnumber(L, color.r);
  lua_pushnumber(L, color.g);
  lua_pushnumber(L, color.b);
  lua_pushnumber(L, color.a);
  return 4;
};

export const SetTextColor = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  fontString.setTextColor(
    lua_tonumber(L, 2) ?? 1,
    lua_tonumber(L, 3) ?? 1,
    lua_tonumber(L, 4) ?? 1,
    lua_type(L, 5) === LUA_TNUMBER ? lua_tonumber(L, 5) : 1,
  );
  return 0;
};

export const GetShadowColor = () => {
  return 0;
};

export const SetShadowColor = () => {
  return 0;
};

export const GetShadowOffset = () => {
  return 0;
};

export const SetShadowOffset = () => {
  return 0;
};

export const GetSpacing = () => {
  return 0;
};

export const SetSpacing = () => {
  return 0;
};

export const SetTextHeight = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  fontString.setFont(fontString.fontPath, lua_tonumber(L, 2) ?? fontString.fontHeight, '');
  return 0;
};

export const GetStringWidth = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  lua_pushnumber(L, fontString.stringWidth);
  return 1;
};

export const GetStringHeight = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  lua_pushnumber(L, fontString.stringHeight);
  return 1;
};

export const GetJustifyH = (L: lua_State) => {
  lua_pushstring(L, (ScriptRegion.getObjectFromStack(L) as FontString).justifyH);
  return 1;
};

export const SetJustifyH = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  fontString.justifyH = (lua_tojsstring(L, 2) ?? 'CENTER').toUpperCase();
  return 0;
};

export const GetJustifyV = (L: lua_State) => {
  lua_pushstring(L, (ScriptRegion.getObjectFromStack(L) as FontString).justifyV);
  return 1;
};

export const SetJustifyV = (L: lua_State) => {
  const fontString = ScriptRegion.getObjectFromStack(L) as FontString;
  fontString.justifyV = (lua_tojsstring(L, 2) ?? 'MIDDLE').toUpperCase();
  return 0;
};

export const CanNonSpaceWrap = () => {
  return 0;
};

export const SetNonSpaceWrap = () => {
  return 0;
};

export const CanWordWrap = () => {
  return 0;
};

export const SetWordWrap = () => {
  return 0;
};

export const GetIndentedWordWrap = () => {
  return 0;
};

export const SetIndentedWordWrap = () => {
  return 0;
};
