// Loads the client in a headless browser and reports what broke.
//
//   node tools/verify/browser.mjs [url] [--shot out.png] [--wait ms]
//
// The UI engine logs every Lua file it executes, so the console runs to six figures of
// lines; only errors, warnings and load timings are printed.

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] ? args[at + 1] : fallback;
};
const shot = flag('shot', 'client.png');
const wait = Number(flag('wait', 45000));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const logs = [];
const httpErrors = [];
const failures = [];

page.on('console', (message) => logs.push(`[${message.type()}] ${message.text().slice(0, 400)}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('response', (response) => {
  if (response.status() >= 400) {
    httpErrors.push(`${response.status()} ${response.url()}`);
  }
});
page.on('requestfailed', (request) =>
  failures.push(`${request.url()} :: ${request.failure()?.errorText}`),
);

console.log(`loading ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(wait);

const notable = logs.filter((line) =>
  /\[error\]|\[pageerror\]|\[warning\]|Client load time|could not|unable|unsupported|unknown/i.test(
    line,
  ),
);

// Warnings repeat once per frame that hits them; collapse them.
const counted = new Map();
for (const line of notable) {
  counted.set(line, (counted.get(line) ?? 0) + 1);
}

console.log(`\nconsole lines: ${logs.length}`);
console.log(`notable (deduped): ${counted.size}`);
for (const [line, count] of [...counted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${count > 1 ? `x${count} ` : ''}${line}`);
}

console.log(`\nHTTP >= 400: ${httpErrors.length}`);
console.log(httpErrors.slice(0, 20).map((e) => `  ${e}`).join('\n'));
console.log(`request failures: ${failures.length}`);
console.log(failures.slice(0, 10).map((e) => `  ${e}`).join('\n'));

await page.screenshot({ path: shot });
console.log(`\nscreenshot -> ${shot}`);

await browser.close();
process.exit(httpErrors.length > 0 || failures.length > 0 ? 1 : 0);
