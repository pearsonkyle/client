import { defineConfig } from 'vite';

// Everything the client needs is proxied through the Vite origin: the asset server on
// /asset and the ws-to-tcp bridge on /bridge. That keeps the browser same-origin (no
// CORS, no mixed content) and means only one port has to be reachable - which is what
// makes this work unchanged over Tailscale.
const ASSET_SERVER = process.env.WOWSER_ASSET_SERVER ?? 'http://127.0.0.1:8766';
const BRIDGE = process.env.WOWSER_BRIDGE ?? 'ws://127.0.0.1:8765';

export default defineConfig(({ command }) => ({
  // Ensure non-existent files produce 404s
  appType: 'mpa',
  assetsInclude: ['**/*.lua'],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/wowser-client-[hash].js',
      },
    },
  },
  define: {
    // Configure Fengari to not suffix Lua integers with `.0` when string formatted
    // See: https://github.com/fengari-lua/fengari/issues/113
    'process.env.FENGARICONF': JSON.stringify(JSON.stringify({ LUA_COMPAT_FLOATSTRING: true })),
  },
  plugins: [
    {
      name: 'Prevent Fengari from loading Node-only libraries',
      transform(src, id) {
        // See: https://github.com/fengari-lua/fengari/blob/master/src/loslib.js#L480-L489
        if (id.includes('fengari')) {
          return {
            code: src.replaceAll('typeof process', JSON.stringify('undefined'))
          };
        }
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Vite blocks requests whose Host header it does not recognise. Allow this machine's
    // Tailscale names so the client can be opened from another device on the tailnet.
    allowedHosts: ['localhost', '.ts.net'],
    proxy: {
      '/asset': {
        target: ASSET_SERVER,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/asset/, ''),
      },
      '/bridge': {
        target: BRIDGE,
        ws: true,
        rewrite: (path) => path.replace(/^\/bridge/, ''),
      },
    },
  },
  // Do not include local game files into a production build
  publicDir: command === 'build' ? false : 'public'
}));
