// UI test of the shahran "فاکتور شاتکریت کوهسار" tab: loads the real front end from a running server into jsdom.
// Usage: npm install --no-save jsdom && node tests/shahran.invoice.ui.test.js http://127.0.0.1:8000
// Needs no data (the tab stores nothing), so any database will do.
const { JSDOM, VirtualConsole } = require('jsdom');
const J = require('../frontend/jalali.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0, failures = 0;
function check(name, cond, extra) { checks++; if (!cond) { failures++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } }

(async () => {
  const errors = [], vc = new VirtualConsole(), sent = [];
  vc.on('jsdomError', (e) => errors.push(e.message)); vc.on('error', (e) => errors.push(String(e)));
  let pending = 0, total = 0;
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => { pending++; total++; return fetch(new URL(u, BASE), o).finally(() => pending--); };
      // jsdom cannot submit forms: record what the page would have posted
      w.HTMLFormElement.prototype.submit = function () {
        sent.push({ method: this.method, action: this.getAttribute('action'), target: this.target, data: this.elements.data && this.elements.data.value, inDom: this.isConnected });
      };
    },
  });
  const w = dom.window, d = w.document;
  const $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  const settle = async () => { let last = -1; for (;;) { await sleep(40); if (pending === 0 && total === last) return; last = total; } };
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
  const named = (n, root = d) => root.querySelector(`[name=${n}]`);
  const view = () => $('.panel:not([hidden])');
  const items = () => $$('.items tbody tr', view());
  const type = (tr, name, v) => { const e = named(name, tr); e.value = v; fire(e, 'input'); };
  const fill = (tr, desc, unit, qty, price, tax, disc) => {
    type(tr, 'item_description', desc); type(tr, 'item_unit', unit); type(tr, 'item_quantity', qty);
    type(tr, 'item_unit_price', price); type(tr, 'item_tax', tax || ''); type(tr, 'item_discount', disc || '');
  };
  const cell = (tr, i) => text($$('td', tr)[i]);
  const sumNumber = () => text($('.sum-number', view())), sumWords = () => text($('.sum-words', view()));
  const msg = () => text($('.msg', $$('section.card', view()).pop()));
  const download = () => { $$('button', view()).find((b) => text(b) === 'دانلود Excel').click(); };

  while (!$('.project-card')) await sleep(30);
  await settle();
  $$('.project-card')[1].click(); await settle();
  const calls = total;
  $$('.tabs button').find((b) => text(b) === 'فاکتور شاتکریت کوهسار').click(); await settle();
  check('the tab opens and is selected', $$('.tabs button')[4].getAttribute('aria-selected') === 'true' && view() === $$('.panel')[4]);
  check('switching to it makes no server calls and hides the month picker', total === calls && $('.month-picker').hidden === true, [total, calls]);

  // ---- the form, top to bottom ----
  check('card headings in the order of the paper form', $$('section.card > h2', view()).map(text).join('|') === 'فروش کالا و خدمات|مشخصات پیمانکار|مشخصات کارفرما|مشخصات کالا یا خدمات مورد معامله', $$('section.card > h2', view()).map(text));
  const labels = (card) => $$('label.field > span, div.field > span', card).map(text);
  const cards = $$('section.card', view());
  check('number and date at the top (date defaults to today)', labels(cards[0]).join('|') === 'شماره|تاریخ (روز / ماه / سال)' &&
    +named('invoice_year').value === J.todayJalali().jy && +named('invoice_day').value === J.todayJalali().jd);
  check('contractor fields', labels(cards[1]).join('|') === 'نام شخص حقوقی|نشانی کامل|شماره اقتصادی|کد پستی|شماره ملی|شماره تماس', labels(cards[1]));
  check('employer fields', labels(cards[2]).join('|') === 'نام شخص حقیقی/حقوقی|شماره اقتصادی|شماره ثبت/ملی|نشانی|تلفن', labels(cards[2]));
  check('item columns are the nine of the form (+ a delete column)', $$('.items thead th', view()).map(text).join('|') ===
    'ردیف|شرح کالا|واحد کالا|تعداد|مبلغ واحد (ریال)|مبلغ کل (ریال)|جمع مالیات و عوارض (ریال)|مبلغ تخفیف|جمع کل به علاوه مالیات و عوارض (ریال)|', $$('.items thead th', view()).map(text));
  check('payment choice offers نقدی / غیر نقدی and starts unchosen', [...named('invoice_payment').options].map(text).join('|') === '—|نقدی|غیر نقدی' && named('invoice_payment').value === '');
  check('شماره شبا field and the Excel button are there', !!named('invoice_sheba') && $$('button', view()).some((b) => text(b) === 'دانلود Excel'));
  check('starts with one empty numbered row, total zero', items().length === 1 && cell(items()[0], 0) === '۱' && sumNumber() === '۰ ریال' && sumWords() === 'صفر ریال', [items().length, sumNumber(), sumWords()]);

  // ---- calculation (the example of the photo) ----
  let r = items()[0];
  fill(r, 'اجرای شاتکریت', 'متر مربع', '۲۲۲', '۴٬۵۰۰٬۰۰۰');
  check('مبلغ کل = تعداد × مبلغ واحد, last column = مبلغ کل + مالیات', cell(r, 5) === '۹۹۹٬۰۰۰٬۰۰۰' && cell(r, 8) === '۹۹۹٬۰۰۰٬۰۰۰', [cell(r, 5), cell(r, 8)]);
  check('total in numbers and in words, side by side', sumNumber() === '۹۹۹٬۰۰۰٬۰۰۰ ریال' && sumWords() === 'نهصد و نود و نه میلیون ریال', [sumNumber(), sumWords()]);
  check('the number and the words sit in one box (not a row below)', $('.sum-number', view()).closest('.sum') === $('.sum-words', view()).closest('.sum'));
  type(r, 'item_unit_price', '4500000'); check('ASCII digits work too', cell(r, 5) === '۹۹۹٬۰۰۰٬۰۰۰');
  type(r, 'item_tax', '۱۰۰۰'); type(r, 'item_discount', '۵۰۰');
  check('tax is added to the last column; discount is only recorded', cell(r, 5) === '۹۹۹٬۰۰۰٬۰۰۰' && cell(r, 8) === '۹۹۹٬۰۰۱٬۰۰۰' && sumNumber() === '۹۹۹٬۰۰۱٬۰۰۰ ریال', [cell(r, 8), sumNumber()]);
  $$('button', view()).find((b) => text(b) === 'افزودن ردیف').click();
  check('افزودن ردیف adds a numbered row', items().length === 2 && cell(items()[1], 0) === '۲');
  fill(items()[1], 'دوم', '', '۰٫۰۰۱', '500');
  check('decimal quantity (٫) and half-up rounding: 0.001 × 500 = 0.5 -> 1', cell(items()[1], 5) === '۱' && sumNumber() === '۹۹۹٬۰۰۱٬۰۰۱ ریال', [cell(items()[1], 5), sumNumber()]);
  fill(items()[1], 'دوم', '', '2.5', '3');
  check('2.5 × 3 = 7.5 -> 8', cell(items()[1], 5) === '۸');

  // ---- mistakes are explained in Farsi and nothing is sent ----
  const tries = [
    [['', '', '1', '5'], 'ردیف ۲: شرح کالا را وارد کنید.'],
    [['x', '', '1.2345', '5'], 'ردیف ۲: تعداد باید'], [['x', '', '', '5'], 'ردیف ۲: تعداد باید'],
    [['x', '', '1', 'abc'], 'ردیف ۲: مبلغ واحد باید'], [['x', '', '1', ''], 'ردیف ۲: مبلغ واحد باید'], [['x', '', '1', '-5'], 'ردیف ۲: مبلغ واحد باید'],
    [['x', '', '1', '10000000000001'], 'ردیف ۲: تعداد یا مبلغ بیش از حد مجاز'], [['x', '', '1000001', '5'], 'ردیف ۲: تعداد یا مبلغ بیش از حد مجاز'],
    [['x', '', '1000000', '10000000000'], 'ردیف ۲: تعداد یا مبلغ بیش از حد مجاز'],
  ];
  for (const [[desc, unit, qty, price], expect] of tries) {
    fill(items()[1], desc, unit, qty, price); const before = sent.length; download();
    check(`row error "${qty}" × "${price}" -> ${expect}`, msg().startsWith(expect) && sent.length === before && cell(items()[1], 5) === '—', msg());
  }
  fill(items()[1], 'x', '', '1', '5', 'abc'); download();
  check('bad tax refused', msg().startsWith('ردیف ۲: جمع مالیات') && sent.length === 0, msg());
  fill(items()[1], 'x', '', '1', '5', '', '1.5'); download();
  check('bad discount refused', msg().startsWith('ردیف ۲: مبلغ تخفیف') && sent.length === 0, msg());

  // ---- rows: empty rows are skipped, delete works, at least one row stays ----
  fill(items()[1], '', '', '', '');
  download();
  check('an empty row is simply left out (no error)', msg() === '' && sent.length === 1, [msg(), sent.length]);
  const body = JSON.parse(sent[0].data);
  check('the form is posted to the invoice download, into the hidden frame', sent[0].method === 'post' && sent[0].action === '/api/shahran/export/invoice' && sent[0].target === 'invoice_download' &&
    sent[0].inDom && !!$('iframe[name=invoice_download]') && $('iframe[name=invoice_download]').hidden, sent[0]);
  check('the posted form is removed again', $$('form[action="/api/shahran/export/invoice"]').length === 0);
  check('body: one item, strings as typed in ASCII, amounts as whole numbers', JSON.stringify(body.items) === JSON.stringify([{ description: 'اجرای شاتکریت', unit: 'متر مربع', quantity: '222', unit_price: 4500000, tax: 1000, discount: 500 }]), body.items);
  items()[1].querySelector('.danger').click();
  check('delete removes a row and renumbers', items().length === 1 && cell(items()[0], 0) === '۱');
  items()[0].querySelector('.danger').click();
  check('deleting the last row leaves one empty row', items().length === 1 && named('item_description', items()[0]).value === '' && sumNumber() === '۰ ریال');
  fill(items()[0], 'اجرای شاتکریت', 'متر مربع', '222', '4500000');
  const add = $$('button', view()).find((b) => text(b) === 'افزودن ردیف');
  for (let k = 0; k < 29; k++) add.click();
  check('30 rows is the limit: the add button switches off', items().length === 30 && add.disabled === true);
  items()[29].querySelector('.danger').click();
  check('and on again after a delete', items().length === 29 && add.disabled === false);
  for (let k = items().length - 1; k >= 1; k--) items()[k].querySelector('.danger').click();

  // ---- the whole form, as posted ----
  const set = (n, v) => { named(n).value = v; };
  set('invoice_number', '۴'); named('invoice_year').value = '1405'; fire(named('invoice_year'), 'change');
  named('invoice_month').value = '9'; fire(named('invoice_month'), 'change'); named('invoice_day').value = '1'; fire(named('invoice_day'), 'change');
  const vals = { contractor_name: 'پیمانکاری اسکندری', contractor_address: 'استان تهران', contractor_economic_no: '411', contractor_postal_code: '123', contractor_national_id: '22596',
    contractor_phone: '0938', employer_name: 'پروژه دسترسی', employer_economic_no: '9', employer_registration_no: '8', employer_address: 'تهران', employer_phone: '021' };
  Object.entries(vals).forEach(([k, v]) => set(k, v));
  set('invoice_payment', 'non_cash'); set('invoice_sheba', 'IR98 به نام علی');
  check('all text boxes have the same length limits as the server', ['contractor_name', 'contractor_address', 'employer_address', 'invoice_number', 'invoice_sheba', 'item_description', 'item_unit'].map((n) => +named(n).getAttribute('maxlength')).join() === '150,300,300,30,200,300,30');
  sent.length = 0; download();
  const posted = JSON.parse(sent[0].data);
  check('posted data = everything typed (date as 1405/09/01, payment, sheba)', JSON.stringify(posted) === JSON.stringify({ ...vals, number: '۴', date: '1405/09/01', items: body.items.map((x) => ({ ...x })), payment: 'non_cash', sheba: 'IR98 به نام علی' }) ||
    (posted.date === '1405/09/01' && posted.payment === 'non_cash' && posted.sheba === 'IR98 به نام علی' && posted.number === '۴' && Object.entries(vals).every(([k, v]) => posted[k] === v)), posted);

  // ---- the real server accepts exactly what the page posts, and the file is the form ----
  const res = await fetch(BASE + sent[0].action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: sent[0].data }) });
  check('server answers the page\'s post with an .xlsx download', res.status === 200 && res.headers.get('content-disposition') === 'attachment; filename="shahran-invoice.xlsx"' && (await res.arrayBuffer()).byteLength > 4000);

  // ---- Farsi words, hand-checked values (the same list is in tests/test_shahran_invoice.py) ----
  const words = [[0, 'صفر ریال'], [7, 'هفت ریال'], [15, 'پانزده ریال'], [20, 'بیست ریال'], [21, 'بیست و یک ریال'], [100, 'صد ریال'], [101, 'صد و یک ریال'], [999, 'نهصد و نود و نه ریال'],
    [1000, 'یک هزار ریال'], [1001, 'یک هزار و یک ریال'], [2500, 'دو هزار و پانصد ریال'], [18000000, 'هجده میلیون ریال'], [999000000, 'نهصد و نود و نه میلیون ریال'],
    [1234567890, 'یک میلیارد و دویست و سی و چهار میلیون و پانصد و شصت و هفت هزار و هشتصد و نود ریال'], [1000000000000, 'یک تریلیون ریال']];
  for (const [n, expect] of words) { type(items()[0], 'item_unit_price', String(n)); type(items()[0], 'item_quantity', '1'); check(`words of ${n}`, sumWords() === expect, sumWords()); }
  type(items()[0], 'item_quantity', '1');
  type(items()[0], 'item_unit_price', '10000000000000'); type(items()[0], 'item_tax', '10000000000000');
  check('largest amounts stay exact (BigInt)', sumNumber() === '۲۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰ ریال' && sumWords() === 'بیست تریلیون ریال', [sumNumber(), sumWords()]);

  // ---- leaving and coming back resets, other tabs unaffected ----
  $$('.tabs button')[3].click(); await settle();
  check('other tabs still load (pay tab shows its empty message)', text(view()).includes('کارکردی ثبت نشده'));
  check('no JavaScript errors', errors.length === 0, errors.slice(0, 3));
  console.log(`${checks} checks, ${failures} failures`);
  w.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });
