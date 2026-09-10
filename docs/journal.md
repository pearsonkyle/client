# Journal

## Plan

Revive `wowserhq/client` (TS/Vite/WebGL2 FrameXML engine, no networking) and connect it to
a local AzerothCore 3.3.5a server, milestone by milestone:

- **M0** server up, account made, client builds — done
- **M1** isomorphic protocol library + headless SRP6 login + realm list — done
- **M2** world handshake, char enum/create, enter world, chat — in progress
- **M3** ws↔tcp bridge + real Blizzard glue screens in the browser
- **M4** asset server over the MPQ chain, in-browser BLP
- **M5** terrain + entities at the login position
- **M6** movement
- **M7** in-game HUD and beyond

Protocol code lives in `src/net` and imports neither DOM nor Node APIs, so the same
parsers run in the browser and in `tools/headless`. Only the `Transport` is implemented
twice.

## 2026-09-10 — M0: environment

Machine already had Docker, nvm/Node 24, cmake and Claude Code; only the game client and
the GitHub fork were missing.

- AzerothCore stack up from prebuilt `acore/ac-wotlk-*` images (no source build).
  authserver 3724, worldserver 8085, MySQL 3306. Client data (maps/vmaps/mmaps/dbc)
  downloaded into the `ac-client-data` volume.
- `docker-compose.override.yml` sets `AC_WARDEN_ENABLED=0`, `AC_REALM_ID=1`,
  `AC_PACKET_LOG_FILE=World.pkt`. Confirmed in the logs: *"Warden disabled, loading checks
  skipped."* AzerothCore's `Config.cpp` prefers `AC_`-prefixed environment variables over
  the `.conf` file, so the file still reading `Warden.Enabled = 1` is expected and
  harmless.
- Account `WOWSER1` / `TEST1234` created, expansion 2.
- realmlist row is `id=1, AzerothCore, 127.0.0.1:8085, gamebuild=12340`.
- Client: `lint`, `typecheck`, `test`, `build` all pass on Node 24.21.0 with no changes.
  The Node-22 breakage the brief warned about (husky 4, Babel-Jest) did not materialise.

**Surprise:** the worldserver console refuses `docker attach` when stdin is not a TTY, so
scripted console commands need `script -qec ... /dev/null` to fake one. Recorded in the
repo README.

## 2026-09-10 — M1: protocol library and headless auth

`src/net/{bytes,crypto,auth,transport}` plus `tools/headless`. The headless CLI completes
a real SRP6 login against the live authserver:

```
LOGON_CHALLENGE ok
LOGON_PROOF ok (M2 verified), session key 4fc48c18b4f7e062... (40B)
REALM_LIST ok (1 realm)
  AzerothCore 127.0.0.1:8085 id=1 chars=0 pop=0.0 online
```

Wrong password and unknown account both fail cleanly with `FAIL_UNKNOWN_ACCOUNT` —
AzerothCore deliberately returns the same code for both so accounts cannot be enumerated.

**What bit, and what the tests now pin down:**

1. **N is written big-endian but travels little-endian.** The constant in the docs is
   `0x894B645E...B7`; AzerothCore builds its array with `HexStrToByteArray<32>(..., true)`
   — reversed — and `BigNumber` reads arrays little-endian. Feeding the hex string
   straight into `bigIntFromLE` produces a mirrored modulus and a verifier that matches
   nothing. `SRP6_N` is now stored in wire order with a test asserting it.
2. **The K interleave must skip leading zero bytes of S.** Ported per
   `SRP6::SHA1Interleave`. This is the ~1-in-256 login failure the 2015 wowser had.
3. **Uppercasing** is done inside `calculateX`/`srp6Proof` rather than trusted to call
   sites — it is invisible when wrong and produces the same useless error as a bad
   password.
4. **Auth frames are not uniformly length-prefixed.** Each opcode has its own shape and
   two vary with their own contents, so `authFrameSize` has to understand the packets.
   A version rejection is 2 bytes, every other proof failure is 4, success is 32.
5. **An open socket keeps Node alive.** The first failure-path run hung for two minutes
   because the CLI only closed the transport on success.

The SRP6 test recomputes the verifier the server actually stored for `WOWSER1` from the
salt in `acore_auth.account`, so the whole hashing path is pinned to real server data
rather than to my own output. If that account is recreated, the salt and verifier
constants in `crypto.test.ts` must be recaptured together.

Also bumped CI from Node 18/20 to 22/24 to match `engines.node`.

**Next:** M2 — world header crypt (RC4 drop-1024 keyed by HMAC-SHA1 of the session key),
`CMSG_AUTH_SESSION`, char enum/create, enter world, chat.

## 2026-09-10 — M2: world handshake, characters, world entry, chat

`src/net/world/*` plus a `play` command on the headless CLI. Against the live server:

```
AUTH_OK expansion=2
SMSG_CHAR_ENUM: 0 character(s)
creating character Wowsertest (race 1, class 1)
entering world as Wowsertest
LOGIN_VERIFY_WORLD map=0 x=-8949.95 y=-132.49 z=83.53 o=0.00
saying: hello from wowser
  [SAY] Wowsertest: hello from wowser
SMSG_LOGOUT_COMPLETE
```

That position is Northshire Abbey, the Human starting point — the right answer, not just
a well-formed one. `account onlinelist` on the worldserver showed
`[WOWSER1][Wowsertest][172.19.0.1][0][12][2][0]` — map 0, zone 12 (Elwynn Forest) — while
the session was up. A 150-second run logged out cleanly with no disconnect, so the 30s
keepalive is working.

The 1306-entry opcode table is generated from `Opcodes.h` by `tools/codegen/opcodes.mjs`
rather than typed by hand.

**What bit:**

1. **`ByteWriter` corrupted any packet that outgrew its initial buffer.**
   `this.view.setUint32(this.grow(4), value, true)` evaluates `this.view` *before*
   calling `grow()`, so when `grow()` reallocated and replaced the DataView the write
   went to the old one and threw `Offset is outside the bounds of the DataView`. Nothing
   had hit it yet because every packet built so far fit in its initial capacity; the
   first `SMSG_CHAR_ENUM` fixture (a ~380-byte entry) found it immediately. Every writer
   now captures the offset into a local first, and there is a test that writes 100 u32s
   into an 8-byte writer.
2. **Server headers must be decrypted a byte at a time.** Whether the header is 4 or 5
   bytes is only knowable after the first byte is in the clear, and RC4 state cannot be
   rewound — so a header that arrives split has to keep its decrypted prefix.
   `WorldFrameReader` pulls single bytes and holds partial header state; there is a test
   that feeds a packet one byte at a time.
3. **Name resolution is asynchronous but chat is not.** `SMSG_MESSAGECHAT` carries only a
   GUID for player messages, so our own first line rendered as `guid:1`. The character
   list already has the name, so it is now seeded into the cache before entering the
   world.
4. Replies to `CMSG_NAME_QUERY` are matched by GUID rather than by arrival order, since
   several can be outstanding at once.

**Unhandled-opcode backlog** after 150 seconds in Elwynn Forest — the shape of the work
still to come: `SMSG_MONSTER_MOVE` x578, `SMSG_AURA_UPDATE_ALL` x90,
`SMSG_COMPRESSED_UPDATE_OBJECT` x73, `SMSG_DESTROY_OBJECT` x68, `SMSG_UPDATE_OBJECT` x11,
and 25 other kinds seen once or twice.

**Next:** M3 — ws↔tcp bridge (written) and the real Blizzard glue screens in the browser.
