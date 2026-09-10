// SharedDefines.h - ResponseCodes, the enum SMSG_AUTH_RESPONSE and SMSG_CHAR_CREATE draw
// their codes from.
export enum ResponseCode {
  RESPONSE_SUCCESS = 0x00,
  AUTH_OK = 0x0c,
  AUTH_FAILED = 0x0d,
  AUTH_REJECT = 0x0e,
  AUTH_BAD_SERVER_PROOF = 0x0f,
  AUTH_UNAVAILABLE = 0x10,
  AUTH_SYSTEM_ERROR = 0x11,
  AUTH_BILLING_ERROR = 0x12,
  AUTH_BILLING_EXPIRED = 0x13,
  AUTH_VERSION_MISMATCH = 0x14,
  AUTH_UNKNOWN_ACCOUNT = 0x15,
  AUTH_INCORRECT_PASSWORD = 0x16,
  AUTH_SESSION_EXPIRED = 0x17,
  AUTH_SERVER_SHUTTING_DOWN = 0x18,
  AUTH_ALREADY_LOGGING_IN = 0x19,
  AUTH_LOGIN_SERVER_NOT_FOUND = 0x1a,
  AUTH_WAIT_QUEUE = 0x1b,
  AUTH_BANNED = 0x1c,
  AUTH_ALREADY_ONLINE = 0x1d,
  AUTH_NO_TIME = 0x1e,
  AUTH_DB_BUSY = 0x1f,
  AUTH_SUSPENDED = 0x20,
  AUTH_PARENTAL_CONTROL = 0x21,
  AUTH_LOCKED_ENFORCED = 0x22,
  REALM_LIST_REALM_NOT_FOUND = 0x27,
  CHAR_CREATE_IN_PROGRESS = 0x2d,
  CHAR_CREATE_SUCCESS = 0x2f,
  CHAR_CREATE_ERROR = 0x30,
  CHAR_CREATE_FAILED = 0x31,
  CHAR_CREATE_NAME_IN_USE = 0x32,
  CHAR_CREATE_DISABLED = 0x33,
  CHAR_CREATE_PVP_TEAMS_VIOLATION = 0x34,
  CHAR_CREATE_SERVER_LIMIT = 0x35,
  CHAR_CREATE_ACCOUNT_LIMIT = 0x36,
  CHAR_CREATE_SERVER_QUEUE = 0x37,
  CHAR_CREATE_ONLY_EXISTING = 0x38,
  CHAR_CREATE_EXPANSION = 0x39,
  CHAR_CREATE_EXPANSION_CLASS = 0x3a,
  CHAR_CREATE_LEVEL_REQUIREMENT = 0x3b,
  CHAR_CREATE_UNIQUE_CLASS_LIMIT = 0x3c,
  CHAR_CREATE_CHARACTER_IN_GUILD = 0x3d,
  CHAR_CREATE_RESTRICTED_RACECLASS = 0x3e,
  CHAR_CREATE_CHARACTER_CHOOSE_RACE = 0x3f,
  CHAR_CREATE_CHARACTER_ARENA_LEADER = 0x40,
  CHAR_CREATE_CHARACTER_DELETE_MAIL = 0x41,
  CHAR_CREATE_CHARACTER_SWAP_FACTION = 0x42,
  CHAR_CREATE_CHARACTER_RACE_ONLY = 0x43,
  CHAR_CREATE_CHARACTER_GOLD_LIMIT = 0x44,
  CHAR_CREATE_FORCE_LOGIN = 0x45,
}

export const responseCodeName = (code: number): string =>
  ResponseCode[code] ?? `UNKNOWN_0x${code.toString(16)}`;

export enum Race {
  HUMAN = 1,
  ORC = 2,
  DWARF = 3,
  NIGHT_ELF = 4,
  UNDEAD = 5,
  TAUREN = 6,
  GNOME = 7,
  TROLL = 8,
  BLOOD_ELF = 10,
  DRAENEI = 11,
}

export enum CharacterClass {
  WARRIOR = 1,
  PALADIN = 2,
  HUNTER = 3,
  ROGUE = 4,
  PRIEST = 5,
  DEATH_KNIGHT = 6,
  SHAMAN = 7,
  MAGE = 8,
  WARLOCK = 9,
  DRUID = 11,
}

const HORDE_RACES = new Set([Race.ORC, Race.UNDEAD, Race.TAUREN, Race.TROLL, Race.BLOOD_ELF]);

