import Client from './Client';
import EventType from './ui/scripting/EventType';
import { ModelFFX } from './ui/components';
import * as glueScriptFunctions from './ui/scripting/globals/glue';
import { session } from './game/GameSession';
import { SessionOverlay } from './ui/overlay/SessionOverlay';

const params = new URLSearchParams(document.location.search);
const api = params.get('api') || 'webgl2';

const canvas = document.querySelector('canvas')!;
const client = new Client(canvas, { api });

// TODO: Part of GlueMgr
client.ui.scripting.registerFunctions(glueScriptFunctions);
client.ui.factories.register('ModelFFX', ModelFFX);

// Handy from the devtools console while the UI is still growing input support.
Object.assign(window, { client, session });

// The frame engine cannot draw text or take input yet, so drive the session from a DOM
// panel in the meantime. It talks to the same GameSession the Lua glue API does.
if (params.get('overlay') !== '0') {
  new SessionOverlay(session);
}

(async () => {
  const started = performance.now();
  const ui = params.get('ui') ?? 'glue';
  if (ui === 'demo') {
    await client.ui.load('Wowser\\Wowser.toc');
  } else {
    await client.ui.load('Interface\\GlueXML\\GlueXML.toc');
  }

  const loadMs = Math.round(performance.now() - started);
  console.info(`UI loaded in ${loadMs}ms`);
  // Lets the verification scripts wait for a real signal rather than a fixed timeout.
  Object.assign(window, { wowserLoaded: true, wowserLoadMs: loadMs });
  window.dispatchEvent(new CustomEvent('wowser:loaded', { detail: { loadMs } }));

  // TODO: Should be handled by GlueMgr
  client.ui.scripting.signalEvent(EventType.FRAMES_LOADED);
  client.ui.scripting.signalEvent(EventType.SET_GLUE_SCREEN, '%s', 'login');

  let last = performance.now();
  const frame = (now: number) => {
    const elapsed = now - last;
    last = now;

    client.ui.root.onLayerUpdate(elapsed);
    client.screen.render();

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
})().catch((error: Error) => {
  console.error('client failed to start:', error);
});
