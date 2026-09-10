// A subset of Lua's string.format, for the C-API functions that take a format string
// and varargs (SetFormattedText and friends).
//
// The UI leans on this constantly - "Level %d %s", the version line, tooltips - so
// ignoring the arguments and showing the raw template, which is what a naive
// implementation does, is very visible.

import {
  LUA_TNUMBER,
  lua_State,
  lua_gettop,
  lua_tojsstring,
  lua_tonumber,
  lua_type,
} from './lua';

export type FormatArg = string | number;

/** Reads the varargs of a format call, starting at `from` (1-based, Lua style). */
export const readFormatArgs = (L: lua_State, from: number): FormatArg[] => {
  const args: FormatArg[] = [];
  const top = lua_gettop(L);
  for (let index = from; index <= top; index++) {
    args.push(
      lua_type(L, index) === LUA_TNUMBER
        ? (lua_tonumber(L, index) ?? 0)
        : (lua_tojsstring(L, index) ?? ''),
    );
  }
  return args;
};

// %[flags][width][.precision]specifier
const SPECIFIER = /%([-+ #0]*)(\d+)?(?:\.(\d+))?([diufFgGeExXocsq%])/g;

const pad = (text: string, width: number, leftAlign: boolean, zeroFill: boolean): string => {
  if (text.length >= width) {
    return text;
  }
  const filler = (zeroFill && !leftAlign ? '0' : ' ').repeat(width - text.length);
  if (leftAlign) {
    return text + filler;
  }
  // Zero padding goes after the sign, not before it.
  if (zeroFill && /^[-+]/.test(text)) {
    return text[0] + filler + text.slice(1);
  }
  return filler + text;
};

/** Formats `template` the way Lua's string.format would. */
export const formatLua = (template: string, args: FormatArg[]): string => {
  let next = 0;

  return template.replace(
    SPECIFIER,
    (match, flags: string, widthText: string | undefined, precisionText: string | undefined, specifier: string) => {
      if (specifier === '%') {
        return '%';
      }

      // Too few arguments: leave the specifier alone rather than printing "undefined",
      // so a mistake is visible as a mistake.
      if (next >= args.length) {
        return match;
      }

      const value = args[next++]!;
      const width = widthText === undefined ? 0 : Number(widthText);
      const precision = precisionText === undefined ? undefined : Number(precisionText);
      const leftAlign = flags.includes('-');
      const zeroFill = flags.includes('0');
      const plus = flags.includes('+');

      let text: string;
      switch (specifier) {
        case 'd':
        case 'i':
        case 'u': {
          const number = Math.trunc(Number(value) || 0);
          text = String(Math.abs(number));
          text = (number < 0 ? '-' : plus ? '+' : '') + text;
          break;
        }
        case 'f':
        case 'F':
          text = (Number(value) || 0).toFixed(precision ?? 6);
          if (plus && Number(value) >= 0) {
            text = `+${text}`;
          }
          break;
        case 'e':
        case 'E': {
          text = (Number(value) || 0).toExponential(precision ?? 6);
          text = specifier === 'E' ? text.toUpperCase() : text;
          break;
        }
        case 'g':
        case 'G': {
          const number = Number(value) || 0;
          text = precision === undefined ? String(number) : String(Number(number.toPrecision(precision)));
          break;
        }
        case 'x':
          text = Math.trunc(Number(value) || 0).toString(16);
          break;
        case 'X':
          text = Math.trunc(Number(value) || 0).toString(16).toUpperCase();
          break;
        case 'o':
          text = Math.trunc(Number(value) || 0).toString(8);
          break;
        case 'c':
          text = String.fromCharCode(Number(value) || 0);
          break;
        case 'q':
          text = JSON.stringify(String(value));
          break;
        case 's':
        default:
          text = String(value);
          if (precision !== undefined) {
            text = text.slice(0, precision);
          }
          break;
      }

      return pad(text, width, leftAlign, zeroFill);
    },
  );
};
