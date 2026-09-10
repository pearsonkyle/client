export enum AuthOpcode {
  LOGON_CHALLENGE = 0x00,
  LOGON_PROOF = 0x01,
  RECONNECT_CHALLENGE = 0x02,
  RECONNECT_PROOF = 0x03,
  REALM_LIST = 0x10,
}

// AuthCodes.h - the status byte of a challenge reply and the error byte of a proof reply
// come from the same enum.
export enum AuthResult {
  SUCCESS = 0x00,
  FAIL_BANNED = 0x03,
  FAIL_UNKNOWN_ACCOUNT = 0x04,
  FAIL_INCORRECT_PASSWORD = 0x05,
  FAIL_ALREADY_ONLINE = 0x06,
  FAIL_NO_TIME = 0x07,
  FAIL_DB_BUSY = 0x08,
  FAIL_VERSION_INVALID = 0x09,
  FAIL_VERSION_UPDATE = 0x0a,
  FAIL_SUSPENDED = 0x0c,
  FAIL_FAIL_NOACCESS = 0x0d,
  SUCCESS_SURVEY = 0x0e,
  FAIL_PARENTALCONTROL = 0x0f,
}

export const authResultName = (code: number): string => AuthResult[code] ?? `UNKNOWN_0x${code.toString(16)}`;

// Realm flags from RealmList.h
export enum RealmFlag {
  NONE = 0x00,
  VERSION_MISMATCH = 0x01,
  OFFLINE = 0x02,
  SPECIFYBUILD = 0x04,
  NEW_PLAYERS = 0x20,
  RECOMMENDED = 0x40,
  FULL = 0x80,
}
