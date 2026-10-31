const { JSDOM } = require('jsdom');
const J = require('../frontend/jalali.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0, checks = 0;
function check(name, cond, extra) { checks++; if (!cond) { failures++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } }

async function waitFor(fn, what, ms = 4000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch (e) { /* retry */ } await sleep(25); }
  throw new Error('timeout waiting for: ' + what);
}

(async () => {
  let confirmAnswer = true;
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(new URL(u, BASE), o);
      if (!process.env.NO_DIALOG_POLYFILL) {
        w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
        w.HTMLDialogElement.prototype.close = function () { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      }
      w.confirm = () => confirmAnswer;
    }
  });
  const w = dom.window, d = w.document;
  const $ = (s) => d.querySelector(s);
  const $$ = (s) => [...d.querySelectorAll(s)];
  const setSel = (name, v) => { const s = $(`[name=${name}]`); s.value = String(v); s.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const setIn = (name, v) => { $(`[name=${name}]`).value = v; };
  const submit = () => $('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const msg = () => $('.msg').textContent;
  const bodyRows = (n = 0) => $$('table')[n] ? [...$$('table')[n].querySelectorAll('tbody tr')].map((tr) => [...tr.children].slice(0, 3).map((c) => c.textContent)) : [];
  const api = (p, o) => fetch(BASE + '/api/qaem' + p, o).then((r) => r.status === 204 ? null : r.json());
  const list = async (a, b) => { const r = await api(`/services?from=${a}&to=${b}`); if (!Array.isArray(r)) throw new Error('bad list response ' + JSON.stringify(r)); return r; };
  const all = async () => [...await list('2025-01-01', '2026-01-31'), ...await list('2026-02-01', '2027-02-28')];

  await waitFor(() => $$('.projects button').length === 3, 'project buttons');
  const btns = $$('.projects button');
  check('selector lists the 3 projects', btns.map((b) => b.dataset.project).join() === 'qaem,shahran,self');
  const titles = btns.map((b) => b.querySelector('.pc-title').textContent);
  check('buttons show the Farsi names', titles.join('|') === 'قائم|شهران|خودکفایی', titles);
  check('every project card has a Farsi description', btns.every((b) => b.querySelector('.pc-desc').textContent.length > 5));
  check('only qaem is enabled', btns.map((b) => !b.disabled).join() === 'true,false,false');
  check('inactive projects say "به‌زودی"', btns[1].textContent.includes('به‌زودی') && btns[2].textContent.includes('به‌زودی'));
  check('page is RTL Farsi', d.documentElement.dir === 'rtl' && d.documentElement.lang === 'fa');
  check('back button hidden on selector', $('#back').hidden === true);

  btns[0].click();
  await waitFor(() => $('form') && d.querySelector('.empty'), 'qaem view');
  const today = J.todayJalali();
  check('back button visible', $('#back').hidden === false);
  check('qaem page heading uses the Farsi name', $('h2').textContent === 'پروژه قائم', $('h2').textContent);
  check('date pickers default to today (Solar)', +$('[name=year]').value === today.jy && +$('[name=month]').value === today.jm && +$('[name=day]').value === today.jd,
    [$('[name=year]').value, $('[name=month]').value, $('[name=day]').value, today]);
  check('month picker shows Farsi names', [...$('[name=month]').options].map((o) => o.textContent).join('|') === J.MONTHS.join('|'));
  check('year/day options use Farsi digits', /^[۰-۹]+$/.test($('[name=year]').selectedOptions[0].textContent) && /^[۰-۹]+$/.test($('[name=day]').selectedOptions[0].textContent));
  check('empty-state message in Farsi', $('.empty').textContent.includes('ردیفی ثبت نشده'));
  check('form labels are Farsi', ['شماره کامیون', 'تاریخ', 'تعداد سرویس'].every((t) => $('form').textContent.includes(t)));

  setIn('truck_id', '۱۲'); setIn('truck_service_count', '۵'); submit();
  await waitFor(() => bodyRows().length === 1, 'first row');
  check('success message', msg() === 'ردیف افزوده شد.', msg());
  const todayText = J.fa(String(today.jy).padStart(4, '0') + '/' + String(today.jm).padStart(2, '0') + '/' + String(today.jd).padStart(2, '0'));
  check('row shown with Solar date + Farsi digits', JSON.stringify(bodyRows()[0]) === JSON.stringify([todayText, '۱۲', '۵']), bodyRows());
  check('form cleared after add', $('[name=truck_id]').value === '' && $('[name=truck_service_count]').value === '');
  const stored = await all();
  const g = J.toGregorian(today.jy, today.jm, today.jd);
  check('database stores the GREGORIAN date of the Solar pick', stored.length === 1 && stored[0].service_day === J.iso(g) && stored[0].truck_id === 12 && stored[0].truck_service_count === 5, stored);

  setIn('truck_id', '12'); setIn('truck_service_count', '9'); submit();
  await waitFor(() => msg().includes('قبلاً'), 'duplicate message');
  check('duplicate gives Farsi 409 message, no new row', bodyRows().length === 1 && msg() === 'برای این کامیون در این تاریخ قبلاً ردیفی ثبت شده است.', msg());
  for (const [t, c, expect] of [['abc', '3', 'شماره کامیون'], ['0', '3', 'شماره کامیون'], ['', '3', 'شماره کامیون'], ['5', '-2', 'تعداد سرویس'], ['5', '1.5', 'تعداد سرویس'], ['5', '', 'تعداد سرویس']]) {
    setIn('truck_id', t); setIn('truck_service_count', c); submit(); await sleep(30);
    check(`validation rejects truck="${t}" count="${c}"`, msg().includes(expect) && bodyRows().length === 1, msg());
  }

  setIn('truck_id', '۷'); setIn('truck_service_count', '۰۷'); submit();
  await waitFor(() => bodyRows().length === 2, 'second row');
  check('totals: day_total and month-to-date', JSON.stringify(bodyRows(1)) === JSON.stringify([[todayText, '۱۲', '۱۲']]), bodyRows(1));
  check('summary cards: month total and last-day total', $$('.stat-value').map((e) => e.textContent).join('|') === '۱۲|۱۲', $$('.stat-value').map((e) => e.textContent));

  setSel('year', 1403); setSel('month', 12);
  check('Esfand 1403 (leap) has 30 days', $('[name=day]').options.length === 30);
  setSel('day', 30); setSel('year', 1404);
  check('Esfand 1404 (not leap) has 29 days, day clamped', $('[name=day]').options.length === 29 && +$('[name=day]').value === 29);
  setSel('year', 1403); setSel('month', 7);
  check('Mehr has 30 days', $('[name=day]').options.length === 30);
  setSel('month', 1);
  check('Farvardin has 31 days', $('[name=day]').options.length === 31);

  setSel('year', 1403); setSel('month', 12); setSel('day', 30);
  setIn('truck_id', '3'); setIn('truck_service_count', '4'); submit();
  await waitFor(() => bodyRows().length === 1 && bodyRows()[0][0] === '۱۴۰۳/۱۲/۳۰', 'view jumps to 1403/12');
  check('view switched to the month of the new row', +$('[name=view_year]').value === 1403 && +$('[name=view_month]').value === 12);
  const s2 = await list('2025-03-01', '2025-03-31');
  check('1403/12/30 stored as 2025-03-20', s2.length === 1 && s2[0].service_day === '2025-03-20', s2);

  const dlg = $('dialog');
  const isOpen = () => dlg.hasAttribute('open');
  const E = (n) => dlg.querySelector(`[name=edit_${n}]`);
  const eSel = (n, v) => { E(n).value = String(v); E(n).dispatchEvent(new w.Event('change', { bubbles: true })); };
  const eSubmit = () => dlg.querySelector('form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const eMsg = () => dlg.querySelector('.msg').textContent;
  const editBtn = (i) => $$('tbody tr')[i].querySelector('button');
  const eCancel = () => [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'انصراف').click();

  check('pop-up is closed until Edit is pressed', !isOpen());
  editBtn(0).click();
  check('Edit opens the pop-up', isOpen());
  check('pop-up is prefilled with the row (Solar date)', E('truck_id').value === '۳' && E('truck_service_count').value === '۴' && +E('day').value === 30 && +E('month').value === 12 && +E('year').value === 1403,
    [E('truck_id').value, E('truck_service_count').value, E('day').value, E('month').value, E('year').value]);
  check('main add form untouched while editing', $('[name=truck_id]').value === '' && $('form h2').textContent === 'افزودن ردیف');
  check('pop-up has Farsi title and buttons', dlg.textContent.includes('ویرایش ردیف') && dlg.textContent.includes('ذخیره تغییرات') && dlg.textContent.includes('انصراف'));

  eSubmit(); await sleep(30);
  check('saving with no change is refused, pop-up stays open', eMsg() === 'تغییری ایجاد نشده است.' && isOpen(), eMsg());
  eSel('day', 30); E('truck_id').value = 'abc'; eSubmit(); await sleep(30);
  check('invalid truck id is refused inside the pop-up', eMsg().includes('شماره کامیون') && isOpen() && bodyRows().length === 1, eMsg());
  E('truck_id').value = '۳';
  E('truck_service_count').value = '-1'; eSubmit(); await sleep(30);
  check('invalid count is refused inside the pop-up', eMsg().includes('تعداد سرویس') && isOpen(), eMsg());

  E('truck_service_count').value = '۹'; eSubmit();
  await waitFor(() => !isOpen(), 'pop-up closes after save');
  await waitFor(() => bodyRows()[0] && bodyRows()[0][2] === '۹', 'row shows 9');
  check('saved: pop-up closed, only the count changed', JSON.stringify(bodyRows()[0]) === JSON.stringify(['۱۴۰۳/۱۲/۳۰', '۳', '۹']), bodyRows());
  check('success message on the page', msg() === 'تغییرات ذخیره شد.', msg());

  editBtn(0).click(); eSel('day', 29); eSubmit();
  await waitFor(() => !isOpen() && bodyRows()[0] && bodyRows()[0][0] === '۱۴۰۳/۱۲/۲۹', 'date edit');
  const s3 = await list('2025-03-01', '2025-03-31');
  check('date-only edit stored correctly (2025-03-19), count kept', s3.length === 1 && s3[0].service_day === '2025-03-19' && s3[0].truck_service_count === 9, s3);

  setSel('day', 29); setIn('truck_id', '8'); setIn('truck_service_count', '1'); submit();
  await waitFor(() => bodyRows().length === 2, 'second row in Esfand');
  editBtn(0).click();
  E('truck_id').value = '8'; eSubmit();
  await waitFor(() => eMsg().includes('قبلاً'), 'edit conflict');
  check('conflict: Farsi 409 message in the pop-up, still open, rows unchanged', isOpen() && bodyRows().length === 2 && eMsg() === 'برای این کامیون در این تاریخ قبلاً ردیفی ثبت شده است.', bodyRows());
  eCancel();
  check('Cancel closes the pop-up without saving', !isOpen() && bodyRows().length === 2 && JSON.stringify(bodyRows()[0]) === JSON.stringify(['۱۴۰۳/۱۲/۲۹', '۳', '۹']));

  editBtn(0).click();
  dlg.querySelector('h2').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('clicking inside the pop-up does not close it', isOpen());
  dlg.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('clicking the backdrop closes it', !isOpen());
  eSubmit(); await sleep(40);
  check('a stray submit after closing does nothing', bodyRows().length === 2 && JSON.stringify(bodyRows()[0]) === JSON.stringify(['۱۴۰۳/۱۲/۲۹', '۳', '۹']));

  confirmAnswer = false;
  $$('tbody tr')[1].querySelector('.danger').click(); await sleep(60);
  check('declined confirm deletes nothing', bodyRows().length === 2);
  confirmAnswer = true;
  $$('tbody tr')[1].querySelector('.danger').click();
  await waitFor(() => bodyRows().length === 1, 'row deleted');
  check('delete message', msg() === 'ردیف حذف شد.', msg());
  const s4 = await list('2025-03-01', '2025-03-31');
  check('deleted in database too', s4.length === 1 && s4[0].truck_id === 3, s4);

  editBtn(0).click();
  const gone = await fetch(BASE + '/api/qaem/services/2025-03-19/3', { method: 'DELETE' });
  check('direct delete worked (setup for 404 test)', gone.status === 204);
  E('truck_service_count').value = '۱'; eSubmit();
  await waitFor(() => eMsg().includes('پیدا نشد'), 'stale edit message');
  check('stale edit: Farsi 404 message, pop-up open', isOpen() && eMsg() === 'این ردیف پیدا نشد؛ شاید قبلاً حذف شده باشد.', eMsg());
  await waitFor(() => d.querySelector('.empty'), 'table refreshed after 404');
  check('table refreshed and no row was resurrected', bodyRows().length === 0 && (await list('2025-03-01', '2025-03-31')).length === 0);
  eCancel();

  const countBefore = (await all()).length;
  check('sanity: counting helper works', countBefore === 2, countBefore);
  if (today.jm < 12 || today.jd < 29) {
    setSel('year', today.jy); setSel('month', 12); setSel('day', 29);
    setIn('truck_id', '5'); setIn('truck_service_count', '1'); submit(); await sleep(60);
    check('future date refused in Farsi', msg() === 'تاریخ نمی‌تواند در آینده باشد.', msg());
  }
  const fut = await fetch(BASE + '/api/qaem/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_day: '2999-01-01', truck_id: 1, truck_service_count: 1 }) });
  check('server also refuses future dates', fut.status === 422);
  check('no future row was created', (await all()).length === countBefore);

  setSel('view_year', today.jy); setSel('view_month', today.jm);
  await waitFor(() => bodyRows().length === 2 && bodyRows()[0][0] === todayText, 'back to current month');
  check('current month shows the two rows entered earlier', bodyRows().length === 2);
  setSel('view_month', today.jm === 1 ? 2 : 1);
  await waitFor(() => d.querySelector('.empty'), 'empty month');
  check('an empty month shows the Farsi empty states', $$('.empty').length === 2);
  check('empty month: summary cards show 0 and a dash', $$('.stat-value').map((e) => e.textContent).join('|') === '۰|—', $$('.stat-value').map((e) => e.textContent));

  // ---- NEW: export buttons ----
  check('export: 2 buttons per table (xlsx + csv)', $$('.export').length === 2 && $$('.export').every((e) => e.children.length === 2), $$('.export').map((e) => e.textContent));
  check('export bars sit between the heading and the table', $$('.export').every((e) => e.previousElementSibling.tagName === 'H2'));

  $('#back').click();
  await waitFor(() => $$('.projects button').length === 3, 'selector again');
  check('back returns to project selector', $('#back').hidden === true);
  check('no leftover form on selector', !$('form'));

  console.log(`${checks} checks, ${failures} failures`);
  w.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.message); process.exit(1); });