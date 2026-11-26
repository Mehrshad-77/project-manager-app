// Real-browser test of the invoice tab (headless Chromium): the Excel button must post the form into the hidden frame,
// the server must answer with the .xlsx, the page must stay where it is, and nothing may overflow sideways.
// Usage: npm install --no-save puppeteer-core @sparticuz/chromium && node tests/invoice.browser.test.js http://127.0.0.1:8000
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const fs = require('fs');
const DL = '/tmp/invoice-downloads';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0, failures = 0;
const check = (name, cond, extra) => { checks++; if (!cond) { failures++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

(async () => {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: 'shell' });
  const problems = [];
  for (const w of [360, 390, 768, 1280]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: 900 });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) problems.push(`console: ${m.text()}`); });   // (404 = the browser asking for a favicon)
    await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await page.click('button[data-project=shahran]'); await sleep(500);
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === 'فاکتور شاتکریت کوهسار').click()); await sleep(300);
    const type = async (sel, v) => { await page.click(sel, { clickCount: 3 }); await page.type(sel, v); };
    await type('[name=invoice_number]', '۴');
    await type('[name=contractor_name]', 'پیمانکاری اسکندری');
    await type('[name=item_description]', 'اجرای یک لایه مش بلدی و شاتکریت');
    await type('[name=item_unit]', 'متر مربع');
    await type('[name=item_quantity]', '222');
    await type('[name=item_unit_price]', '4500000');
    await page.select('[name=invoice_payment]', 'cash');
    const sum = await page.$eval('.sum', (e) => e.innerText.replace(/\s+/g, ' ').trim());
    check(`${w}px: total in numbers and words`, sum.includes('۹۹۹٬۰۰۰٬۰۰۰ ریال') && sum.includes('نهصد و نود و نه میلیون ریال'), sum);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${w}px: no sideways overflow of the page`, over === 0, over);
    const fit = await page.$eval('.panel:not([hidden]) .scroll', (b) => b.scrollWidth - b.clientWidth);
    if (w >= 1280) check(`${w}px: the items table fits without inner scrolling (every column and delete reachable)`, fit <= 1, fit);
    if (w === 1280 || w === 390) await page.screenshot({ path: `/tmp/invoice-${w}.png`, fullPage: true });
    if (w === 1280) {
      const url = page.url();
      const wait = page.waitForResponse((r) => r.url().endsWith('/api/shahran/export/invoice') && r.request().method() === 'POST', { timeout: 15000 });
      await page.evaluate(() => [...document.querySelectorAll('.panel:not([hidden]) button')].find((b) => b.textContent === 'دانلود Excel').click());
      const res = await wait;
      const h = res.headers();
      check('download: server answers the posted form with the xlsx', res.status() === 200 && h['content-disposition'] === 'attachment; filename="shahran-invoice.xlsx"' && h['content-type'].includes('spreadsheetml'), [res.status(), h]);
      let file = DL + '/shahran-invoice.xlsx';
      for (let i = 0; i < 40 && !fs.existsSync(file); i++) await sleep(250);
      const bytes = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
      check('download: the browser saved a real xlsx (zip) named shahran-invoice.xlsx', bytes.length > 4000 && bytes[0] === 0x50 && bytes[1] === 0x4b, bytes.length);
      await sleep(300);
      check('page stayed where it was, values kept, form removed', page.url() === url && (await page.$eval('[name=contractor_name]', (e) => e.value)) === 'پیمانکاری اسکندری' &&
        (await page.$$('form[action$="export/invoice"]')).length === 0);
      // an error is shown next to the button and nothing is posted
      await type('[name=item_unit_price]', 'abc');
      let posted = false; page.on('request', (r) => { if (r.url().endsWith('/export/invoice')) posted = true; });
      await page.evaluate(() => [...document.querySelectorAll('.panel:not([hidden]) button')].find((b) => b.textContent === 'دانلود Excel').click()); await sleep(500);
      const err = await page.evaluate(() => { const e = [...document.querySelectorAll('.panel:not([hidden]) .msg')].pop(); const r = e.getBoundingClientRect(); return { text: e.textContent, visible: r.height > 0 }; });
      check('mistake: Farsi message beside the button, nothing posted', err.visible && err.text.startsWith('ردیف ۱: مبلغ واحد') && !posted, err);
    }
    await page.close();
  }
  check('no page errors or console errors', problems.length === 0, problems.slice(0, 5));
  await browser.close();
  console.log(`${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.message.split('\n')[0]); process.exit(1); });
