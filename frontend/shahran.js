/* shahran project view: workers, daily time sheet, aggregated daily counts and monthly pay (Farsi UI, Solar dates). */
(function (root) {
  'use strict';
  var J = root.Jalali;
  var MIN_YEAR = 1400;
  var SALARY_MAX = 1000000000000;
  var ROLES = [{ value: 'simple', label: 'کارگر ساده' }, { value: 'builder', label: 'بنا' }];
  var TABS = [['sheet', 'کارکرد روزانه'], ['agg', 'کارکرد تجمیعی ماهانه'], ['pay', 'حقوق ماهانه'], ['workers', 'کارگران']];

  function h(tag, props) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') el.textContent = props[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), props[k]);
      else el.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i += 1) if (arguments[i] != null) el.append(arguments[i]);
    return el;
  }

  async function api(method, path, body) {
    var res, data = null;
    try {
      res = await fetch('/api/shahran' + path, {
        method: method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      return { status: 0, ok: false };
    }
    if (res.status !== 204) { try { data = await res.json(); } catch (e) { /* no body */ } }
    return { status: res.status, ok: res.ok, data: data };
  }

  /* what: 'worker' or 'sheet' picks the wording of a 409 (duplicate). */
  function errorText(r, what) {
    var detail = JSON.stringify(r.data || '');
    if (r.status === 0) return 'ارتباط با سرور برقرار نشد.';
    if (r.status === 409) {
      if (detail.indexOf('worker does not exist') >= 0) return 'کارگر وجود ندارد یا هنوز ردیف کارکرد دارد؛ ابتدا ردیف‌های او را حذف کنید.';
      return what === 'worker' ? 'کارگری با این نام قبلاً ثبت شده است.' : 'برای این کارگر در این تاریخ قبلاً ردیفی ثبت شده است.';
    }
    if (r.status === 404) return 'این مورد پیدا نشد؛ شاید قبلاً حذف شده باشد.';
    if (r.status === 422) {
      if (detail.indexOf('future') >= 0) return 'تاریخ نمی‌تواند در آینده باشد.';
      if (detail.indexOf('both be filled') >= 0) return 'ساعت ورود و ساعت خروج باید هر دو پر یا هر دو خالی باشند.';
      return 'اطلاعات واردشده معتبر نیست.';
    }
    return 'خطای غیرمنتظره‌ای رخ داد.';
  }

  function range(from, to) { var a = []; for (var i = from; i <= to; i += 1) a.push(i); return a; }
  function fillSelect(sel, items, selected) {
    sel.replaceChildren.apply(sel, items.map(function (it) {
      var o = h('option', { value: it.value, text: it.label });
      if (String(it.value) === String(selected)) o.selected = true;
      return o;
    }));
  }
  function yearItems(from, to) { return range(from, to).map(function (y) { return { value: y, label: J.fa(y) }; }); }
  function monthItems() { return J.MONTHS.map(function (m, i) { return { value: i + 1, label: m }; }); }
  function th(text) { return h('th', { text: text }); }
  function field(label, control, cls) { return h('label', { class: 'field' + (cls ? ' ' + cls : '') }, h('span', { text: label }), control); }
  function check(label, input) { return h('label', { class: 'field check' }, input, h('span', { text: label })); }
  function textInput(name, mode) { return h('input', { name: name, type: 'text', autocomplete: 'off', inputmode: mode || 'text' }); }
  function money(n) { return J.fa(Number(n).toLocaleString('en-US')).replace(/,/g, '٬'); }
  function sum(rows, key) { return rows.reduce(function (a, r) { return a + r[key]; }, 0); }
  function clock(t) { return t ? J.fa(t.slice(0, 5)) : '—'; }
  function roleName(v) { return ROLES.filter(function (r) { return r.value === v; })[0].label; }

  /* Day / month / year selects for a Solar date; the day list follows the month and leap years. */
  function datePicker(today, prefix) {
    var dDay = h('select', { name: prefix + 'day', 'aria-label': 'روز' });
    var dMonth = h('select', { name: prefix + 'month', 'aria-label': 'ماه' });
    var dYear = h('select', { name: prefix + 'year', 'aria-label': 'سال' });
    function fillDays(selectedDay) {
      var len = J.monthLength(+dYear.value, +dMonth.value);
      fillSelect(dDay, range(1, len).map(function (d) { return { value: d, label: J.fa(d) }; }), Math.min(selectedDay, len));
    }
    function set(jy, jm, jd) {
      fillSelect(dYear, yearItems(Math.min(MIN_YEAR, jy), Math.max(today.jy, jy)), jy);
      fillSelect(dMonth, monthItems(), jm);
      fillDays(jd);
    }
    dMonth.addEventListener('change', function () { fillDays(+dDay.value); });
    dYear.addEventListener('change', function () { fillDays(+dDay.value); });
    set(today.jy, today.jm, today.jd);
    return {
      node: h('div', { class: 'field' }, h('span', { text: 'تاریخ (روز / ماه / سال)' }), h('div', { class: 'date-row' }, dDay, dMonth, dYear)),
      set: set,
      get: function () { return { jy: +dYear.value, jm: +dMonth.value, jd: +dDay.value }; }
    };
  }

  /* The fields of one time sheet row, used by the add form and by the edit pop-up. */
  function sheetFields(today, prefix) {
    var worker = h('select', { name: prefix + 'worker_id' });
    var picker = datePicker(today, prefix);
    var arrival = h('input', { name: prefix + 'arrival_time', type: 'time' });
    var exit = h('input', { name: prefix + 'exit_time', type: 'time' });
    var overtime = textInput(prefix + 'overtime', 'decimal');
    var holiday = h('input', { name: prefix + 'is_holiday', type: 'checkbox' });
    var off = h('input', { name: prefix + 'is_off_day', type: 'checkbox' });
    var note = textInput(prefix + 'explanation');
    overtime.value = '۰';

    function setWorkers(list) {
      var keep = worker.value;
      fillSelect(worker, list.map(function (w) { return { value: w.worker_id, label: w.full_name }; }), keep);
    }
    function clear() {
      arrival.value = ''; exit.value = ''; overtime.value = '۰'; holiday.checked = false; off.checked = false; note.value = '';
    }
    function set(r) {
      var p = r.work_day.split('-').map(Number), j = J.toJalali(p[0], p[1], p[2]);
      picker.set(j.jy, j.jm, j.jd);
      worker.value = r.worker_id;
      arrival.value = r.arrival_time || ''; exit.value = r.exit_time || '';
      overtime.value = J.fa(r.overtime); holiday.checked = r.is_holiday; off.checked = r.is_off_day; note.value = r.explanation || '';
    }
    /* Validate what the person typed/picked; returns {error} or {row, jy, jm}. */
    function read() {
      var d = picker.get(), o = J.en(overtime.value).replace(/٫/g, '.').trim() || '0';
      if (!worker.value) return { error: 'ابتدا از تب «کارگران» یک کارگر اضافه کنید.' };
      if (d.jy > today.jy || (d.jy === today.jy && (d.jm > today.jm || (d.jm === today.jm && d.jd > today.jd)))) {
        return { error: 'تاریخ نمی‌تواند برای آینده باشد.' };
      }
      if (!arrival.value !== !exit.value) return { error: 'ساعت ورود و ساعت خروج باید هر دو پر یا هر دو خالی باشند.' };
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(o) || +o > 24) return { error: 'اضافه‌کاری باید عددی بین ۰ تا ۲۴ ساعت باشد.' };
      return {
        row: {
          work_day: J.iso(J.toGregorian(d.jy, d.jm, d.jd)), worker_id: +worker.value,
          arrival_time: arrival.value || null, exit_time: exit.value || null, overtime: +o,
          is_holiday: holiday.checked, is_off_day: off.checked, explanation: note.value.trim() || null
        },
        jy: d.jy, jm: d.jm
      };
    }
    return {
      node: h('div', { class: 'fields' },
        field('کارگر', worker), picker.node, field('ساعت ورود', arrival), field('ساعت خروج', exit),
        field('اضافه‌کاری (ساعت)', overtime), check('تعطیلات', holiday), check('مرخصی', off), field('توضیحات', note, 'wide')),
      setWorkers: setWorkers, clear: clear, set: set, read: read, focus: function () { worker.focus(); }
    };
  }

  function mount(container) {
    var today = J.todayJalali();
    var shown = { jy: today.jy, jm: today.jm };
    var tab = 'sheet';
    var workers = [];
    var seq = 0;

    function say(text, ok) { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'error'); }
    var msg = h('p', { class: 'msg', role: 'status' });

    /* ---- month being displayed ---- */
    var vMonth = h('select', { name: 'view_month', 'aria-label': 'ماه' });
    var vYear = h('select', { name: 'view_year', 'aria-label': 'سال' });
    fillSelect(vMonth, monthItems(), shown.jm);
    fillSelect(vYear, yearItems(MIN_YEAR, Math.max(MIN_YEAR, today.jy)), shown.jy);
    function onViewChange() { shown = { jy: +vYear.value, jm: +vMonth.value }; load(); }
    vMonth.addEventListener('change', onViewChange);
    vYear.addEventListener('change', onViewChange);
    function showMonth(jy, jm) { shown = { jy: jy, jm: jm }; vYear.value = jy; vMonth.value = jm; }
    var monthPicker = h('div', { class: 'month-picker' }, field('ماه نمایش‌داده‌شده', vMonth), field('سال', vYear));

    /* ---- one pop-up, reused by every edit ---- */
    var onSave = null;           // returns '' on success or an error text
    var dTitle = h('h2');
    var dBody = h('div');
    var dSave = h('button', { type: 'submit', text: 'ذخیره تغییرات' });
    var dCancel = h('button', { type: 'button', class: 'secondary', text: 'انصراف' });
    var dMsg = h('p', { class: 'msg error', role: 'alert' });
    var dlg = h('dialog', {}, h('form', { novalidate: '' }, dTitle, dBody, h('div', { class: 'actions' }, dSave, dCancel), dMsg));

    function openPopup(title, body, save) {
      onSave = save;
      dTitle.textContent = title;
      dlg.setAttribute('aria-label', title);
      dBody.replaceChildren(body);
      dMsg.textContent = '';
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    }
    function closePopup() {
      if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
      onSave = null;
    }
    dCancel.addEventListener('click', closePopup);
    dlg.addEventListener('close', function () { onSave = null; });                        // also fires on Esc
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) closePopup(); }); // click on the backdrop
    dlg.querySelector('form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!onSave) return;
      dSave.disabled = true;
      var err;
      try { err = await onSave(); } finally { dSave.disabled = false; }
      if (err) { dMsg.textContent = err; return; }
      closePopup();
      load();
    });

    async function remove(question, path, what) {
      if (!root.confirm(question)) return;
      var res = await api('DELETE', path);
      if (!res.ok) { say(errorText(res, what), false); return load(); }
      say('مورد حذف شد.', true);
      load();
    }

    /* ---- workers tab ---- */
    var wName = textInput('worker_name');
    var wRole = h('select', { name: 'worker_role' });
    var wSalary = textInput('worker_salary', 'numeric');
    fillSelect(wRole, ROLES, 'simple');
    var wAdd = h('button', { type: 'submit', text: 'افزودن' });
    var workersBox = h('div', { class: 'scroll' });

    function readWorker(nameEl, roleEl, salaryEl) {
      var name = nameEl.value.trim(), s = J.en(salaryEl.value).replace(/[٬,\s]/g, '');
      if (!name || name.length > 100) return { error: 'نام کارگر را وارد کنید (حداکثر ۱۰۰ نویسه).' };
      if (!/^\d+$/.test(s) || +s > SALARY_MAX) return { error: 'حقوق روزانه باید یک عدد صحیح صفر یا بیشتر باشد.' };
      return { row: { full_name: name, role: roleEl.value, daily_salary: +s } };
    }

    var workerForm = h('form', { novalidate: '', class: 'card' },
      h('h2', { text: 'افزودن کارگر' }),
      h('div', { class: 'fields' }, field('نام کارگر', wName), field('سمت', wRole), field('حقوق روزانه', wSalary)),
      h('div', { class: 'actions' }, wAdd));
    workerForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var res = readWorker(wName, wRole, wSalary);
      if (res.error) return say(res.error, false);
      wAdd.disabled = true;
      var r;
      try { r = await api('POST', '/workers', res.row); } finally { wAdd.disabled = false; }
      if (!r.ok) return say(errorText(r, 'worker'), false);
      wName.value = ''; wSalary.value = '';
      say('کارگر افزوده شد.', true);
      await load();
      wName.focus();
    });

    var eName = textInput('edit_worker_name');
    var eRole = h('select', { name: 'edit_worker_role' });
    var eSalary = textInput('edit_worker_salary', 'numeric');
    fillSelect(eRole, ROLES, 'simple');
    var workerEdit = h('div', { class: 'fields' }, field('نام کارگر', eName), field('سمت', eRole), field('حقوق روزانه', eSalary));

    function editWorker(w) {
      eName.value = w.full_name; eRole.value = w.role; eSalary.value = J.fa(w.daily_salary);
      openPopup('ویرایش کارگر', workerEdit, async function () {
        var res = readWorker(eName, eRole, eSalary);
        if (res.error) return res.error;
        var changes = {};
        Object.keys(res.row).forEach(function (k) { if (res.row[k] !== w[k]) changes[k] = res.row[k]; });
        if (!Object.keys(changes).length) return 'تغییری ایجاد نشده است.';
        var r = await api('PATCH', '/workers/' + w.worker_id, changes);
        if (!r.ok) return errorText(r, 'worker');
        say('تغییرات ذخیره شد.', true);
        return '';
      });
    }

    function renderWorkers(rows) {
      if (!rows.length) return workersBox.replaceChildren(h('p', { class: 'empty', text: 'هنوز کارگری ثبت نشده است.' }));
      var body = h('tbody');
      rows.forEach(function (w) {
        body.append(h('tr', {},
          h('td', { text: w.full_name }),
          h('td', { text: roleName(w.role) }),
          h('td', { text: money(w.daily_salary) }),
          h('td', { class: 'row-actions' },
            h('button', { type: 'button', class: 'secondary', text: 'ویرایش', onclick: function () { editWorker(w); } }),
            h('button', { type: 'button', class: 'danger', text: 'حذف', onclick: function () {
              remove('آیا از حذف این کارگر مطمئن هستید؟', '/workers/' + w.worker_id, 'worker'); } }))
        ));
      });
      workersBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, th('نام'), th('سمت'), th('حقوق روزانه'), th(''))), body));
    }

    /* ---- daily time sheet tab ---- */
    var add = sheetFields(today, '');
    var addBtn = h('button', { type: 'submit', text: 'افزودن' });
    var sheetBox = h('div', { class: 'scroll' });
    var sheetForm = h('form', { novalidate: '', class: 'card' },
      h('h2', { text: 'افزودن ردیف کارکرد' }), add.node, h('div', { class: 'actions' }, addBtn));
    sheetForm.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var res = add.read();
      if (res.error) return say(res.error, false);
      addBtn.disabled = true;
      var r;
      try { r = await api('POST', '/time-sheet', res.row); } finally { addBtn.disabled = false; }
      if (!r.ok) return say(errorText(r, 'sheet'), false);
      add.clear();
      say('ردیف افزوده شد.', true);
      showMonth(res.jy, res.jm);
      await load();
      add.focus();
    });

    var edit = sheetFields(today, 'edit_');
    function editSheet(r) {
      var before = { work_day: r.work_day, worker_id: r.worker_id, arrival_time: r.arrival_time ? r.arrival_time.slice(0, 5) : null,
        exit_time: r.exit_time ? r.exit_time.slice(0, 5) : null, overtime: Number(r.overtime), is_holiday: r.is_holiday,
        is_off_day: r.is_off_day, explanation: r.explanation };
      edit.setWorkers(workers);
      edit.set(before);
      openPopup('ویرایش کارکرد ' + r.full_name + ' — ' + J.isoToJalaliText(r.work_day), edit.node, async function () {
        var res = edit.read();
        if (res.error) return res.error;
        var changes = {};
        Object.keys(res.row).forEach(function (k) { if (res.row[k] !== before[k]) changes[k] = res.row[k]; });
        if (!Object.keys(changes).length) return 'تغییری ایجاد نشده است.';
        var p = await api('PATCH', '/time-sheet/' + r.work_day + '/' + r.worker_id, changes);
        if (!p.ok) { if (p.status === 404) load(); return errorText(p, 'sheet'); }
        say('تغییرات ذخیره شد.', true);
        showMonth(res.jy, res.jm);
        return '';
      });
    }

    function renderSheet(rows) {
      if (!rows.length) return sheetBox.replaceChildren(h('p', { class: 'empty', text: 'برای این ماه ردیفی ثبت نشده است.' }));
      var body = h('tbody');
      rows.forEach(function (r) {
        body.append(h('tr', {},
          h('td', { text: J.isoToJalaliText(r.work_day) }),
          h('td', { text: r.full_name }),
          h('td', { text: clock(r.arrival_time) }),
          h('td', { text: clock(r.exit_time) }),
          h('td', { text: r.overtime ? J.fa(r.overtime).replace('.', '٫') : '—' }),
          h('td', { text: r.is_holiday ? '✓' : '' }),
          h('td', { text: r.is_off_day ? '✓' : '' }),
          h('td', { text: r.explanation || '' }),
          h('td', { class: 'row-actions' },
            h('button', { type: 'button', class: 'secondary', text: 'ویرایش', onclick: function () { editSheet(r); } }),
            h('button', { type: 'button', class: 'danger', text: 'حذف', onclick: function () {
              remove('آیا از حذف این ردیف مطمئن هستید؟', '/time-sheet/' + r.work_day + '/' + r.worker_id, 'sheet'); } }))
        ));
      });
      sheetBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {},
        th('تاریخ'), th('کارگر'), th('ساعت ورود'), th('ساعت خروج'), th('اضافه‌کاری'), th('تعطیلات'), th('مرخصی'), th('توضیحات'), th(''))), body));
    }

    /* ---- aggregated tab ---- */
    var aggBox = h('div', { class: 'scroll' });
    var note = h('textarea', { name: 'day_explanation', rows: '4', 'aria-label': 'توضیحات' });

    function editNote(r) {
      note.value = r.explanation || '';
      openPopup('توضیحات ' + J.isoToJalaliText(r.work_day), note, async function () {
        var text = note.value.trim(), path = '/aggregated-work/' + r.work_day, p;
        if (text === (r.explanation || '')) return 'تغییری ایجاد نشده است.';
        p = text ? await api('PUT', path, { explanation: text }) : await api('DELETE', path);
        if (!p.ok) return errorText(p, 'sheet');
        say('تغییرات ذخیره شد.', true);
        return '';
      });
    }

    function renderAgg(rows) {
      var body = h('tbody');
      rows.forEach(function (r) {
        body.append(h('tr', {},
          h('td', { text: J.isoToJalaliText(r.work_day) }),
          h('td', { text: J.fa(r.total_workers) }),
          h('td', { text: J.fa(r.simple_workers) }),
          h('td', { text: J.fa(r.builders) }),
          h('td', { text: r.explanation || '' }),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'secondary', text: 'ویرایش توضیحات', onclick: function () { editNote(r); } }))
        ));
      });
      var foot = h('tfoot', {}, h('tr', {}, h('td', { text: 'جمع ماه' }), h('td', { text: J.fa(sum(rows, 'total_workers')) }),
        h('td', { text: J.fa(sum(rows, 'simple_workers')) }), h('td', { text: J.fa(sum(rows, 'builders')) }), h('td'), h('td')));
      aggBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {},
        th('تاریخ'), th('مجموع کارگران'), th('کارگر ساده'), th('بنا'), th('توضیحات'), th(''))), body, foot));
    }

    /* ---- monthly pay tab ---- */
    var payBox = h('div', { class: 'scroll' });
    function renderPay(rows) {
      if (!rows.length) return payBox.replaceChildren(h('p', { class: 'empty', text: 'برای این ماه کارکردی ثبت نشده است.' }));
      var body = h('tbody');
      rows.forEach(function (r) {
        body.append(h('tr', {}, h('td', { text: r.full_name }), h('td', { text: J.fa(r.work_days) }),
          h('td', { text: money(r.daily_salary) }), h('td', { text: money(r.salary) })));
      });
      var foot = h('tfoot', {}, h('tr', {}, h('td', { text: 'جمع کل' }), h('td', { text: J.fa(sum(rows, 'work_days')) }),
        h('td'), h('td', { text: money(sum(rows, 'salary')) })));
      payBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, th('کارگر'), th('روزهای کارکرد'), th('حقوق روزانه'), th('حقوق ماه'))), body, foot));
    }

    /* ---- loading ---- */
    async function load() {
      var mine = ++seq, rg = J.monthRange(shown.jy, shown.jm), q = '?from=' + rg.from + '&to=' + rg.to;
      var calls = tab === 'workers' ? [api('GET', '/workers')]
        : tab === 'sheet' ? [api('GET', '/workers'), api('GET', '/time-sheet' + q)]
        : tab === 'agg' ? [api('GET', '/aggregated-work' + q)]
        : [api('GET', '/monthly-salary?year=' + shown.jy + '&month=' + shown.jm)];
      var res = await Promise.all(calls);
      if (mine !== seq) return;
      var bad = res.filter(function (r) { return !r.ok; })[0];
      if (bad) return say(errorText(bad), false);
      if (tab === 'workers') { workers = res[0].data; renderWorkers(workers); }
      else if (tab === 'sheet') { workers = res[0].data; add.setWorkers(workers); renderSheet(res[1].data); }
      else if (tab === 'agg') renderAgg(res[0].data);
      else renderPay(res[0].data);
    }

    /* ---- tabs and page ---- */
    function section(title, body) { return h('section', { class: 'card' }, h('h2', { text: title }), body); }
    var panels = {
      sheet: h('div', { class: 'panel' }, sheetForm, section('کارکرد روزانهٔ ثبت‌شده', sheetBox)),
      agg: h('div', { class: 'panel' }, section('کارکرد تجمیعی ماهانه', aggBox)),
      pay: h('div', { class: 'panel' }, section('حقوق ماهانه', payBox)),
      workers: h('div', { class: 'panel' }, workerForm, section('کارگران', workersBox))
    };
    var tabButtons = {};
    var tabBar = h('div', { class: 'tabs', role: 'tablist' });
    TABS.forEach(function (t) {
      tabButtons[t[0]] = h('button', { type: 'button', role: 'tab', class: 'tab', text: t[1], onclick: function () { setTab(t[0]); } });
      tabBar.append(tabButtons[t[0]]);
    });
    function setTab(key) {
      tab = key;
      Object.keys(panels).forEach(function (k) {
        panels[k].hidden = k !== key;
        tabButtons[k].setAttribute('aria-selected', k === key ? 'true' : 'false');
      });
      monthPicker.hidden = key === 'workers';
      msg.textContent = ''; msg.className = 'msg';
      return load();
    }

    container.replaceChildren(
      h('section', { class: 'page-head' },
        h('div', { class: 'wrap head-row' },
          h('div', {}, h('p', { class: 'eyebrow', text: 'کارکرد روزانهٔ کارگران' }), h('h2', { text: 'پروژه شهران' })),
          monthPicker)),
      h('div', { class: 'wrap stack' }, tabBar, msg, panels.sheet, panels.agg, panels.pay, panels.workers),
      dlg
    );
    return setTab('sheet');
  }

  root.ShahranView = { mount: mount };
})(this);