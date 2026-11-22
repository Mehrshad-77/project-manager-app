// UI test of the shahran "حضور و غیاب ماهانه" tab: loads the real front end from a running server into jsdom.
// Usage: npm install --no-save jsdom && node tests/shahran.attendance.ui.test.js http://127.0.0.1:8000
// The server must point at an EMPTY, disposable database (this test adds workers and rows through the API).
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0, failures = 0;
function check(name, cond, extra) { checks++; if (!cond) { failures++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } }
const post = async (path, body) => { const r = await fetch(BASE + '/api/shahran' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.status !== 201) throw new Error(path + ' ' + r.status); return r.json(); };

(async () => {
  // data: Aban 1405 = 2026-10-23 .. 2026-11-21
  const ali = (await post('/workers', { full_name: 'Ali', role: 'simple', daily_salary: 1000 })).worker_id;
  const reza = (await post('/workers', { full_name: 'Reza', role: 'simple', daily_salary: 1000 })).worker_id;
  const hasan = (await post('/workers', { full_name: 'Hasan', role: 'builder', daily_salary: 2000 })).worker_id;
  const row = (day, worker_id, a, e) => post('/time-sheet', { work_day: day, worker_id, arrival_time: a, exit_time: e });
  await row('2026-10-23', ali, '07:00', '16:00'); await row('2026-10-23', reza, '08:00', '12:00'); await row('2026-10-23', hasan, '08:00', '17:00');
  await row('2026-10-24', ali, null, null); await row('2026-10-24', reza, '06:30', '17:30');

  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message)); vc.on('error', (e) => errors.push(String(e)));
  let pending = 0, total = 0;
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => { pending++; total++; return fetch(new URL(u, BASE), o).finally(() => pending--); };
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
    },
  });
  const w = dom.window, d = w.document;
  const $ = (s, r = d) => r.querySelector(s), $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  const settle = async () => { let last = -1; for (;;) { await sleep(40); if (pending === 0 && total === last) return; last = total; } };
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
  const setv = async (el, v) => { el.value = String(v); fire(el, 'change'); await settle(); };
  const named = (n, root = d) => root.querySelector(`[name=${n}]`);
  const view = () => $('.panel:not([hidden])');
  const tab = async (name) => { $$('.tabs button').find((b) => text(b) === name).click(); await settle(); };

  while (!$('.project-card')) await sleep(30);          // the selector is drawn after /api/projects answers
  await settle();
  $$('.project-card')[0].click(); await settle();
  check('five tabs, the new one after the aggregated sheet', $$('.tabs button').map(text).join('|') === 'کارکرد روزانه|کارکرد تجمیعی ماهانه|حضور و غیاب ماهانه|حقوق ماهانه|کارگران', $$('.tabs button').map(text));
  await tab('حضور و غیاب ماهانه');
  check('the tab is selected and the month picker stays visible', $$('.tabs button')[2].getAttribute('aria-selected') === 'true' && $('.month-picker').hidden === false);
  await setv(named('view_month'), 8);

  // ---- two-level header ----
  const t = $('table.att', view());
  const head = $$('thead tr', t);
  check('header: title row, boxes row, column row', head.length === 3, head.length);
  const cells = (tr) => $$('th', tr).map(text);
  check('top header is the site title with the month', cells(head[0]).join() === 'کارگاه تونل دسترسی تهران_شمال پروژه شهران (آبان ۱۴۰۵)', cells(head[0]));
  check('three boxes, in order', cells(head[1]).join('|') === 'پیمانکار اسکندری|حضور‌غیاب کل‌ماه|سمت:کارگر ساده', cells(head[1]));
  check('columns: date, enter, exit, each worker, notes', cells(head[2]).slice(0, -1).join('|') === 'تاریخ|ساعت ورود|ساعت خروج|Ali|Reza|توضیحات', cells(head[2]));
  const span = (tr) => $$('th', tr).map((x) => +(x.getAttribute('colspan') || 1));
  const width = span(head[2]).length;
  check('title and boxes cover exactly the columns below them', span(head[0])[0] === width && span(head[1]).reduce((a, b) => a + b) === width && span(head[1]).slice(0, 2).join() === '3,2', [span(head[0]), span(head[1]), width]);

  // ---- body ----
  const rows = () => $$('tbody tr', $('table.att', view())).map((tr) => $$('td', tr).map(text));
  let r = rows();
  check('one row for every day of Aban', r.length === 30 && r[0][0] === '۱۴۰۵/۰۸/۰۱' && r[29][0] === '۱۴۰۵/۰۸/۳۰', [r.length, r[0] && r[0][0]]);
  check('every body row has as many cells as the header', r.every((x) => x.length === width));
  check('1 Aban: earliest in, latest out, full day, half day (builder not shown)', r[0].slice(0, 5).join('|') === '۱۴۰۵/۰۸/۰۱|۰۷:۰۰|۱۶:۰۰|۱|۱/۲', r[0]);
  check('2 Aban: absent row is a dash, other worker full day', r[1].slice(0, 5).join('|') === '۱۴۰۵/۰۸/۰۲|۰۶:۳۰|۱۷:۳۰|—|۱', r[1]);
  check('an empty day is all dashes', r[2].slice(1, 5).join('|') === '—|—|—|—' && r[2][5] === '');
  const foot = $$('tfoot td', t).map(text);
  check('totals row: grand total and each worker', foot.slice(0, 4).join('|') === 'جمع کل کارکرد|۲/۵|۱|۱/۵' || foot.slice(0, 4).join('|') === 'جمع کل کارکرد|۲/۵|۱|۱٫۵', foot);

  const fr = $$('tfoot tr', t);
  const trow = (tr) => $$('td', tr).map(text);
  check('wage rows: daily wage, pay per worker, total, total in words', fr.length === 5 &&
    trow(fr[1]).slice(0, 3).join('|') === 'دستمزد روزانه|۱٬۰۰۰|۱٬۰۰۰' && trow(fr[2]).slice(0, 3).join('|') === 'دستمزد قابل پرداخت|۱٬۰۰۰|۱٬۵۰۰' &&
    trow(fr[3]).join('|') === 'جمع دستمزد قابل پرداخت|۲٬۵۰۰ ریال' && trow(fr[4]).join('|') === 'مبلغ به حروف|دو هزار و پانصد ریال', fr.map(trow));
  check('every footer row covers exactly the table width', fr.every((tr) => $$('td', tr).reduce((a, x) => a + +(x.getAttribute('colspan') || 1), 0) === width), fr.map((tr) => $$('td', tr).map((x) => x.getAttribute('colspan'))));

  // ---- notes: edit from this tab, shared with the aggregated sheet ----
  $$('tbody tr', t)[2].querySelector('button').click();
  check('explanation pop-up opens', !!$('dialog') && $('dialog').hasAttribute('open') && text($('dialog h2')).startsWith('توضیحات'));
  named('day_explanation').value = 'باران'; fire($('dialog form'), 'submit'); await settle();
  check('note saved: pop-up closed, shown in the new row', !$('dialog').hasAttribute('open') && rows()[2][5] === 'باران', rows()[2]);
  const api = await (await fetch(BASE + '/api/shahran/aggregated-work?from=2026-10-25&to=2026-10-25')).json();
  check('the same note is on the aggregated sheet', api[0].explanation === 'باران', api);

  // ---- role switch ----
  await setv(named('att_role'), 'builder');
  const t2 = $('table.att', view());
  check('builder sheet: box says بنا, only Hasan', cells($$('thead tr', t2)[1]).join('|') === 'پیمانکار اسکندری|حضور‌غیاب کل‌ماه|سمت:بنا' && cells($$('thead tr', t2)[2]).slice(3, 4).join() === 'Hasan', cells($$('thead tr', t2)[2]));
  check('builder sheet row 1: 08:00-17:00, full day', $$('td', $$('tbody tr', t2)[0]).map(text).slice(0, 4).join('|') === '۱۴۰۵/۰۸/۰۱|۰۸:۰۰|۱۷:۰۰|۱');
  await setv(named('att_role'), 'simple');

  // ---- empty month and export bar ----
  await setv(named('view_month'), 9);
  check('a month nobody worked shows the empty message, no table', text(view()).includes('برای این ماه کارکردی ثبت نشده است') && !$('table.att', view()));
  check('export bar sits under the heading: Excel + CSV', $$('.export button', view()).map(text).join('|') === 'دانلود Excel|دانلود CSV' && !!$('.export', view()).previousElementSibling.querySelector('[name=att_role]'));
  check('no JavaScript errors', errors.length === 0, errors.slice(0, 3));

  console.log(`${checks} checks, ${failures} failures`);
  w.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });