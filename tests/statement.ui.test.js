// UI test of the shared statement card (jsdom). Usage: npm install --no-save jsdom && node tests/statement.ui.test.js
// Loads frontend/statement.js with the real frontend/jalali.js; needs no server and no data.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'frontend', f), 'utf8');
let checks = 0, failures = 0;
const check = (name, cond, extra) => { checks++; if (!cond) { failures++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const sent = [];
const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
const w = dom.window;
w.HTMLFormElement.prototype.submit = function () {   // jsdom cannot submit forms: record what the page would post
  sent.push({ method: this.method, action: this.getAttribute('action'), target: this.target, data: this.elements.data.value, inDom: this.isConnected });
};
w.eval(src('jalali.js')); w.eval(src('statement.js'));
const d = w.document, $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
const text = (e) => e.textContent.replace(/\s+/g, ' ').trim();
const J = w.Jalali;

const card = w.StatementCard.create(); d.body.append(card);
const trs = $$('tbody tr', card);
check('title row, then the notes column heading', $$('thead th', card).map(text).join('|') === 'حساب مالی صورت وضعیت های نهایی شده||توضیحات', $$('thead th', card).map(text));
check('11 rows in the order of the picture', trs.length === 11 && trs.map((tr) => text(tr.querySelector('th:last-of-type'))).join('|') ===
  'تاریخ ارسال|عنوان صورت وضعیت|مبلغ ناخالص صورت وضعیت|حسن انجام کار|خدمات و کالا|غذا|مجموع کسورات|مبلغ خالص قابل پرداخت صورت وضعیت|مبلغ خالص حقوق و مزایای پرسنل|مبلغ خالص خدمات و هزینه‌های جانبی|مبلغ خالص مانده پیمانکار');
const box = $$('th', trs[3])[0];
check('the box کسورات صورت وضعیت spans the 3 small rows, and only the first of them has it', text(box) === 'کسورات صورت وضعیت' && box.rowSpan === 3 && $$('th', trs[4]).length === 1 && $$('th', trs[5]).length === 1);
check('every row has a value box and a notes box', trs.every((tr) => $$('input', tr).length === 2));
const today = J.todayJalali();
check('date box starts as today (Solar, Farsi digits)', $('[name=statement_send_date]', card).value === J.fa(today.jy + '/' + String(100 + today.jm).slice(1) + '/' + String(100 + today.jd).slice(1)));
check('amount boxes are numeric, text boxes are not', $('[name=statement_gross]', card).getAttribute('inputmode') === 'numeric' && $('[name=statement_title]', card).getAttribute('inputmode') === 'text');
const set = (n, v) => { $(`[name=${n}]`, card).value = v; };
const msg = () => text($('.msg', card));
const click = () => $$('button', card).find((b) => text(b) === 'دانلود Excel').click();

// everything empty: posts the date only, no amounts
click();
check('empty form posts (empty boxes are simply empty)', sent.length === 1 && msg() === '', [sent.length, msg()]);
check('the form goes to the shared route, into the hidden frame, and is removed again', sent[0].method === 'post' && sent[0].action === '/api/statement/export' && sent[0].target.startsWith('statement_download_') &&
  sent[0].inDom && !!$(`iframe[name=${sent[0].target}]`, card) && $(`iframe[name=${sent[0].target}]`, card).hidden && $$('form', card).length === 0);
check('empty amounts are not sent at all', JSON.stringify(JSON.parse(sent[0].data).amounts) === '{}' && Object.keys(JSON.parse(sent[0].data).notes).length === 0, sent[0].data);

// the picture's numbers, typed with Farsi digits, ASCII digits and separators
set('statement_send_date', '۱۴۰۵/۰۸/۰۲'); set('statement_title', 'روز مزد مهر ماه ۱۴۰۵');
set('statement_gross', '۱٬۴۱۸٬۰۰۰٬۰۰۰'); set('statement_retention', '0'); set('statement_goods', ''); set('statement_food', '۰');
set('statement_net_payable', '1,418,000,000'); set('statement_net_salaries', '1026000000'); set('statement_net_remaining', ' ۳۹۲٬۰۰۰٬۰۰۰ ');
set('statement_note_gross', '  یادداشت  ');
sent.length = 0; click();
const p = JSON.parse(sent[0].data);
check('posted: texts as typed', p.send_date === '۱۴۰۵/۰۸/۰۲' && p.title === 'روز مزد مهر ماه ۱۴۰۵', p);
check('posted: amounts are whole numbers (Farsi/ASCII digits and separators understood), 0 kept, empty left out',
  JSON.stringify(p.amounts) === JSON.stringify({ gross: 1418000000, retention: 0, food: 0, net_payable: 1418000000, net_salaries: 1026000000, net_remaining: 392000000 }), p.amounts);
check('posted: notes are trimmed and only the filled ones are sent', JSON.stringify(p.notes) === '{"gross":"یادداشت"}', p.notes);

// mistakes: Farsi message, nothing sent, fixed -> message disappears
for (const bad of ['abc', '-5', '1.5', '10000000000001', '1 2 x']) {
  set('statement_gross', bad); sent.length = 0; click();
  check(`bad amount "${bad}" refused with the row's name`, sent.length === 0 && msg().startsWith('مبلغ «مبلغ ناخالص صورت وضعیت» باید'), msg());
}
set('statement_gross', '10000000000000'); sent.length = 0; click();
check('the largest allowed amount (10^13) is accepted and the old message is gone', sent.length === 1 && msg() === '' && JSON.parse(sent[0].data).amounts.gross === 1e13);
set('statement_gross', '5'); set('statement_note_food', 'x'.repeat(400));
check('text boxes have the server\'s length limits', +$('[name=statement_send_date]', card).getAttribute('maxlength') === 30 && +$('[name=statement_title]', card).getAttribute('maxlength') === 300 && +$('[name=statement_note_food]', card).getAttribute('maxlength') === 300);

// two cards on one page (qaem and shahran never share a page, but ids must not clash anyway)
const card2 = w.StatementCard.create(); d.body.append(card2);
check('a second card has its own hidden frame name', $('iframe', card).name !== $('iframe', card2).name);
console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
