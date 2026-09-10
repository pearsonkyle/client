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
