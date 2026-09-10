// Drives the real Blizzard login screen with mouse and keyboard - no DOM overlay.
//
//   node tools/verify/input.mjs [url]

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/?overlay=0';
const ACCOUNT = process.env.WOWSER_ACCOUNT ?? 'WOWSER1';
const PASSWORD = process.env.WOWSER_PASSWORD ?? 'TEST1234';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.wowserLoaded === true, { timeout: 120000 });
await page.waitForTimeout(1500);

// Where is the account edit box, in screen pixels?
const box = await page.evaluate(() => {
  const sc = window.client.ui.scripting;
  const root = window.client.ui.root;
  const canvas = document.querySelector('canvas');
  // Mirror InputManager.toLayout exactly, including the canvas's position on the page.
  const bounds = canvas.getBoundingClientRect();
  const toScreen = (frame) => {
    const r = frame?.getRect?.();
    if (!r) return null;
    const rr = root.rect;
    const u = ((r.minX + r.maxX) / 2 - rr.minX) / (rr.maxX - rr.minX);
    const v = 1 - ((r.minY + r.maxY) / 2 - rr.minY) / (rr.maxY - rr.minY);
    return { x: bounds.left + u * bounds.width, y: bounds.top + v * bounds.height };
  };
  return {
    account: toScreen(sc.getObjectByName('AccountLoginAccountEdit')),
    password: toScreen(sc.getObjectByName('AccountLoginPasswordEdit')),
    login: toScreen(sc.getObjectByName('AccountLoginLoginButton')),
  };
});
console.log('hit targets:', JSON.stringify(box));

const state = () =>
  page.evaluate(() => {
    const sc = window.client.ui.scripting;
    const a = sc.getObjectByName('AccountLoginAccountEdit');
    const p = sc.getObjectByName('AccountLoginPasswordEdit');
    return {
      account: a?.text, accountFocus: a?.hasFocus,
      password: p?.text, passwordFocus: p?.hasFocus,
      sessionState: window.session?.state,
    };
  });

console.log('\nclicking the account field...');
await page.mouse.click(box.account.x, box.account.y);
console.log(JSON.stringify(await state()));

console.log(`\ntyping ${ACCOUNT}...`);
await page.keyboard.type(ACCOUNT, { delay: 20 });
console.log(JSON.stringify(await state()));

console.log('\nclicking the password field and typing...');
await page.mouse.click(box.password.x, box.password.y);
await page.keyboard.type(PASSWORD, { delay: 20 });
console.log(JSON.stringify(await state()));

console.log('\nclicking Login...');
await page.mouse.click(box.login.x, box.login.y);
await page.waitForTimeout(6000);
console.log(JSON.stringify(await state()));

// Where the frames are moves as screens change, so re-resolve each time.
const locate = (name) =>
  page.evaluate((n) => {
    const sc = window.client.ui.scripting;
    const root = window.client.ui.root.rect;
    const canvas = document.querySelector('canvas');
    const b = canvas.getBoundingClientRect();
    const o = sc.getObjectByName(n);
    const r = o?.getRect?.();
    if (!r) return null;
    const u = ((r.minX + r.maxX) / 2 - root.minX) / (root.maxX - root.minX);
    const v = 1 - ((r.minY + r.maxY) / 2 - root.minY) / (root.maxY - root.minY);
    return { x: b.left + u * b.width, y: b.top + v * b.height, shown: o.visible };
  }, name);

console.log('\nrealm dialog -> selecting the first realm and clicking Okay...');
const realmRow = await locate('RealmListRealmButton1');
if (realmRow) {
  await page.mouse.click(realmRow.x, realmRow.y);
  await page.waitForTimeout(300);
}
const okay = await locate('RealmListOkButton');
if (okay) {
  await page.mouse.click(okay.x, okay.y);
}
await page.waitForTimeout(8000);
console.log(JSON.stringify(await state()));

console.log('\ncharacter select -> Enter World...');
const enter = await locate('CharSelectEnterWorldButton');
console.log('enter world button:', JSON.stringify(enter));
if (enter) {
  await page.mouse.click(enter.x, enter.y);
  await page.waitForTimeout(10000);
}
const final = await state();
console.log(JSON.stringify(final));

await page.screenshot({ path: 'input.png' });
console.log('\nscreenshot -> input.png');
console.log('page errors:', errors.length);
errors.slice(0, 5).forEach((e) => console.log('  ' + e));
await browser.close();
