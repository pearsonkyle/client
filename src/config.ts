// Runtime configuration, overridable with URL query parameters.
//
// Defaults are derived from the page's own origin so the client works unchanged whether
// it is opened at localhost or over a Tailscale address from another device.

const params = new URLSearchParams(
  typeof document === 'undefined' ? '' : document.location.search,
);

const origin = typeof document === 'undefined' ? 'http://localhost:5173' : document.location.origin;

/** Base URL for game assets, served out of the client's MPQ chain. */
export const assetBase = params.get('assets') ?? `${origin}/asset`;

/** The ws-to-tcp bridge, proxied through the Vite origin by default. */
export const bridgeBase =
  params.get('bridge') ?? `${origin.replace(/^http/, 'ws')}/bridge`;

export const bridgeUrl = (host: string, port: number): string =>
  `${bridgeBase}/?target=${encodeURIComponent(`${host}:${port}`)}`;

/** Where the auth server lives, as the bridge sees it. */
export const authHost = params.get('authHost') ?? '127.0.0.1';
export const authPort = Number(params.get('authPort') ?? 3724);

export const locale = params.get('locale') ?? 'enUS';

export const build = {
  build: Number(params.get('build') ?? 12340),
  majorVersion: 3,
  minorVersion: 3,
  patchVersion: 5,
  platform: 'x86',
  os: 'Win',
  locale,
  timezone: 0,
};

/**
 * Paths served from the repo's own `public/` directory rather than from the game client.
 *
 * `Shaders/` are Wowser's GLSL, and `Wowser/` is its demo frame - neither exists in any
 * MPQ, so they must not be looked up on the asset server.
 */
const LOCAL_PREFIXES = ['shaders/', 'wowser/'];

/**
 * Resolves a game asset path - as written in the UI's XML and Lua, with backslashes and
 * inconsistent case - to a URL.
 */
export const assetUrl = (gamePath: string): string => {
  const normalized = gamePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const encoded = normalized.split('/').map(encodeURIComponent).join('/');

  const lower = normalized.toLowerCase();
  if (LOCAL_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return `${origin}/${encoded}`;
  }

  return `${assetBase}/${encoded}`;
};
