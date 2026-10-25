// Real-browser layout test (headless Chromium).
// Usage: npm install --no-save puppeteer-core @sparticuz/chromium && node tests/browser.test.js http://127.0.0.1:8000
// The server must use a disposable database: the test adds three rows for today.
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0, failures = 0;
const check = (name, cond, extra) => { checks++; if (!cond) { failures++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

(async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());   // YYYY-MM-DD, Tehran
  for (const [truck, count] of [[12, 5], [7, 3], [21, 8]]) {
    const r = await fetch(BASE + '/api/qaem/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_day: today, truck_id: truck, truck_service_count: count }) });
    check(`setup: row for truck ${truck}`, r.status === 201 || r.status === 409, r.status);
  }
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
  const problems = [];
  for (const w of [320, 360, 390, 768, 1280, 1920]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900 });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url()}`); });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    if (w === 1280) {
      check('page is Farsi + RTL', await page.evaluate(() => document.documentElement.lang === 'fa' && document.documentElement.dir === 'rtl'));
      check('bundled Vazirmatn font loaded', await page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Vazirmatn') && f.status === 'loaded')));
      check('text is rendered in Vazirmatn', await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Vazirmatn')));
    }
    check(`${w}px selector: no sideways overflow`, (await over()) === 0, await over());
    const cards = await page.$$eval('.project-card', (b) => b.map((x) => ({ disabled: x.disabled, inView: x.getBoundingClientRect().left >= 0 && x.getBoundingClientRect().right <= document.documentElement.clientWidth })));
    check(`${w}px selector: 3 cards, all inside the screen`, cards.length === 3 && cards.every((c) => c.inView), cards);

    await page.click('button[data-project=qaem]'); await sleep(700);
    check(`${w}px qaem page: no sideways overflow`, (await over()) === 0, await over());
    const fit = await page.$$eval('.scroll', (b) => b.map((x) => x.scrollWidth - x.clientWidth));
    if (w >= 360) check(`${w}px tables fit without inner scrolling (edit/delete reachable)`, fit.every((n) => n <= 1), fit);
    const rowBtns = await page.$$eval('tbody tr:first-child button', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth; }));
    if (w >= 360) check(`${w}px edit and delete buttons are on screen`, rowBtns.length === 2 && rowBtns.every(Boolean), rowBtns);

    await (await page.$('tbody tr:first-child button')).click(); await sleep(300);
    const dlg = await page.evaluate(() => { const d = document.querySelector('dialog'), r = d.getBoundingClientRect(); return { open: d.open, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; });
    check(`${w}px pop-up opens (native showModal) fully inside the screen`, dlg.open && dlg.inView, dlg);
    await page.keyboard.press('Escape'); await sleep(200);
    check(`${w}px Esc closes the pop-up`, await page.evaluate(() => !document.querySelector('dialog').open));
    await page.close();
  }
  check('no console errors, page errors, failed requests or HTTP errors', problems.length === 0, problems.slice(0, 5));
  await browser.close();
  console.log(`${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.message.split('\n')[0]); process.exit(1); });