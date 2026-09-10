/* eslint-disable no-console, import/prefer-default-export */

// Loading the full GlueXML executes ~100 Lua files and creates thousands of frames. At
// one console line per file, per frame and per region that is six figures of output,
// which dominates load time - badly enough to make the client feel broken. Info and
// debug output is therefore off unless asked for; warnings and errors always show.
//
// Turn it on with ?verbose=1.
const verbose =
  typeof document !== 'undefined' && new URLSearchParams(document.location.search).get('verbose') === '1';

export const isVerbose = (): boolean => verbose;

/** console.debug/info, but only when verbose logging is on. */
export const trace = (...args: Array<unknown>): void => {
  if (verbose) {
    console.debug(...args);
  }
};

enum StatusType {
  INFO = 0x0,
  WARNING = 0x1,
  ERROR = 0x2,
  FATAL = 0x3,
}

type StatusArgs = Array<unknown>;
type StatusEntry = {
  type: StatusType,
  args: StatusArgs,
}

class Status {
  entries: StatusEntry[];

  constructor() {
    this.entries = [];
  }

  add(type: StatusType, ...args: StatusArgs) {
    this.entries.push({ type, args });
  }

  info(...args: StatusArgs) {
    if (verbose) {
      console.info(...args);
    }
    this.add(StatusType.INFO, ...args);
  }

  warning(...args: StatusArgs) {
    console.warn(...args);
    this.add(StatusType.WARNING, ...args);
  }

  error(...args: StatusArgs) {
    console.error(...args);
    this.add(StatusType.ERROR, ...args);
  }

  fatal(...args: StatusArgs) {
    console.error(...args);
    this.add(StatusType.FATAL, ...args);
  }
}

export { Status };
