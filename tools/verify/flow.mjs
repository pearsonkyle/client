// Drives the browser client through the full flow against the live server:
// login -> realm -> character -> enter world -> say. This is the M3 acceptance test.
//
//   node tools/verify/flow.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const ACCOUNT = process.env.WOWSER_ACCOUNT ?? 'WOWSER1';
const PASSWORD = process.env.WOWSER_PASSWORD ?? 'TEST1234';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log(`  [pageerror] ${e.message}`); });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    const text = m.text();
    if (!/could not find relative frame|GL Driver/.test(text)) {
      console.log(`  [${m.type()}] ${text.slice(0, 300)}`);
    }
  }
});
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

const step = (msg) => console.log(`\n== ${msg}`);
const statusText = () => page.locator('.wo-status').textContent();

step(`loading ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.wo-overlay', { timeout: 30000 });
await page.waitForFunction(() => window.wowserLoaded === true, { timeout: 120000 });
console.log(`UI loaded in ${await page.evaluate(() => window.wowserLoadMs)}ms`);

step('logging in');
await page.fill('.wo-overlay input[type="text"]', ACCOUNT);
await page.fill('.wo-overlay input[type="password"]', PASSWORD);
await page.click('.wo-overlay button.wo-action');

// The realm list appears once SRP6 and the realm request are done.
await page.waitForSelector('.wo-item', { timeout: 30000 });
const realms = await page.locator('.wo-item').allTextContents();
console.log(`realms: ${realms.map((r) => r.replace(/\s+/g, ' ').trim()).join(' | ')}`);

step('selecting realm');
await page.locator('.wo-item').first().click();

await page.waitForFunction(
  () => document.querySelector('.wo-hint')?.textContent?.includes('character'),
  { timeout: 40000 },
);
const characters = await page.locator('.wo-item').allTextContents();
console.log(`characters: ${characters.map((c) => c.replace(/\s+/g, ' ').trim()).join(' | ')}`);

if (characters.length === 0) {
  console.log('no characters; the flow test needs one created by the headless CLI first');
  await browser.close();
  process.exit(1);
}

step('entering world');
await page.locator('.wo-item').first().click();
await page.getByRole('button', { name: /Enter World/i }).click();

await page.waitForSelector('.wo-chat', { timeout: 60000 });
await page.waitForTimeout(4000);

const hint = await page.locator('.wo-hint').first().textContent();
console.log(`in world: ${hint}`);

step('saying hello');
const chatInput = page.locator('.wo-overlay input[type="text"]').last();
await chatInput.fill('hello from the browser');
await chatInput.press('Enter');
await page.waitForTimeout(3000);

const chatLines = await page.locator('.wo-chat div').allTextContents();
console.log('chat log:');
for (const line of chatLines) {
  console.log(`  ${line}`);
}

await page.screenshot({ path: 'flow.png' });
console.log('\nscreenshot -> flow.png');

const echoed = chatLines.some((l) => l.includes('hello from the browser'));
console.log(`\nserver echoed our /say: ${echoed}`);
console.log(`page errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log(`  ${e}`));

await browser.close();
process.exit(echoed && errors.length === 0 ? 0 : 1);
