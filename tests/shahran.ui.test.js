// End-to-end UI test of the shahran project (and that qaem still works beside it): loads the real front end
// from a running server into jsdom and clicks through it.
// Usage: npm install --no-save jsdom && node tests/shahran.ui.test.js http://127.0.0.1:8000
// The server must point at an EMPTY, disposable database (this test adds and deletes rows).
const { JSDOM, VirtualConsole } = require('jsdom');
const J = require('../frontend/jalali.js');
const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0, failures = 0;
function check(name, cond, extra) { checks++; if (!cond) { failures++; console.log('FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } }

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (e) => errors.push(String(e)));
  let confirmAnswer = true, pending = 0, total = 0;
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => { pending++; total++; return fetch(new URL(u, BASE), o).finally(() => pending--); };
      // jsdom lacks showModal/close; mimic the spec so the real code path runs
      w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      w.HTMLDialogElement.prototype.close = function () { if (!this.hasAttribute('open')) return; this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
      w.confirm = () => confirmAnswer;
    },
  });
  const w = dom.window, d = w.document;
  const $ = (s, r = d) => r.querySelector(s);
  const $$ = (s, r = d) => [...r.querySelectorAll(s)];
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  const settle = async () => { let last = -1; for (;;) { await sleep(40); if (pending === 0 && total === last) return; last = total; } };
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
  const setv = async (el, v) => { el.value = String(v); fire(el, 'change'); await settle(); };
  const named = (n, root = d) => root.querySelector(`[name=${n}]`);
  const msg = () => text($('.wrap.stack > .msg'));
  const view = () => $('.panel:not([hidden])');
  const rowsOf = () => $$('tbody tr', view()).map((tr) => $$('td', tr).map(text));
  const footOf = () => $$('tfoot td', view()).map(text);
  const tab = async (name) => { $$('.tabs button').find((b) => text(b) === name).click(); await settle(); };
  const dlg = $.bind(null, 'dialog');
  const isOpen = () => !!$('dialog') && $('dialog').hasAttribute('open');
  const popupMsg = () => text($('dialog .msg'));
  const submitForm = async (form) => { fire(form, 'submit'); await settle(); };
  const rowButton = (rowIndex, label) => $$('tbody tr', view())[rowIndex].querySelectorAll('button')[label === 'del' ? 1 : 0];
  const indexOfRow = (pred) => rowsOf().findIndex(pred);

  /* ---------- 1. selector ---------- */
  await settle();
  let cards = $$('.project-card');
  check('selector lists 3 projects', cards.map((c) => c.dataset.project).join() === 'qaem,shahran,self');
  check('qaem and shahran are open, self is "به‌زودی"', cards.map((c) => !c.disabled).join() === 'true,true,false' && text(cards[2]).includes('به‌زودی'));
  cards[1].click(); await settle();
  check('back button visible and page heading is the shahran project', !$('#back').hidden && text($('.page-head h2')) === 'پروژه شهران', text($('.page-head h2')));
  check('four tabs in Farsi', $$('.tabs button').map(text).join('|') === 'کارکرد روزانه|کارکرد تجمیعی ماهانه|حقوق ماهانه|کارگران', $$('.tabs button').map(text));
  check('sheet tab is selected first', $$('.tabs button')[0].getAttribute('aria-selected') === 'true');
  const today = J.todayJalali();
  check('date pickers default to today (Solar)', +named('year').value === today.jy && +named('month').value === today.jm && +named('day').value === today.jd);
  check('month picker defaults to this month', +named('view_year').value === today.jy && +named('view_month').value === today.jm);
  check('no workers yet: add form asks for a worker first', (await (async () => { fire($$('form')[0], 'submit'); await settle(); return msg(); })()) === 'ابتدا از تب «کارگران» یک کارگر اضافه کنید.');

  /* ---------- 2. workers ---------- */
  await tab('کارگران');
  check('month picker hidden on the workers tab', $('.month-picker').hidden === true);
  check('empty workers message', text(view()).includes('هنوز کارگری ثبت نشده است'));
  const workerForm = () => $$('form', view())[0];
  const addWorker = async (name, role, salary) => {
    const f = workerForm();
    named('worker_name', f).value = name; named('worker_role', f).value = role; named('worker_salary', f).value = salary;
    await submitForm(f);
  };
  await addWorker('Ali', 'simple', '۱۰۰۰۰۰۰');            // typed with Farsi digits
  await addWorker('Reza', 'simple', '1,200,000');
  await addWorker('Hasan', 'builder', '2000000');
  await addWorker('<img src=x onerror=alert(1)>', 'simple', '5');
  check('4 workers listed alphabetically', rowsOf().length === 4 && rowsOf()[1][0] === 'Ali', rowsOf());
  check('role in Farsi and salary with Persian digits', JSON.stringify(rowsOf()[1].slice(0, 3)) === JSON.stringify(['Ali', 'کارگر ساده', '۱٬۰۰۰٬۰۰۰']) && rowsOf()[2][1] === 'بنا', rowsOf());
  check('HTML in a name is shown as text, never run', !$('img', view()) && rowsOf()[0][0] === '<img src=x onerror=alert(1)>');
  check('success message', msg() === 'کارگر افزوده شد.', msg());
  await addWorker('Reza', 'simple', '1');
  check('duplicate name -> Farsi message', msg() === 'کارگری با این نام قبلاً ثبت شده است.', msg());
  await addWorker('   ', 'simple', '1');
  check('blank name refused before sending', msg().startsWith('نام کارگر') && rowsOf().length === 4, msg());
  await addWorker('Z', 'simple', 'abc');
  check('bad salary refused', msg().startsWith('حقوق روزانه') && rowsOf().length === 4, msg());
  await addWorker('Z', 'simple', '-5');
  check('negative salary refused', msg().startsWith('حقوق روزانه'), msg());
  // edit in pop-up
  rowButton(indexOfRow((r) => r[0] === 'Reza'), 'edit').click();
  check('edit opens the pop-up prefilled', isOpen() && named('edit_worker_name').value === 'Reza' && named('edit_worker_salary').value === '۱۲۰۰۰۰۰', named('edit_worker_salary') && named('edit_worker_salary').value);
  await submitForm($('dialog form'));
  check('saving with no change is refused, pop-up stays', isOpen() && popupMsg() === 'تغییری ایجاد نشده است.', popupMsg());
  named('edit_worker_name').value = 'Hasan'; await submitForm($('dialog form'));
  check('rename onto an existing name -> error inside the pop-up', isOpen() && popupMsg() === 'کارگری با این نام قبلاً ثبت شده است.', popupMsg());
  named('edit_worker_name').value = 'Reza'; named('edit_worker_salary').value = '۱۵۰۰۰۰۰'; await submitForm($('dialog form'));
  check('saved: pop-up closed, new salary shown', !isOpen() && rowsOf().some((r) => r[0] === 'Reza' && r[2] === '۱٬۵۰۰٬۰۰۰'), rowsOf());
  rowButton(indexOfRow((r) => r[0] === 'Reza'), 'edit').click();
  named('edit_worker_salary').value = '1200000'; await submitForm($('dialog form'));
  check('salary set back to 1,200,000 for the hand calculation', rowsOf().some((r) => r[0] === 'Reza' && r[2] === '۱٬۲۰۰٬۰۰۰'));
  rowButton(0, 'edit').click(); $('dialog .secondary').click();
  check('انصراف closes the pop-up', !isOpen());
  rowButton(0, 'edit').click(); fire($('dialog'), 'cancel'); $('dialog').close();
  check('Esc/close leaves nothing open and does not save', !isOpen() && rowsOf().length === 4);
  rowButton(0, 'edit').click(); $('dialog').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('click on the backdrop closes it', !isOpen());
  confirmAnswer = false; rowButton(0, 'del').click(); await settle();
  check('declined confirm deletes nothing', rowsOf().length === 4);
  confirmAnswer = true; rowButton(0, 'del').click(); await settle();
  check('confirmed delete removes the worker', rowsOf().length === 3 && rowsOf().every((r) => !r[0].startsWith('<img')), rowsOf());

  /* ---------- 3. daily time sheet ---------- */
  await tab('کارکرد روزانه');
  const f = () => $$('form', view())[0];
  check('worker list is in the add form', $$('[name=worker_id] option', f()).map(text).join() === 'Ali,Hasan,Reza', $$('[name=worker_id] option', f()).map(text));
  check('empty-month message', text(view()).includes('ردیفی ثبت نشده'));
  await setv(named('year', f()), 1404); await setv(named('month', f()), 12);
  check('Esfand 1404 has 29 days', $$('[name=day] option', f()).length === 29);
  await setv(named('year', f()), 1403);
  check('Esfand 1403 (leap) has 30 days', $$('[name=day] option', f()).length === 30);
  await setv(named('month', f()), 7); check('Mehr has 30 days', $$('[name=day] option', f()).length === 30);
  await setv(named('month', f()), 1); check('Farvardin has 31 days', $$('[name=day] option', f()).length === 31);
  const addRow = async (jy, jm, jd, who, a, e, o = {}) => {
    const fm = f();
    await setv(named('year', fm), jy); await setv(named('month', fm), jm); await setv(named('day', fm), jd);
    named('worker_id', fm).value = $$('[name=worker_id] option', fm).find((x) => text(x) === who).value;
    named('arrival_time', fm).value = a || ''; named('exit_time', fm).value = e || '';
    named('overtime', fm).value = o.overtime ?? '۰'; named('is_holiday', fm).checked = !!o.holiday; named('is_off_day', fm).checked = !!o.off;
    named('explanation', fm).value = o.note || '';
    await submitForm(fm);
  };
  // 1 Mehr 1405 = 2026-09-23, 30 Mehr = 2026-10-22, 1 Aban = 2026-10-23
  await addRow(1405, 7, 1, 'Ali', '07:00', '16:00');
  await addRow(1405, 7, 30, 'Ali', '07:00', '16:00');
  await addRow(1405, 7, 30, 'Reza', '07:30', '16:00');
  await addRow(1405, 7, 30, 'Hasan', '', '', { note: 'غایب' });
  check('view jumped to Mehr 1405', +named('view_month').value === 7 && +named('view_year').value === 1405);
  check('3 rows in Mehr', rowsOf().length === 4 && msg() === 'ردیف افزوده شد.', [rowsOf().length, msg()]);
  check('row shows Solar date and Persian-digit times', JSON.stringify(rowsOf()[0].slice(0, 4)) === JSON.stringify(['۱۴۰۵/۰۷/۰۱', 'Ali', '۰۷:۰۰', '۱۶:۰۰']), rowsOf()[0]);
  const absent = rowsOf().find((r) => r[1] === 'Hasan');
  check('absent row: dashes and the explanation', absent[2] === '—' && absent[3] === '—' && absent[7] === 'غایب', absent);
  const stored = await (await fetch(BASE + '/api/shahran/time-sheet?from=2026-09-23&to=2026-10-22')).json();
  check('database holds the GREGORIAN dates of the Solar picks', stored.map((r) => r.work_day).sort().join() === '2026-09-23,2026-10-22,2026-10-22,2026-10-22', stored.map((r) => r.work_day));
  check('form cleared except the date', named('arrival_time', f()).value === '' && named('explanation', f()).value === '' && +named('day', f()).value === 30);
  await addRow(1405, 7, 5, 'Hasan', '08:00', '');
  check('only one time -> Farsi message, nothing added', msg() === 'ساعت ورود و ساعت خروج باید هر دو پر یا هر دو خالی باشند.' && rowsOf().length === 4, msg());
  await addRow(1405, 7, 5, 'Hasan', '08:00', '17:00', { overtime: 'abc' });
  check('bad overtime refused', msg().startsWith('اضافه‌کاری') && rowsOf().length === 4, msg());
  await addRow(1405, 7, 5, 'Hasan', '08:00', '17:00', { overtime: '25' });
  check('overtime above 24 refused', msg().startsWith('اضافه‌کاری'), msg());
  await addRow(1405, 7, 1, 'Ali', '07:00', '16:00');
  check('same worker, same day -> Farsi duplicate message', msg() === 'برای این کارگر در این تاریخ قبلاً ردیفی ثبت شده است.', msg());
  await addRow(1405, 12, 29, 'Ali', '07:00', '16:00');
  check('future date refused in Farsi', msg() === 'تاریخ نمی‌تواند برای آینده باشد.', msg());
  await addRow(1405, 8, 1, 'Ali', '07:00', '16:00');
  await addRow(1405, 8, 1, 'Hasan', '08:00', '17:00');
  await addRow(1405, 8, 1, 'Reza', '', '', { off: true });
  await addRow(1405, 8, 2, 'Ali', '07:00', '18:00', { overtime: '۲' });
  await addRow(1405, 8, 2, 'Hasan', '08:00', '17:00', { holiday: true, note: 'کار در تعطیل' });
  check('view jumped to Aban with its 5 rows', +named('view_month').value === 8 && rowsOf().length === 5, rowsOf().length);
  check('overtime, holiday and off-day shown', rowsOf().find((r) => r[0] === '۱۴۰۵/۰۸/۰۲' && r[1] === 'Ali')[4] === '۲' &&
    rowsOf().find((r) => r[1] === 'Hasan' && r[5] === '✓') && rowsOf().find((r) => r[1] === 'Reza')[6] === '✓');

  /* ---------- 4. edit and delete sheet rows ---------- */
  let i = indexOfRow((r) => r[0] === '۱۴۰۵/۰۸/۰۱' && r[1] === 'Ali');
  rowButton(i, 'edit').click();
  check('pop-up prefilled with the row (Solar date, times, worker)', isOpen() && named('edit_arrival_time').value === '07:00' && named('edit_exit_time').value === '16:00' &&
    +named('edit_year').value === 1405 && +named('edit_month').value === 8 && +named('edit_day').value === 1 && text(named('edit_worker_id').selectedOptions[0]) === 'Ali');
  check('main add form untouched while editing', named('arrival_time', f()).value === '');
  await submitForm($('dialog form'));
  check('no change -> refused', popupMsg() === 'تغییری ایجاد نشده است.');
  named('edit_exit_time').value = ''; await submitForm($('dialog form'));
  check('clearing one time -> Farsi error inside the pop-up', isOpen() && popupMsg() === 'ساعت ورود و ساعت خروج باید هر دو پر یا هر دو خالی باشند.', popupMsg());
  named('edit_exit_time').value = '17:30'; await submitForm($('dialog form'));
  check('saved exit time (PATCH)', !isOpen() && rowsOf().some((r) => r[0] === '۱۴۰۵/۰۸/۰۱' && r[1] === 'Ali' && r[3] === '۱۷:۳۰'), rowsOf());
  i = indexOfRow((r) => r[0] === '۱۴۰۵/۰۸/۰۱' && r[1] === 'Ali');
  rowButton(i, 'edit').click(); named('edit_exit_time').value = '16:00'; await submitForm($('dialog form'));
  check('exit time put back to 16:00', rowsOf().some((r) => r[0] === '۱۴۰۵/۰۸/۰۱' && r[1] === 'Ali' && r[3] === '۱۶:۰۰'));
  // move a row to another day and worker, through the pop-up
  await addRow(1405, 8, 3, 'Reza', '07:00', '16:00');
  i = indexOfRow((r) => r[0] === '۱۴۰۵/۰۸/۰۳');
  rowButton(i, 'edit').click(); await setv(named('edit_day'), 2); named('edit_worker_id').value = $$('[name=edit_worker_id] option').find((x) => text(x) === 'Hasan').value;
  await submitForm($('dialog form'));
  check('moving onto an occupied day+worker -> Farsi duplicate message in the pop-up', isOpen() && popupMsg() === 'برای این کارگر در این تاریخ قبلاً ردیفی ثبت شده است.', popupMsg());
  named('edit_worker_id').value = $$('[name=edit_worker_id] option').find((x) => text(x) === 'Reza').value; await submitForm($('dialog form'));
  check('moved to 2 Aban for Reza', !isOpen() && rowsOf().some((r) => r[0] === '۱۴۰۵/۰۸/۰۲' && r[1] === 'Reza') && !rowsOf().some((r) => r[0] === '۱۴۰۵/۰۸/۰۳'), rowsOf());
  i = indexOfRow((r) => r[0] === '۱۴۰۵/۰۸/۰۲' && r[1] === 'Reza');
  confirmAnswer = false; rowButton(i, 'del').click(); await settle();
  check('declined delete keeps the row', rowsOf().length === 6);
  confirmAnswer = true; rowButton(i, 'del').click(); await settle();
  check('confirmed delete removes the row', rowsOf().length === 5 && !rowsOf().some((r) => r[0] === '۱۴۰۵/۰۸/۰۲' && r[1] === 'Reza'));
  // editing a row somebody else already deleted
  i = indexOfRow((r) => r[0] === '۱۴۰۵/۰۸/۰۱' && r[1] === 'Reza');
  rowButton(i, 'edit').click();
  await fetch(BASE + '/api/shahran/time-sheet/2026-10-23/' + (await (await fetch(BASE + '/api/shahran/workers')).json()).find((x) => x.full_name === 'Reza').worker_id, { method: 'DELETE' });
  named('edit_explanation').value = 'x'; await submitForm($('dialog form'));
  check('stale edit -> Farsi 404 in the pop-up, table refreshed', isOpen() && popupMsg() === 'این مورد پیدا نشد؛ شاید قبلاً حذف شده باشد.' && rowsOf().length === 4, [popupMsg(), rowsOf().length]);
  $('dialog .secondary').click();
  await addRow(1405, 8, 1, 'Reza', '', '', { off: true });   // restore the off-day row
  check('restored: 5 rows in Aban', rowsOf().length === 5);

  /* ---------- 4b. export buttons (new) ---------- */
  check('sheet tab: export bar (Excel + CSV) sits under the heading', $$('.export', view()).length === 1 &&
    $$('.export button', view()).map(text).join('|') === 'دانلود Excel|دانلود CSV' && $('.export', view()).previousElementSibling.tagName === 'H2');

  /* ---------- 5. aggregated tab ---------- */
  await tab('کارکرد تجمیعی ماهانه');
  check('aggregated tab: export bar (Excel + CSV)', $$('.export button', view()).map(text).join('|') === 'دانلود Excel|دانلود CSV');
  let rows = rowsOf();
  check('Aban shows all 30 days', rows.length === 30);
  check('1 Aban: total 2 = simple 1 + builder 1 (off-day not counted)', rows[0].slice(0, 4).join('|') === '۱۴۰۵/۰۸/۰۱|۲|۱|۱', rows[0]);
  check('2 Aban: holiday work counted', rows[1].slice(0, 4).join('|') === '۱۴۰۵/۰۸/۰۲|۲|۱|۱', rows[1]);
  check('an empty day shows zeros', rows[10].slice(1, 4).join('|') === '۰|۰|۰');
  check('month footer: 4 / 2 / 2', footOf().slice(0, 4).join('|') === 'جمع ماه|۴|۲|۲', footOf());
  await setv(named('view_month'), 7);
  rows = rowsOf();
  check('Mehr: 30 days, 30 Mehr has 2 workers (absent builder not counted), 1 Mehr has 1', rows.length === 30 && rows[29][1] === '۲' && rows[29][3] === '۰' && rows[0][1] === '۱', [rows.length, rows[29]]);
  rowButton(2, 'edit').click();
  check('explanation pop-up opens', isOpen() && text($('dialog h2')).startsWith('توضیحات'));
  await submitForm($('dialog form'));
  check('unchanged explanation refused', popupMsg() === 'تغییری ایجاد نشده است.');
  named('day_explanation').value = 'بازرسی کارگاه'; await submitForm($('dialog form'));
  check('explanation saved and shown', !isOpen() && rowsOf()[2][4] === 'بازرسی کارگاه');
  rowButton(2, 'edit').click(); named('day_explanation').value = '  '; await submitForm($('dialog form'));
  check('emptying the explanation clears it', !isOpen() && rowsOf()[2][4] === '');

  /* ---------- 6. monthly pay ---------- */
  await tab('حقوق ماهانه');
  check('pay tab has no export bar (not requested)', $$('.export', view()).length === 0);
  const pay = () => Object.fromEntries(rowsOf().map((r) => [r[0], r.slice(1)]));
  let p = pay();
  check('Mehr: Ali 2 days = 2,000,000; Reza 1 day = 1,200,000; Hasan absent = 0',
    p.Ali.join('|') === '۲|۱٬۰۰۰٬۰۰۰|۲٬۰۰۰٬۰۰۰' && p.Reza.join('|') === '۱|۱٬۲۰۰٬۰۰۰|۱٬۲۰۰٬۰۰۰' && p.Hasan.join('|') === '۰|۲٬۰۰۰٬۰۰۰|۰', p);
  check('Mehr total 3,200,000', footOf().pop() === '۳٬۲۰۰٬۰۰۰', footOf());
  await setv(named('view_month'), 8); p = pay();
  check('Aban: Ali 2,000,000 (overtime ignored), Hasan 4,000,000 (holiday work counts), Reza 0', p.Ali[2] === '۲٬۰۰۰٬۰۰۰' && p.Hasan.join('|') === '۲|۲٬۰۰۰٬۰۰۰|۴٬۰۰۰٬۰۰۰' && p.Reza[2] === '۰', p);
  check('Aban total 6,000,000', footOf().pop() === '۶٬۰۰۰٬۰۰۰');
  await setv(named('view_month'), 9);
  check('month without work shows the empty message', text(view()).includes('برای این ماه کارکردی ثبت نشده است'));
  await setv(named('view_month'), 8);

  /* ---------- 7. guard rails ---------- */
  await tab('کارگران');
  confirmAnswer = true; rowButton(indexOfRow((r) => r[0] === 'Hasan'), 'del').click(); await settle();
  check('deleting a worker with rows is refused in Farsi', msg().includes('ردیف کارکرد دارد') && rowsOf().some((r) => r[0] === 'Hasan'), msg());

  /* ---------- 8. back to the selector, qaem still works ---------- */
  $('#back').click(); await settle();
  check('back returns to the selector', $('#back').hidden && $$('.project-card').length === 3 && !$('.tabs'));
  $$('.project-card')[0].click(); await settle();
  check('qaem opens with its own page', text($('.page-head h2')) === 'پروژه قائم' && !!$('input[name=truck_id]'));
  named('truck_id').value = '۱۲'; named('truck_service_count').value = '۵'; fire($('form'), 'submit'); await settle();
  check('qaem can still add a row', $$('tbody tr').length >= 1 && text($('.msg')) === 'ردیف افزوده شد.', text($('.msg')));
  $('#back').click(); await settle();
  $$('.project-card')[1].click(); await settle();
  check('shahran can be re-opened and keeps its data (Aban pay)', text($('.page-head h2')) === 'پروژه شهران' && $$('.tabs button').length === 4);
  check('no JavaScript errors anywhere in the run', errors.length === 0, errors.slice(0, 3));

  console.log(`${checks} checks, ${failures} failures`);
  w.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.stack.split('\n').slice(0, 3).join(' | ')); process.exit(1); });