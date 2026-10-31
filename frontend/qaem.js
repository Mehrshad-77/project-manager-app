/* qaem project view: add rows, edit them in a pop-up, delete, and show totals (Farsi UI, Solar dates). */
(function (root) {
  'use strict';
  var J = root.Jalali;
  var MIN_YEAR = 1400;
  var INT_MAX = 2147483647;

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
      res = await fetch('/api/qaem' + path, {
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

  function errorText(r) {
    if (r.status === 0) return 'ارتباط با سرور برقرار نشد.';
    if (r.status === 409) return 'برای این کامیون در این تاریخ قبلاً ردیفی ثبت شده است.';
    if (r.status === 404) return 'این ردیف پیدا نشد؛ شاید قبلاً حذف شده باشد.';
    if (r.status === 422) {
      return JSON.stringify(r.data).indexOf('future') >= 0 ? 'تاریخ نمی‌تواند در آینده باشد.' : 'اطلاعات واردشده معتبر نیست.';
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
  function field(label, control) { return h('label', { class: 'field' }, h('span', { text: label }), control); }
  function numberInput(name) { return h('input', { name: name, type: 'text', inputmode: 'numeric', autocomplete: 'off', required: '' }); }

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

  /* Validate what the person typed/picked; returns {error} or {row, jy, jm}. */
  function readRow(truckEl, countEl, picker, today) {
    var t = J.en(truckEl.value).trim(), c = J.en(countEl.value).trim(), d = picker.get();
    if (!/^\d+$/.test(t) || +t < 1 || +t > INT_MAX) return { error: 'شماره کامیون باید یک عدد صحیح مثبت باشد.' };
    if (!/^\d+$/.test(c) || +c > INT_MAX) return { error: 'تعداد سرویس باید یک عدد صحیح صفر یا بیشتر باشد.' };
    if (d.jy > today.jy || (d.jy === today.jy && (d.jm > today.jm || (d.jm === today.jm && d.jd > today.jd)))) {
      return { error: 'تاریخ نمی‌تواند برای آینده باشد.' };
    }
    return {
      row: { service_day: J.iso(J.toGregorian(d.jy, d.jm, d.jd)), truck_id: +t, truck_service_count: +c },
      jy: d.jy, jm: d.jm
    };
  }

  function mount(container) {
    var today = J.todayJalali();
    var shown = { jy: today.jy, jm: today.jm };
    var editing = null;          // the row being edited in the pop-up
    var seq = 0;

    /* ---- month being displayed ---- */
    var vMonth = h('select', { name: 'view_month', 'aria-label': 'ماه' });
    var vYear = h('select', { name: 'view_year', 'aria-label': 'سال' });
    fillSelect(vMonth, monthItems(), shown.jm);
    fillSelect(vYear, yearItems(MIN_YEAR, Math.max(MIN_YEAR, today.jy)), shown.jy);
    function onViewChange() { shown = { jy: +vYear.value, jm: +vMonth.value }; load(); }
    vMonth.addEventListener('change', onViewChange);
    vYear.addEventListener('change', onViewChange);
    function showMonth(jy, jm) { shown = { jy: jy, jm: jm }; vYear.value = jy; vMonth.value = jm; }

    /* ---- add form ---- */
    var truck = numberInput('truck_id');
    var count = numberInput('truck_service_count');
    var picker = datePicker(today, '');
    var submitBtn = h('button', { type: 'submit', text: 'افزودن' });
    var msg = h('p', { class: 'msg', role: 'status' });
    function say(text, ok) { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'error'); }

    var form = h('form', { novalidate: '', class: 'card' },
      h('h2', { text: 'افزودن ردیف' }),
      h('div', { class: 'fields' }, field('شماره کامیون', truck), picker.node, field('تعداد سرویس', count)),
      h('div', { class: 'actions' }, submitBtn),
      msg
    );
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var res = readRow(truck, count, picker, today);
      if (res.error) return say(res.error, false);
      submitBtn.disabled = true;
      var r;
      try { r = await api('POST', '/services', res.row); } finally { submitBtn.disabled = false; }
      if (!r.ok) return say(errorText(r), false);
      truck.value = ''; count.value = '';
      say('ردیف افزوده شد.', true);
      showMonth(res.jy, res.jm);
      await load();
      truck.focus();
    });

    /* ---- edit pop-up ---- */
    var eTruck = numberInput('edit_truck_id');
    var eCount = numberInput('edit_truck_service_count');
    var ePicker = datePicker(today, 'edit_');
    var eSave = h('button', { type: 'submit', text: 'ذخیره تغییرات' });
    var eCancel = h('button', { type: 'button', class: 'secondary', text: 'انصراف' });
    var eMsg = h('p', { class: 'msg error', role: 'alert' });
    var dlg = h('dialog', { 'aria-label': 'ویرایش ردیف' },
      h('form', { novalidate: '' },
        h('h2', { text: 'ویرایش ردیف' }),
        h('div', { class: 'fields' }, field('شماره کامیون', eTruck), ePicker.node, field('تعداد سرویس', eCount)),
        h('div', { class: 'actions' }, eSave, eCancel),
        eMsg
      )
    );

    function openEdit(r) {
      editing = r;
      var p = r.service_day.split('-').map(Number), j = J.toJalali(p[0], p[1], p[2]);
      ePicker.set(j.jy, j.jm, j.jd);
      eTruck.value = J.fa(r.truck_id);
      eCount.value = J.fa(r.truck_service_count);
      eMsg.textContent = '';
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      eCount.focus();
    }
    function closeEdit() {
      if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
      editing = null;
    }
    eCancel.addEventListener('click', closeEdit);
    dlg.addEventListener('close', function () { editing = null; });                 // also fires on Esc
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) closeEdit(); }); // click on the backdrop

    dlg.querySelector('form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!editing) return;
      var res = readRow(eTruck, eCount, ePicker, today);
      if (res.error) { eMsg.textContent = res.error; return; }
      var changes = {};
      Object.keys(res.row).forEach(function (k) { if (res.row[k] !== editing[k]) changes[k] = res.row[k]; });
      if (!Object.keys(changes).length) { eMsg.textContent = 'تغییری ایجاد نشده است.'; return; }
      eSave.disabled = true;
      var r;
      try { r = await api('PATCH', '/services/' + editing.service_day + '/' + editing.truck_id, changes); } finally { eSave.disabled = false; }
      if (!r.ok) {
        eMsg.textContent = errorText(r);
        if (r.status === 404) load();
        return;
      }
      closeEdit();
      say('تغییرات ذخیره شد.', true);
      showMonth(res.jy, res.jm);
      load();
    });

    /* ---- summary cards ---- */
    var statsBox = h('div', { class: 'stats' });
    function stat(label, value, sub) {
      return h('div', { class: 'stat' },
        h('span', { class: 'stat-label', text: label }),
        h('strong', { class: 'stat-value', text: value }),
        h('span', { class: 'stat-sub', text: sub }));
    }
    function renderStats(totals) {
      var last = totals[totals.length - 1];
      statsBox.replaceChildren(
        stat('مجموع سرویس‌های ماه', J.fa(last ? last.month_total : 0), J.MONTHS[shown.jm - 1] + ' ' + J.fa(shown.jy)),
        stat('تعداد سرویس‌های آخرین روز ثبت‌ شده', last ? J.fa(last.day_total) : '—', last ? J.isoToJalaliText(last.service_day) : 'ردیفی ثبت نشده است')
      );
    }

    /* ---- tables ---- */
    var rowsBox = h('div', { class: 'scroll' });
    var totalsBox = h('div', { class: 'scroll' });

    async function remove(r) {
      if (!root.confirm('آیا از حذف این ردیف مطمئن هستید؟')) return;
      var res = await api('DELETE', '/services/' + r.service_day + '/' + r.truck_id);
      if (!res.ok) { say(errorText(res), false); return load(); }
      say('ردیف حذف شد.', true);
      load();
    }

    function renderRows(rows) {
      if (!rows.length) return rowsBox.replaceChildren(h('p', { class: 'empty', text: 'برای این ماه ردیفی ثبت نشده است.' }));
      var body = h('tbody');
      rows.forEach(function (r) {
        body.append(h('tr', {},
          h('td', { text: J.isoToJalaliText(r.service_day) }),
          h('td', { text: J.fa(r.truck_id) }),
          h('td', { text: J.fa(r.truck_service_count) }),
          h('td', { class: 'row-actions' },
            h('button', { type: 'button', class: 'secondary', text: 'ویرایش', onclick: function () { openEdit(r); } }),
            h('button', { type: 'button', class: 'danger', text: 'حذف', onclick: function () { remove(r); } }))
        ));
      });
      rowsBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, th('تاریخ'), th('شماره کامیون'), th('تعداد سرویس'), th(''))), body));
    }

    function renderTotals(totals) {
      if (!totals.length) return totalsBox.replaceChildren(h('p', { class: 'empty', text: 'برای این ماه جمعی وجود ندارد.' }));
      var body = h('tbody');
      totals.forEach(function (t) {
        body.append(h('tr', {},
          h('td', { text: J.isoToJalaliText(t.service_day) }),
          h('td', { text: J.fa(t.day_total) }),
          h('td', { text: J.fa(t.month_total) })
        ));
      });
      totalsBox.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, th('تاریخ'), th('تعداد سرویس'), th('مجموع سرویس‌های ماه'))), body));
    }

    async function load() {
      var mine = ++seq, rg = J.monthRange(shown.jy, shown.jm);
      var q = '?from=' + rg.from + '&to=' + rg.to;
      var res = await Promise.all([api('GET', '/services' + q), api('GET', '/totals' + q)]);
      if (mine !== seq) return;
      var bad = !res[0].ok ? res[0] : !res[1].ok ? res[1] : null;
      if (bad) return say(errorText(bad), false);
      renderRows(res[0].data);
      renderTotals(res[1].data);
      renderStats(res[1].data);
    }

    /* ---- export: downloads the displayed month of one table as .xlsx or .csv ---- */
    function exportButton(table, format, label) {
      return h('button', { type: 'button', class: 'secondary', text: label, onclick: function () {
        var rg = J.monthRange(shown.jy, shown.jm);
        root.location.href = '/api/qaem/export/' + table + '?from=' + rg.from + '&to=' + rg.to + '&format=' + format;
      } });
    }

    function section(title, body, table) {
      return h('section', { class: 'card' }, h('h2', { text: title }),
        table ? h('div', { class: 'export' }, exportButton(table, 'xlsx', 'دانلود Excel'), exportButton(table, 'csv', 'دانلود CSV')) : null,
        body);
    }

    container.replaceChildren(
      h('section', { class: 'page-head' },
        h('div', { class: 'wrap head-row' },
          h('div', {}, h('p', { class: 'eyebrow', text: 'سرویس‌های روزانهٔ کامیون‌ها' }), h('h2', { text: 'پروژه قائم' })),
          h('div', { class: 'month-picker' }, field('ماه نمایش‌داده‌شده', vMonth), field('سال', vYear)))),
      h('div', { class: 'wrap stack' }, statsBox, form, section('سرویس‌های ثبت‌شده', rowsBox, 'services'), section('مجموع سرویس‌های ', totalsBox, 'totals')),
      dlg
    );
    return load();
  }

  root.QaemView = { mount: mount };
})(this);