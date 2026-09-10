# Wowser Client

[![Join Community](https://badgen.net/badge/discord/join%20community/blue)](https://discord.gg/DeVVKVg)
![Version](https://badgen.net/badge/npm/n%2Fa/gray)
[![MIT License](https://badgen.net/github/license/wowserhq/client)](LICENSE)
[![CI](https://github.com/wowserhq/client/workflows/ci/badge.svg)](https://github.com/wowserhq/client/actions?query=workflow%3Aci)
[![Test Coverage](https://codecov.io/gh/wowserhq/client/branch/master/graph/badge.svg)](https://codecov.io/gh/wowserhq/client)

World of Warcraft in the browser using JavaScript and WebGL.

This repository contains the web client.

## Background

Wowser is a proof-of-concept of getting a triple-A game to run in a webbrowser.

See the [Wowser] umbrella repository for more information.

## Status

This repository contains the Wowser web client, which currently has support for:

- Loading Blizzard UI files (`.toc`, `.xml` and `.lua`) - the full `GlueXML.toc` loads
- Extremely primitive scene rendering using WebGL 2 (frames and textures mostly)
- GLSL ES 300 shaders and BLP textures, decoded in the browser
- Reading game data straight out of the client's MPQ archives, over a local asset server
- Networking: SRP6 login, realm list, character list and creation, entering the world,
  and chat, against a local [AzerothCore] server

Not yet: text rendering (`FontString.draw` is a stub) and input dispatch to frames. Until
those land, a DOM overlay drives the session so the client is usable.

**Note:** Only Wrath of the Lich King (3.3.5a) is currently supported. A copy of
the official client is required.

## Development

Wowser is written in [TypeScript] and developed with [vite].

1. Clone the repository:

   ```shell
   git clone git://github.com/wowserhq/wowser.git
   ```

2. Download and install [Node.js] 22.12+ for your platform.

3. Install dependencies:

   ```shell
   npm install
   ```

4. Point `WOW_CLIENT` at a Wrath of the Lich King (3.3.5a) client directory - the one
   containing `Data/`. Nothing needs extracting or converting: the asset server reads
   the MPQ archives directly, and BLP textures are decoded in the browser.

   ```shell
   export WOW_CLIENT=/path/to/wow-335a
   ```

5. Run everything - asset server, ws-to-tcp bridge and dev server:

   ```shell
   npm run serve
   ```

   The dev server proxies the other two, so the browser only ever talks to one origin.
   It prints every address the client can be opened at.

   **Disclaimer:** Wowser serves up resources to the browser over HTTP. Depending
   on your network configuration these may be available to others. Respect laws and
   do not distribute game data you do not own.

### Talking to a server

The browser cannot open raw TCP sockets, so `npm run serve` also starts a WebSocket
bridge. It only connects to targets on its allowlist (`WOWSER_BRIDGE_TARGETS`, default
`127.0.0.1:3724,127.0.0.1:8085`) so it cannot be used as an open proxy.

There is also a headless client, which is how every protocol change is verified before
the browser depends on it:

```shell
npm run headless -- login --user ACCOUNT --pass PASSWORD
npm run headless -- play  --user ACCOUNT --pass PASSWORD --say "hello"
```

And a browser acceptance test that drives the whole flow in Chromium:

```shell
npm run verify:flow
```

## Contribution

When contributing, please:

- Fork the repository
- Open a pull request (preferably on a separate branch)

## License

Except where otherwise noted, Wowser Client is copyright © 2019-2024 Wowser Contributors. It is licensed
under the **MIT license**. See [`LICENSE`](LICENSE) for more information.

[AzerothCore]: https://www.azerothcore.org/
[ECMAScript modules]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
[Node.js]: http://nodejs.org/#download
[StormLib]: https://github.com/wowserhq/blizzardry#mpq
[TypeScript]: https://www.typescriptlang.org/
[Wowser]: https://github.com/wowserhq/wowser
[vite]: https://vitejs.dev/
