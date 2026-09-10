import ScriptRegion from '../abstract/ScriptRegion';
import {
  lua_State,
  lua_pushboolean,
  lua_pushnumber,
  lua_pushstring,
  lua_toboolean,
  lua_tojsstring,
  lua_tonumber,
} from '../../scripting/lua';

import EditBox from './EditBox';

const editBoxFrom = (L: lua_State) => ScriptRegion.getObjectFromStack(L) as EditBox;

export const SetFontObject = () => {
  return 0;
};

export const GetFontObject = () => {
  return 0;
};

export const SetFont = () => {
  return 0;
};

export const GetFont = () => {
  return 0;
};

export const SetTextColor = () => {
  return 0;
};

export const GetTextColor = () => {
  return 0;
};

export const SetShadowColor = () => {
  return 0;
};

export const GetShadowColor = () => {
  return 0;
};

export const SetShadowOffset = () => {
  return 0;
};

export const GetShadowOffset = () => {
  return 0;
};

export const SetSpacing = () => {
  return 0;
};

export const GetSpacing = () => {
  return 0;
};

export const SetJustifyH = () => {
  return 0;
};

export const GetJustifyH = () => {
  return 0;
};

export const SetJustifyV = () => {
  return 0;
};

export const GetJustifyV = () => {
  return 0;
};

export const SetIndentedWordWrap = () => {
  return 0;
};

export const GetIndentedWordWrap = () => {
  return 0;
};

export const SetAutoFocus = () => {
  return 0;
};

export const IsAutoFocus = () => {
  return 0;
};

export const SetCountInvisibleLetters = () => {
  return 0;
};

export const IsCountInvisibleLetters = () => {
  return 0;
};

export const SetMultiLine = () => {
  return 0;
};

export const IsMultiLine = () => {
  return 0;
};

export const SetNumeric = () => {
  return 0;
};

export const IsNumeric = () => {
  return 0;
};

export const SetPassword = (L: lua_State) => {
  editBoxFrom(L).setPassword(lua_toboolean(L, 2));
  return 0;
};

export const IsPassword = (L: lua_State) => {
  lua_pushboolean(L, editBoxFrom(L).password ? 1 : 0);
  return 1;
};

export const SetBlinkSpeed = () => {
  return 0;
};

export const GetBlinkSpeed = () => {
  return 0;
};

export const Insert = () => {
  return 0;
};

export const SetText = (L: lua_State) => {
  editBoxFrom(L).setText(lua_tojsstring(L, 2) ?? '');
  return 0;
};

export const GetText = (L: lua_State) => {
  lua_pushstring(L, editBoxFrom(L).text);
  return 1;
};

export const SetNumber = (L: lua_State) => {
  editBoxFrom(L).setText(String(lua_tonumber(L, 2) ?? 0));
  return 0;
};

export const GetNumber = (L: lua_State) => {
  lua_pushnumber(L, Number(editBoxFrom(L).text) || 0);
  return 1;
};

export const HighlightText = () => {
  return 0;
};

export const AddHistoryLine = () => {
  return 0;
};

export const ClearHistory = () => {
  return 0;
};

export const SetTextInsets = () => {
  return 0;
};

export const GetTextInsets = () => {
  return 0;
};

export const SetFocus = (L: lua_State) => {
  editBoxFrom(L).setFocus();
  return 0;
};

export const ClearFocus = (L: lua_State) => {
  editBoxFrom(L).clearFocus();
  return 0;
};

export const HasFocus = (L: lua_State) => {
  lua_pushboolean(L, editBoxFrom(L).hasFocus ? 1 : 0);
  return 1;
};

export const SetMaxBytes = () => {
  return 0;
};

export const GetMaxBytes = () => {
  return 0;
};

export const SetMaxLetters = (L: lua_State) => {
  editBoxFrom(L).maxLetters = lua_tonumber(L, 2) ?? 0;
  return 0;
};

export const GetMaxLetters = (L: lua_State) => {
  lua_pushnumber(L, editBoxFrom(L).maxLetters);
  return 1;
};

export const GetNumLetters = () => {
  return 0;
};

export const GetHistoryLines = () => {
  return 0;
};

export const SetHistoryLines = () => {
  return 0;
};

export const GetInputLanguage = () => {
  return 0;
};

export const ToggleInputLanguage = () => {
  return 0;
};

export const SetAltArrowKeyMode = () => {
  return 0;
};

export const GetAltArrowKeyMode = () => {
  return 0;
};

export const IsInIMECompositionMode = () => {
  return 0;
};

export const SetCursorPosition = () => {
  return 0;
};

export const GetCursorPosition = () => {
  return 0;
};

export const GetUTF8CursorPosition = () => {
  return 0;
};
