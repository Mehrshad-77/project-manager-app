/* shahran project view: workers, daily time sheet, aggregated daily counts, monthly attendance sheet and monthly pay (Farsi UI, Solar dates). */
(function (root) {
  'use strict';
  var J = root.Jalali;
  var MIN_YEAR = 1400;
  var SALARY_MAX = 1000000000000;
  /* Default work time pre-filled in the time sheet form. <input type="time"> always needs 24-hour "HH:MM". */
  var DEFAULT_ARRIVAL = '08:00';
  var DEFAULT_EXIT = '17:00';
  var ROLES = [{ value: 'simple', label: 'کارگر ساده' }, { value: 'builder', label: 'بنا' }];
  /* Starting text of the letter on top of the aggregated Excel file; the person edits it before downloading. */
  var LETTER_TO = 'مدیریت محترم پروژه دسترسی به آزادراه تهران-شمال جناب آقای دکتر پروانه';
  var LETTER_BODY = 'با سلام, احتراما بدینوسیله به استحضار میرساند جهت تجهیز و اماده سازی کارگاه در تاریخ های ذیل نفرات با کارگاه همکاری نمودند';
  var TABS = [['sheet', 'کارکرد روزانه'], ['agg', 'کارکرد تجمیعی ماهانه'], ['att', 'حضور و غیاب ماهانه'], ['pay', 'حقوق ماهانه'], ['workers', 'کارگران'], ['invoice', 'فاکتور شاتکریت کوهسار']];
  /* Headings of the attendance sheet (the same texts are used by the Excel file). */
  var SITE = 'کارگاه تونل دسترسی تهران_شمال پروژه شهران';
  var CONTRACTOR = 'پیمانکار اسکندری';
  var ATT_BOX = 'حضور‌غیاب کل‌ماه';
  var HALF_DAY = J.fa('1/2');
  /* Invoice tab (فاکتور شاتکریت کوهسار). Limits are the same as in shahran/backend/invoice.py. */
  var MONEY_MAX = 10000000000000n;   // every amount and every row total (BigInt: exact, whatever the size)
  var QTY_MAX = 1000000n;
  var MAX_ITEMS = 30;
  /* [name sent to the server, label, extra CSS class, longest text allowed] */
  var CONTRACTOR_FIELDS = [['contractor_name', 'نام شخص حقوقی', '', 150], ['contractor_address', 'نشانی کامل', 'wide', 300],
    ['contractor_economic_no', 'شماره اقتصادی', '', 30], ['contractor_postal_code', 'کد پستی', '', 30],
    ['contractor_national_id', 'شماره ملی', '', 30], ['contractor_phone', 'شماره تماس', '', 40]];
  var EMPLOYER_FIELDS = [['employer_name', 'نام شخص حقیقی/حقوقی', '', 150], ['employer_economic_no', 'شماره اقتصادی', '', 30],
    ['employer_registration_no', 'شماره ثبت/ملی', '', 30], ['employer_address', 'نشانی', 'wide', 300], ['employer_phone', 'تلفن', '', 40]];
  var ITEM_HEADS = ['ردیف', 'شرح کالا', 'واحد کالا', 'تعداد', 'مبلغ واحد (ریال)', 'مبلغ کل (ریال)', 'جمع مالیات و عوارض (ریال)',
    'مبلغ تخفیف', 'جمع کل به علاوه مالیات و عوارض (ریال)', ''];
  var ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه', 'ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
  var TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
  var HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
  var SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

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
  function days(n) { return J.fa(n).replace('.', '٫'); }
  function sum(rows, key) { return rows.reduce(function (a, r) { return a + r[key]; }, 0); }
  function clock(t) { return t ? J.fa(t.slice(0, 5)) : '—'; }
  /* 999000000n -> 'نهصد و نود و نه میلیون ریال' (the same words as rial_words in shahran/backend/invoice.py). */
  function rialWords(n) {
    var parts = [], scale = 0, g, r, w;
    if (n === 0n) return 'صفر ریال';
    for (; n > 0n; n /= 1000n, scale += 1) {
      g = Number(n % 1000n);
      if (!g) continue;
      r = g % 100;
      w = [HUNDREDS[Math.floor(g / 100)], r < 20 ? ONES[r] : TENS[Math.floor(r / 10)], r >= 20 ? ONES[r % 10] : ''].filter(Boolean).join(' و ');
      parts.unshift(w + (SCALES[scale] ? ' ' + SCALES[scale] : ''));
    }
    return parts.join(' و ') + ' ریال';
  }
  /* What the person typed -> BigInt, or null when it is not a whole number. An empty box is 0 unless it is required. */
  function amount(text, required) {
    var s = J.en(text).replace(/[٬,\s]/g, '');
    if (!s) return required ? null : 0n;
    return /^\d+$/.test(s) ? BigInt(s) : null;
  }
  /* Quantity with up to 3 decimals: {text: '222.5', thousandths: 222500n} or null. */
  function quantity(text) {
    var m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(J.en(text).replace(/[٬,\s]/g, '').replace(/٫/g, '.'));
    return m ? { text: m[1] + (m[2] ? '.' + m[2] : ''), thousandths: BigInt(m[1] + (m[2] || '').padEnd(3, '0')) } : null;
  }
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
    arrival.value = DEFAULT_ARRIVAL;
    exit.value = DEFAULT_EXIT;

    function setWorkers(list) {
      var keep = worker.value;
      fillSelect(worker, list.map(function (w) { return { value: w.worker_id, label: w.full_name }; }), keep);
    }
    /* Back to the starting state of the add form: the default work time, nothing else filled. */
    function clear() {
      arrival.value = DEFAULT_ARRIVAL; exit.value = DEFAULT_EXIT;
      overtime.value = '۰'; holiday.checked = false; off.checked = false; note.value = '';
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

    /* ---- monthly attendance tab: one column per worker, like the printed sheet ---- */
    var attRole = h('select', { name: 'att_role', 'aria-label': 'سمت' });
    fillSelect(attRole, ROLES, 'simple');
    attRole.addEventListener('change', load);
    var attBox = h('div', { class: 'scroll' });

    function renderAtt(a) {
      if (!a.workers.length) return attBox.replaceChildren(h('p', { class: 'empty', text: 'برای این ماه کارکردی ثبت نشده است.' }));
      var n = a.workers.length, mark = ['—', HALF_DAY, J.fa(1)];   // index = half-day units: 0, 1, 2
      var tally = function (x) { return J.fa(x).replace('.', '/'); };
      var title = SITE + ' (' + J.MONTHS[shown.jm - 1] + ' ' + J.fa(shown.jy) + ')';
      var names = h('tr', {}, th('تاریخ'), th('ساعت ورود'), th('ساعت خروج'));
      a.workers.forEach(function (w) { names.append(th(w.full_name)); });
      names.append(th('توضیحات'), th(''));
      var body = h('tbody');
      a.days.forEach(function (d) {
        var tr = h('tr', {}, h('td', { text: J.isoToJalaliText(d.work_day) }), h('td', { text: clock(d.arrival_time) }), h('td', { text: clock(d.exit_time) }));
        d.units.forEach(function (u) { tr.append(h('td', { text: mark[u] })); });
        tr.append(h('td', { text: d.explanation || '' }),
          h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'secondary', text: 'ویرایش توضیحات', onclick: function () { editNote(d); } })));
        body.append(tr);
      });
      var foot = h('tr', {}, h('td', { text: 'جمع کل کارکرد' }), h('td', { text: tally(a.totals.reduce(function (x, y) { return x + y; }, 0)), colspan: '2' }));
      a.totals.forEach(function (t) { foot.append(h('td', { text: tally(t) })); });
      foot.append(h('td'), h('td'));
      /* wage rows: daily wage and pay per worker, the total and the total in words */
      var wide = function (label, cells) {
        var tr = h('tr', {}, h('td', { text: label, colspan: '3' }));
        cells.forEach(function (c) { tr.append(c); });
        return tr;
      };
      var perWorker = function (key) { return a.workers.map(function (w) { return h('td', { text: money(w[key]) }); }); };
      var rest = function (text) { return h('td', { text: text, colspan: String(n + 2) }); };
      attBox.replaceChildren(h('table', { class: 'att' },
        h('thead', {},
          h('tr', {}, h('th', { text: title, colspan: String(n + 5) })),
          h('tr', {}, h('th', { text: CONTRACTOR, colspan: '3' }), h('th', { text: ATT_BOX, colspan: String(n) }),
            h('th', { text: 'سمت:' + roleName(attRole.value), colspan: '2' })),
          names),
        body, h('tfoot', {}, foot,
          wide('دستمزد روزانه', perWorker('daily_salary').concat(h('td', { colspan: '2' }))),
          wide('دستمزد قابل پرداخت', perWorker('pay').concat(h('td', { colspan: '2' }))),
          wide('جمع دستمزد قابل پرداخت', [rest(money(a.total_pay) + ' ریال')]),
          wide('مبلغ به حروف', [rest(a.total_pay_words + ' ریال')]))));
    }

    /* ---- monthly pay tab ---- */
    var payBox = h('div', { class: 'scroll' });
    function renderPay(rows) {
      if (!rows.length) return payBox.replaceChildren(h('p', { class: 'empty', text: 'برای این ماه کارکردی ثبت نشده است.' }));
      var body = h('tbody');
      rows.forEach(function (r) {
        body.append(h('tr', {}, h('td', { text: r.full_name }), h('td', { text: days(r.work_days) }),
          h('td', { text: money(r.daily_salary) }), h('td', { text: money(r.salary) })));
      });
      var foot = h('tfoot', {}, h('tr', {}, h('td', { text: 'جمع کل' }), h('td', { text: days(sum(rows, 'work_days')) }),
        h('td'), h('td', { text: money(sum(rows, 'salary')) })));
      payBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, th('کارگر'), th('روزهای کارکرد'), th('حقوق روزانه'), th('حقوق ماه'))), body, foot));
    }

    /* ---- invoice tab: typed here and never stored; the server turns it into the Excel file ---- */
    var invInputs = {};
    function invBox(specs) {
      var box = h('div', { class: 'fields' });
      specs.forEach(function (f) {
        var input = textInput(f[0]);
        input.setAttribute('maxlength', f[3]);
        invInputs[f[0]] = input;
        box.append(field(f[1], input, f[2]));
      });
      return box;
    }
    var invNumber = textInput('invoice_number');
    invNumber.setAttribute('maxlength', 30);
    var invPicker = datePicker(today, 'invoice_');
    var invPayment = h('select', { name: 'invoice_payment' });
    fillSelect(invPayment, [{ value: '', label: '—' }, { value: 'cash', label: 'نقدی' }, { value: 'non_cash', label: 'غیر نقدی' }], '');
    var invSheba = textInput('invoice_sheba');
    invSheba.setAttribute('maxlength', 200);
    var invMsg = h('p', { class: 'msg', role: 'alert' });
    var invFrame = h('iframe', { name: 'invoice_download', title: 'دانلود', hidden: '' });   // the download lands here, so this page stays

    var itemRows = [];
    var itemsBody = h('tbody');
    var sumNumber = h('strong', { class: 'sum-number' });
    var sumWords = h('span', { class: 'sum-words' });
    var addItemBtn = h('button', { type: 'button', class: 'secondary', text: 'افزودن ردیف', onclick: function () { addItem(); } });

    function itemRow() {
      var r = { desc: textInput('item_description'), unit: textInput('item_unit'), qty: textInput('item_quantity', 'decimal'),
        price: textInput('item_unit_price', 'numeric'), tax: textInput('item_tax', 'numeric'), disc: textInput('item_discount', 'numeric'),
        total: h('td'), final: h('td') };
      r.desc.setAttribute('maxlength', 300);
      r.unit.setAttribute('maxlength', 30);
      r.tr = h('tr', {}, h('td'), h('td', { class: 'desc' }, r.desc), h('td', {}, r.unit), h('td', {}, r.qty), h('td', {}, r.price), r.total,
        h('td', {}, r.tax), h('td', {}, r.disc), r.final,
        h('td', { class: 'row-actions' }, h('button', { type: 'button', class: 'danger', text: 'حذف', onclick: function () { removeItem(r); } })));
      r.tr.addEventListener('input', recalc);
      return r;
    }
    function addItem() { var r = itemRow(); itemRows.push(r); itemsBody.append(r.tr); recalc(); return r; }
    function removeItem(r) {
      itemRows.splice(itemRows.indexOf(r), 1);
      r.tr.remove();
      if (!itemRows.length) addItem(); else recalc();
    }

    /* Fills each row's two computed cells and the grand total. Returns {items, error}: the rows to send (empty rows are
       left out) and the first problem found, in Farsi. */
    function recalc() {
      var items = [], total = 0n, error = '';
      itemRows.forEach(function (r, i) {
        var v = [r.desc, r.unit, r.qty, r.price, r.tax, r.disc].map(function (e) { return e.value.trim(); });
        var q, p, t, d, line, problem = '';
        r.tr.firstChild.textContent = J.fa(i + 1);
        r.total.textContent = r.final.textContent = '—';
        if (!v.some(Boolean)) return;
        q = quantity(v[2]); p = amount(v[3], true); t = amount(v[4]); d = amount(v[5]);
        if (!v[0]) problem = 'شرح کالا را وارد کنید.';
        else if (!q) problem = 'تعداد باید یک عدد (حداکثر با سه رقم اعشار) باشد.';
        else if (p === null) problem = 'مبلغ واحد باید یک عدد صحیح صفر یا بیشتر باشد.';
        else if (t === null) problem = 'جمع مالیات و عوارض باید یک عدد صحیح صفر یا بیشتر باشد.';
        else if (d === null) problem = 'مبلغ تخفیف باید یک عدد صحیح صفر یا بیشتر باشد.';
        else {
          line = (q.thousandths * p + 500n) / 1000n;   // تعداد × مبلغ واحد, whole rials, halves round up
          if (q.thousandths > QTY_MAX * 1000n || p > MONEY_MAX || t > MONEY_MAX || d > MONEY_MAX || line > MONEY_MAX) problem = 'تعداد یا مبلغ بیش از حد مجاز است.';
        }
        if (problem) { error = error || 'ردیف ' + J.fa(i + 1) + ': ' + problem; return; }
        r.total.textContent = money(line);
        r.final.textContent = money(line + t);
        total += line + t;
        items.push({ description: v[0], unit: v[1], quantity: q.text, unit_price: Number(p), tax: Number(t), discount: Number(d) });
      });
      sumNumber.textContent = money(total) + ' ریال';
      sumWords.textContent = rialWords(total);
      addItemBtn.disabled = itemRows.length >= MAX_ITEMS;
      return { items: items, error: error };
    }

    function downloadInvoice() {
      var r = recalc(), d = invPicker.get(), body = {}, form;
      if (r.error) { invMsg.textContent = r.error; invMsg.className = 'msg error'; return; }
      invMsg.textContent = ''; invMsg.className = 'msg';
      Object.keys(invInputs).forEach(function (k) { body[k] = invInputs[k].value; });
      body.number = invNumber.value;
      body.date = d.jy + '/' + String(100 + d.jm).slice(1) + '/' + String(100 + d.jd).slice(1);
      body.items = r.items;
      body.payment = invPayment.value;
      body.sheba = invSheba.value;
      /* A plain form post: it has no size limit like a link and downloads the same way as the other buttons. */
      form = h('form', { method: 'post', action: '/api/shahran/export/invoice', target: 'invoice_download', hidden: '' },
        h('input', { type: 'hidden', name: 'data', value: JSON.stringify(body) }));
      container.append(form);
      form.submit();
      form.remove();
    }

    var invoicePanel = h('div', { class: 'panel' },
      h('section', { class: 'card' }, h('h2', { text: 'فروش کالا و خدمات' }), h('div', { class: 'fields' }, field('شماره', invNumber), invPicker.node)),
      h('section', { class: 'card' }, h('h2', { text: 'مشخصات پیمانکار' }), invBox(CONTRACTOR_FIELDS)),
      h('section', { class: 'card' }, h('h2', { text: 'مشخصات کارفرما' }), invBox(EMPLOYER_FIELDS)),
      h('section', { class: 'card' }, h('h2', { text: 'مشخصات کالا یا خدمات مورد معامله' }),
        h('div', { class: 'scroll' }, h('table', { class: 'items' }, h('thead', {}, h('tr', {}, ...ITEM_HEADS.map(th))), itemsBody)),
        h('div', { class: 'actions' }, addItemBtn),
        h('div', { class: 'sum' }, h('div', {}, 'جمع کل: ', sumNumber), sumWords)),
      h('section', { class: 'card' },
        h('div', { class: 'fields' }, field('شرایط و نحوه فروش', invPayment), field('شماره شبا', invSheba, 'wide')),
        invMsg,
        h('div', { class: 'actions' }, h('button', { type: 'button', text: 'دانلود Excel', onclick: downloadInvoice }))),
      invFrame);
    addItem();

    /* ---- loading ---- */
    async function load() {
      if (tab === 'invoice') { seq += 1; return; }   // nothing to fetch: everything on this tab is typed
      var mine = ++seq, rg = J.monthRange(shown.jy, shown.jm), q = '?from=' + rg.from + '&to=' + rg.to;
      var calls = tab === 'workers' ? [api('GET', '/workers')]
        : tab === 'sheet' ? [api('GET', '/workers'), api('GET', '/time-sheet' + q)]
        : tab === 'agg' ? [api('GET', '/aggregated-work' + q)]
        : tab === 'att' ? [api('GET', '/attendance' + q + '&role=' + attRole.value)]
        : [api('GET', '/monthly-salary?year=' + shown.jy + '&month=' + shown.jm)];
      var res = await Promise.all(calls);
      if (mine !== seq) return;
      var bad = res.filter(function (r) { return !r.ok; })[0];
      if (bad) return say(errorText(bad), false);
      if (tab === 'workers') { workers = res[0].data; renderWorkers(workers); }
      else if (tab === 'sheet') { workers = res[0].data; add.setWorkers(workers); renderSheet(res[1].data); }
      else if (tab === 'agg') renderAgg(res[0].data);
      else if (tab === 'att') renderAtt(res[0].data);
      else renderPay(res[0].data);
    }

    /* ---- export: downloads the displayed month of one table as .xlsx or .csv ---- */
    function exportButton(table, format, label, extra) {
      return h('button', { type: 'button', class: 'secondary', text: label, onclick: function () {
        var rg = J.monthRange(shown.jy, shown.jm);
        root.location.href = '/api/shahran/export/' + table + '?from=' + rg.from + '&to=' + rg.to + '&format=' + format +
          (table === 'attendance' ? '&role=' + attRole.value : '') + (extra && format === 'xlsx' ? extra() : '');
      } });
    }

    /* The letter text for the aggregated Excel file: typed here, sent with the download. */
    var lDate = textInput('letter_date');
    var lTo = textInput('letter_to');
    var lBody = h('textarea', { name: 'letter_body', rows: '2' });
    lDate.value = J.fa(today.jy + '/' + String(100 + today.jm).slice(1) + '/' + String(100 + today.jd).slice(1));
    lTo.value = LETTER_TO;
    lBody.value = LETTER_BODY;
    var letterFields = h('div', { class: 'fields letter' }, field('تاریخ نامه', lDate), field('گیرنده نامه', lTo, 'wide'), field('متن نامه', lBody, 'wide'));
    function letterQuery() {
      return '&letter_date=' + encodeURIComponent(lDate.value) + '&letter_to=' + encodeURIComponent(lTo.value) +
        '&letter_body=' + encodeURIComponent(lBody.value);
    }

    /* ---- tabs and page ---- */
    function section(title, body, table, letter, top) {
      return h('section', { class: 'card' }, h('h2', { text: title }), letter ? letterFields : null, top,
        table ? h('div', { class: 'export' }, exportButton(table, 'xlsx', 'دانلود Excel', letter && letterQuery), exportButton(table, 'csv', 'دانلود CSV')) : null,
        body);
    }
    var panels = {
      sheet: h('div', { class: 'panel' }, sheetForm, section('کارکرد روزانهٔ ثبت‌شده', sheetBox, 'time-sheet')),
      agg: h('div', { class: 'panel' }, section('کارکرد تجمیعی ماهانه', aggBox, 'aggregated-work', true)),
      pay: h('div', { class: 'panel' }, section('حقوق ماهانه', payBox)),
      workers: h('div', { class: 'panel' }, workerForm, section('کارگران', workersBox)),
      att: h('div', { class: 'panel' }, section('حضور و غیاب ماهانه', attBox, 'attendance', false, h('div', { class: 'fields att-role' }, field('سمت', attRole)))),
      invoice: invoicePanel
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
      monthPicker.hidden = key === 'workers' || key === 'invoice';
      msg.textContent = ''; msg.className = 'msg';
      return load();
    }

    container.replaceChildren(
      h('section', { class: 'page-head' },
        h('div', { class: 'wrap head-row' },
          h('div', {}, h('p', { class: 'eyebrow', text: 'کارکرد روزانهٔ کارگران' }), h('h2', { text: 'پروژه شهران' })),
          monthPicker)),
      h('div', { class: 'wrap stack' }, tabBar, msg, panels.sheet, panels.agg, panels.pay, panels.workers, panels.att, panels.invoice),
      dlg
    );
    return setTab('sheet');
  }

  root.ShahranView = { mount: mount };
})(this);
