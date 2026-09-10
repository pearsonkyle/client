// Measures the render loop: frames per second, console volume, and GL object growth.
//
//   node tools/verify/perf.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

let consoleLines = 0;
page.on('console', () => consoleLines++);

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.wowserLoaded === true, { timeout: 120000 });
const loadMs = await page.evaluate(() => window.wowserLoadMs);

// Count GL object creation by wrapping the context factory before any frames run.
const sample = async (seconds) =>
  page.evaluate(
    (s) =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames++;
          if (performance.now() - start < s * 1000) {
            requestAnimationFrame(tick);
          } else {
            resolve({ frames, ms: performance.now() - start });
          }
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );

const before = consoleLines;
const { frames, ms } = await sample(5);
const during = consoleLines - before;

console.log(`load:          ${loadMs}ms`);
console.log(`fps:           ${(frames / (ms / 1000)).toFixed(1)} (${frames} frames in ${Math.round(ms)}ms)`);
console.log(`console lines: ${during} during 5s of rendering (${consoleLines} total)`);

const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
if (heap) console.log(`js heap:       ${(heap / 1048576).toFixed(1)} MB`);

await page.screenshot({ path: 'client.png' });
console.log('screenshot ->  client.png');
await browser.close();
