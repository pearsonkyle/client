import { ByteWriter, fromHex } from '../bytes';
import { parseCharEnum, parseChatMessage } from './WorldClient';
import { ChatMessageType, Language, Race, CharacterClass } from './types';

// Builds one SMSG_CHAR_ENUM entry per Player::BuildEnumData.
const charEnumEntry = (overrides: Partial<{ guid: bigint; name: string; level: number }> = {}) => {
  const writer = new ByteWriter(256)
    .u64(overrides.guid ?? 1n)
    .cstring(overrides.name ?? 'Wowsertest')
    .u8(Race.HUMAN)
    .u8(CharacterClass.WARRIOR)
    .u8(0) // gender
    .u8(1) // skin
    .u8(2) // face
    .u8(3) // hair style
    .u8(4) // hair colour
    .u8(5) // facial style
    .u8(overrides.level ?? 1)
    .u32(12) // zone: Elwynn Forest
    .u32(0) // map: Eastern Kingdoms
    .f32(-8949.95)
    .f32(-132.49)
    .f32(83.53)
    .u32(0) // guild
    .u32(0) // flags
    .u32(0) // customize flags
    .u8(1) // first login
    .u32(0) // pet display
    .u32(0) // pet level
    .u32(0); // pet family

  for (let slot = 0; slot < 23; slot++) {
    writer.u32(slot === 0 ? 1234 : 0).u8(slot).u32(0);
  }
  return writer.data();
};

const withCount = (count: number, ...entries: Uint8Array[]) => {
  const writer = new ByteWriter(512).u8(count);
  for (const entry of entries) {
    writer.bytes(entry);
  }
  return writer.data();
};

describe('parseCharEnum', () => {
  it('parses an empty character list', () => {
    expect(parseCharEnum(fromHex('00'))).toEqual([]);
  });

  it('parses a single character', () => {
    const characters = parseCharEnum(withCount(1, charEnumEntry()));
    expect(characters).toHaveLength(1);

    const character = characters[0]!;
    expect(character.guid).toBe(1n);
    expect(character.name).toBe('Wowsertest');
    expect(character.race).toBe(Race.HUMAN);
    expect(character.class).toBe(CharacterClass.WARRIOR);
    expect(character.level).toBe(1);
    expect(character.zone).toBe(12);
    expect(character.map).toBe(0);
    expect(character.x).toBeCloseTo(-8949.95, 1);
    expect(character.y).toBeCloseTo(-132.49, 1);
    expect(character.z).toBeCloseTo(83.53, 1);
    expect(character.firstLogin).toBe(true);
  });

  it('reads all 23 equipment slots, so entries stay aligned', () => {
    const characters = parseCharEnum(withCount(1, charEnumEntry()));
    expect(characters[0]!.items).toHaveLength(23);
    expect(characters[0]!.items[0]!.displayId).toBe(1234);
    expect(characters[0]!.items[5]!.inventoryType).toBe(5);
  });

  it('parses several characters, which only works if each entry is fully consumed', () => {
    const payload = withCount(
      2,
      charEnumEntry({ guid: 1n, name: 'Wowsertest', level: 1 }),
      charEnumEntry({ guid: 9n, name: 'Seconda', level: 42 }),
    );
    const characters = parseCharEnum(payload);

    expect(characters.map((c) => c.name)).toEqual(['Wowsertest', 'Seconda']);
    expect(characters[1]!.guid).toBe(9n);
    expect(characters[1]!.level).toBe(42);
  });

  it('handles names of different lengths', () => {
    const characters = parseCharEnum(
      withCount(2, charEnumEntry({ name: 'Al' }), charEnumEntry({ name: 'Bartholomew' })),
    );
    expect(characters.map((c) => c.name)).toEqual(['Al', 'Bartholomew']);
  });
});

describe('parseChatMessage', () => {
  const say = (text: string) =>
    new ByteWriter(128)
      .u8(ChatMessageType.SAY)
      .u32(Language.COMMON)
      .u64(1n) // sender
      .u32(0)
      .u64(0n) // target
      .u32(text.length + 1)
      .cstring(text)
      .u8(0) // chat tag
      .data();

  it('parses a say from another player', () => {
    const message = parseChatMessage(say('hello from wowser'));
    expect(message.type).toBe(ChatMessageType.SAY);
    expect(message.typeName).toBe('SAY');
    expect(message.language).toBe(Language.COMMON);
    expect(message.senderGuid).toBe(1n);
    expect(message.text).toBe('hello from wowser');
    expect(message.tag).toBe(0);
  });

  it('fills in the sender name from the cache when the packet carries only a GUID', () => {
    const cache = new Map([[1n, 'Wowsertest']]);
    expect(parseChatMessage(say('hi'), cache).senderName).toBe('Wowsertest');
  });

  it('leaves the sender name undefined when the GUID is unknown', () => {
    expect(parseChatMessage(say('hi')).senderName).toBeUndefined();
  });

  it('reads the inline sender name that monster messages carry', () => {
    const name = 'Marshal McBride';
    const payload = new ByteWriter(160)
      .u8(ChatMessageType.MONSTER_SAY)
      .u32(Language.UNIVERSAL)
      .u64(0xf130000123n)
      .u32(0)
      .u32(name.length + 1)
      .cstring(name)
      .u64(0n)
      .u32(6)
      .cstring('Hello')
      .u8(0)
      .data();

    const message = parseChatMessage(payload);
    expect(message.typeName).toBe('MONSTER_SAY');
    expect(message.senderName).toBe(name);
    expect(message.text).toBe('Hello');
  });

  it('reads the channel name that channel messages carry', () => {
    const payload = new ByteWriter(160)
      .u8(ChatMessageType.CHANNEL)
      .u32(Language.COMMON)
      .u64(2n)
      .u32(0)
      .cstring('General - Elwynn Forest')
      .u64(0n)
      .u32(4)
      .cstring('yo')
      .u8(0)
      .data();

    const message = parseChatMessage(payload);
    expect(message.channel).toBe('General - Elwynn Forest');
    expect(message.text).toBe('yo');
  });

  it('handles an empty message body', () => {
    const payload = new ByteWriter(64)
      .u8(ChatMessageType.SAY)
      .u32(Language.COMMON)
      .u64(1n)
      .u32(0)
      .u64(0n)
      .u32(0)
      .u8(0)
      .data();
    expect(parseChatMessage(payload).text).toBe('');
  });

  it('names unknown chat types rather than throwing', () => {
    const payload = new ByteWriter(64)
      .u8(0xfe)
      .u32(0)
      .u64(0n)
      .u32(0)
      .u64(0n)
      .u32(2)
      .cstring('x')
      .u8(0)
      .data();
    expect(parseChatMessage(payload).typeName).toBe('UNKNOWN_0xfe');
  });
});
