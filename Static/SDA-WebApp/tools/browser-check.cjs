'use strict';
const { createRequire } = require('node:module');
const { fs, path, root, contract, sha, argument, writeNew } = require('./common.cjs');
const { startHost } = require('./check-host.cjs');
const playwright = createRequire(path.join(root, 'SDA-Standalone/package.json'))('playwright');
(async () => {
  const run = argument('--run'); if (!run || fs.existsSync(run)) throw Error('Fresh --run required');
  fs.mkdirSync(run, { recursive: true });
  let host, browser, rows = [], network = [], consoleErrors = [], remoteChecks = [], channel = 'msedge';
  const check = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
  try {
    host = await startHost();
    try { browser = await playwright.chromium.launch({ channel, headless: true }); }
    catch (error) {
      writeNew(path.join(run, 'edge-launch-failure.json'), { error: error.message });
      channel = 'playwright-chromium'; browser = await playwright.chromium.launch({ headless: true });
    }
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('requestfailed', request => network.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on('pageerror', error => consoleErrors.push(error.message));
    const calls = []; page.on('request', request => { const url = new URL(request.url()); if ((url.origin === host.origin && url.pathname.startsWith('/api/')) || url.hostname === 'challenges.cloudflare.com') calls.push({ url: request.url(), method: request.method() }); });
    await page.goto(host.origin, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    check('home-rendered', await page.locator('body').isVisible() && (await page.title()).length > 0);
    const expectedHome = fs.readFileSync(path.join(root, 'SDA-Standalone/index.html'), 'utf8');
    const actualFrames = await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.getAttribute('src')));
    const expectedFrames = await page.evaluate(html => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('iframe'), frame => frame.getAttribute('src')), expectedHome);
    check('home-iframe-src-query-exact', JSON.stringify(actualFrames) === JSON.stringify(expectedFrames), { actualFrames, expectedFrames });
    const frame = page.frames().find(item => item.url().startsWith('https://frame.sda.studio'));
    if (frame) {
      try {
        await frame.waitForFunction(() => Array.from(document.querySelectorAll('img')).some(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0), { timeout: 15000 });
        remoteChecks.push({ name: 'representative-frame-render', outcome: 'observed', url: frame.url(), loadedImages: await frame.locator('img').evaluateAll(images => images.filter(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0).length) });
      }
      catch (error) { remoteChecks.push({ name: 'representative-frame-render', outcome: 'dependency-blocked', url: frame.url(), error: error.message }); }
    } else remoteChecks.push({ name: 'representative-frame-render', outcome: 'dependency-blocked', reason: 'Remote Frame document not available during observation' });
    await page.screenshot({ path: path.join(run, 'home-desktop.png'), fullPage: false });
    const art = page.locator('a[href="/art"]').first();
    await art.click(); await page.waitForURL(host.origin + '/art');
    check('home-to-art-navigation', new URL(page.url()).pathname === '/art');
    const response = await page.goto(host.origin + '/art/galleries/advanced-aether-adworks', { waitUntil: 'domcontentloaded' });
    check('nested-route-reload', response.status() === 200 && (await page.reload({ waitUntil: 'domcontentloaded' })).status() === 200);
    await page.goto(host.origin + '/about-sda/contact', { waitUntil: 'domcontentloaded' });
    const form = page.locator('#sda-contact');
    check('contact-disabled-public-config', await form.getAttribute('data-enabled') === 'false' && await form.getAttribute('data-sitekey') === '');
    check('contact-native-validation', !(await form.evaluate(element => element.checkValidity())));
    for (const [name, value] of [['37', 'Migration'], ['38', 'Fixture'], ['39', 'fixture@example.invalid'], ['41', 'Local browser verification only.']]) await form.locator(`[name="akID[${name}][value]"]`).fill(value);
    await form.locator('input[type="checkbox"]').first().check();
    check('contact-editable-valid', await form.evaluate(element => element.checkValidity()));
    await form.evaluate(element => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    check('contact-unavailable-feedback', /unavailable|not configured/i.test(await page.locator('#contact-status').innerText()));
    check('contact-no-api-or-challenge-request', calls.length === 0, calls);
    check('contact-no-recipient-fallback', !(await page.content()).includes('contact@sda.studio'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(host.origin, { waitUntil: 'domcontentloaded' });
    const toggle = page.locator('.animenu__toggle');
    check('mobile-menu-toggle-visible', await toggle.isVisible());
    await toggle.click();
    check('mobile-menu-opens', await page.locator('.animenu__nav').evaluate(element => element.classList.contains('animenu__nav--open')));
    check('inherited-mobile-overflow-retained', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth));
    await page.screenshot({ path: path.join(run, 'home-mobile.png'), fullPage: false });
    check('no-local-network-failure', !network.some(item => item.url.startsWith(host.origin)), network);
    check('no-new-browser-exception', consoleErrors.length === 0, consoleErrors);
  } catch (error) { rows.push({ name: 'execution', pass: false, detail: error.stack }); }
  finally { if (browser) await browser.close(); if (host) { host.child.kill(); fs.writeFileSync(path.join(run, 'host.txt'), host.output(), { flag: 'wx' }); } }
  const result = { capturedUtc: new Date().toISOString(), channel, contractSha256: sha(fs.readFileSync(path.join(__dirname, '../content-contract.json'))), counts: { pass: rows.filter(r => r.pass).length, fail: rows.filter(r => !r.pass).length, total: rows.length }, rows, network, consoleErrors, remoteChecks };
  writeNew(path.join(run, 'result.json'), result); console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(r => !r.pass), remoteChecks }));
  if (result.counts.fail) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