export const isHorde = (race: number): boolean => HORDE_RACES.has(race);

export enum ChatMessageType {
  SAY = 0x01,
  PARTY = 0x02,
  RAID = 0x03,
  GUILD = 0x04,
  OFFICER = 0x05,
  YELL = 0x06,
  WHISPER = 0x07,
  WHISPER_FOREIGN = 0x08,
  WHISPER_INFORM = 0x09,
  EMOTE = 0x0a,
  TEXT_EMOTE = 0x0b,
  MONSTER_SAY = 0x0c,
  MONSTER_PARTY = 0x0d,
  MONSTER_YELL = 0x0e,
  MONSTER_WHISPER = 0x0f,
  MONSTER_EMOTE = 0x10,
  CHANNEL = 0x11,
  CHANNEL_JOIN = 0x12,
  CHANNEL_LEAVE = 0x13,
  CHANNEL_LIST = 0x14,
  CHANNEL_NOTICE = 0x15,
  CHANNEL_NOTICE_USER = 0x16,
  AFK = 0x17,
  DND = 0x18,
  IGNORED = 0x19,
  SKILL = 0x1a,
  LOOT = 0x1b,
  MONEY = 0x1c,
  OPENING = 0x1d,
  TRADESKILLS = 0x1e,
  PET_INFO = 0x1f,
  COMBAT_MISC_INFO = 0x20,
  COMBAT_XP_GAIN = 0x21,
  COMBAT_HONOR_GAIN = 0x22,
  COMBAT_FACTION_CHANGE = 0x23,
  BG_SYSTEM_NEUTRAL = 0x24,
  BG_SYSTEM_ALLIANCE = 0x25,
  BG_SYSTEM_HORDE = 0x26,
  RAID_LEADER = 0x27,
  RAID_WARNING = 0x28,
  RAID_BOSS_EMOTE = 0x29,
  RAID_BOSS_WHISPER = 0x2a,
  FILTERED = 0x2b,
  BATTLEGROUND = 0x2c,
  BATTLEGROUND_LEADER = 0x2d,
  RESTRICTED = 0x2e,
  BATTLENET = 0x2f,
  ACHIEVEMENT = 0x30,
  GUILD_ACHIEVEMENT = 0x31,
  ARENA_POINTS = 0x32,
  PARTY_LEADER = 0x33,
  SYSTEM = 0x00,
}

export const chatMessageTypeName = (type: number): string =>
  ChatMessageType[type] ?? `UNKNOWN_0x${type.toString(16)}`;

export enum Language {
  UNIVERSAL = 0,
  ORCISH = 1,
  COMMON = 7,
  ADDON = 0xffffffff,
}

/** Types whose SMSG_MESSAGECHAT carries an inline sender name rather than just a GUID. */
export const CHAT_TYPES_WITH_SENDER_NAME = new Set([
  ChatMessageType.MONSTER_SAY,
  ChatMessageType.MONSTER_PARTY,
  ChatMessageType.MONSTER_YELL,
  ChatMessageType.MONSTER_WHISPER,
  ChatMessageType.MONSTER_EMOTE,
  ChatMessageType.RAID_BOSS_EMOTE,
  ChatMessageType.RAID_BOSS_WHISPER,
  ChatMessageType.BATTLENET,
]);

export type CharacterItem = {
  displayId: number;
  inventoryType: number;
  enchantId: number;
};

export type CharacterInfo = {
  guid: bigint;
  name: string;
  race: number;
  class: number;
  gender: number;
  skin: number;
  face: number;
  hairStyle: number;
  hairColor: number;
  facialStyle: number;
  level: number;
  zone: number;
  map: number;
  x: number;
  y: number;
  z: number;
  guildId: number;
  flags: number;
  customizeFlags: number;
  firstLogin: boolean;
  petDisplayId: number;
  petLevel: number;
  petFamily: number;
  items: CharacterItem[];
};

export type WorldPosition = {
  map: number;
  x: number;
  y: number;
  z: number;
  orientation: number;
};

export type ChatMessage = {
  type: number;
  typeName: string;
  language: number;
  senderGuid: bigint;
  senderName?: string;
  channel?: string;
  targetGuid: bigint;
  text: string;
  tag: number;
};

export type AuthResponse = {
  code: number;
  codeName: string;
  expansion?: number;
  queuePosition?: number;
};
