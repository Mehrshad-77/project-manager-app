/* Shared card: حساب مالی صورت وضعیت های نهایی شده. Used by every project page (qaem, shahran, ...).
   Everything is typed here and never stored; the server (app/statement.py) turns it into the Excel file. */
(function (root) {
  'use strict';
  var J = root.Jalali;
  var MONEY_MAX = 10000000000000n;   // same limit as app/statement.py
  var TITLE = 'حساب مالی صورت وضعیت های نهایی شده';
  var BOX = 'کسورات صورت وضعیت';
  /* [key sent to the server, title, kind]; 'text' boxes hold words, 'money' boxes hold rials, 'sub' rows sit beside the box. */
  var ROWS = [['send_date', 'تاریخ ارسال', 'text', 30], ['title', 'عنوان صورت وضعیت', 'text', 300], ['gross', 'مبلغ ناخالص صورت وضعیت', 'money'],
    ['retention', 'حسن انجام کار', 'sub'], ['goods', 'خدمات و کالا', 'sub'], ['food', 'غذا', 'sub'],
    ['deductions', 'مجموع کسورات', 'money'], ['net_payable', 'مبلغ خالص قابل پرداخت صورت وضعیت', 'money'],
    ['net_salaries', 'مبلغ خالص حقوق و مزایای پرسنل', 'money'], ['net_services', 'مبلغ خالص خدمات و هزینه‌های جانبی', 'money'],
    ['net_remaining', 'مبلغ خالص مانده پیمانکار', 'money']];
  var count = 0;

  function el(tag, props) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') e.textContent = props[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    for (var i = 2; i < arguments.length; i += 1) if (arguments[i] != null) e.append(arguments[i]);
    return e;
  }
  function input(name, label, mode, max) {
    return el('input', { name: name, type: 'text', autocomplete: 'off', inputmode: mode, 'aria-label': label, maxlength: max });
  }
  /* '' -> null (empty box); '۱٬۴۱۸٬۰۰۰' -> 1418000; anything else -> NaN. */
  function amount(text) {
    var s = J.en(text).replace(/[٬,\s]/g, '');
    if (!s) return null;
    return /^\d+$/.test(s) && BigInt(s) <= MONEY_MAX ? Number(s) : NaN;
  }

  function create() {
    var id = ++count, boxes = {}, notes = {};
    var msg = el('p', { class: 'msg', role: 'alert' });
    var frame = el('iframe', { name: 'statement_download_' + id, title: 'دانلود', hidden: '' });   // the download lands here, so the page stays
    var body = el('tbody');
    var card = el('section', { class: 'card' });

    ROWS.forEach(function (r) {
      var key = r[0], money = r[2] !== 'text', tr = el('tr');
      boxes[key] = input('statement_' + key, r[1], money ? 'numeric' : 'text', r[3]);
      notes[key] = input('statement_note_' + key, 'توضیحات ' + r[1], 'text', 300);
      if (r[2] === 'sub') {
        if (key === 'retention') tr.append(el('th', { text: BOX, rowspan: '3' }));
        tr.append(el('th', { text: r[1] }));
      } else {
        tr.append(el('th', { text: r[1], colspan: '2' }));
      }
      tr.append(el('td', {}, boxes[key]), el('td', {}, notes[key]));
      body.append(tr);
    });
    var t = J.todayJalali();
    boxes.send_date.value = J.fa(t.jy + '/' + String(100 + t.jm).slice(1) + '/' + String(100 + t.jd).slice(1));

    function download() {
      var data = { send_date: boxes.send_date.value, title: boxes.title.value, amounts: {}, notes: {} }, bad = '', form;
      ROWS.forEach(function (r) {
        var n = notes[r[0]].value.trim(), v;
        if (n) data.notes[r[0]] = n;
        if (r[2] === 'text') return;
        v = amount(boxes[r[0]].value);
        if (v !== v) bad = bad || 'مبلغ «' + r[1] + '» باید یک عدد صحیح صفر یا بیشتر (و کمتر از حد مجاز) باشد.';
        else if (v !== null) data.amounts[r[0]] = v;
      });
      msg.textContent = bad; msg.className = bad ? 'msg error' : 'msg';
      if (bad) return;
      /* A plain form post, like the invoice: it downloads the same way as the other buttons and leaves this page alone. */
      form = el('form', { method: 'post', action: '/api/statement/export', target: 'statement_download_' + id, hidden: '' },
        el('input', { type: 'hidden', name: 'data', value: JSON.stringify(data) }));
      card.append(form);
      form.submit();
      form.remove();
    }

    card.append(
      el('div', { class: 'stmt-wrap' }, el('table', { class: 'stmt' },
        el('colgroup', {}, el('col', { style: 'width:22%' }), el('col', { style: 'width:20%' }), el('col', { style: 'width:30%' }), el('col', { style: 'width:28%' })),
        el('thead', {}, el('tr', {}, el('th', { text: TITLE, colspan: '4' })), el('tr', {}, el('th', { colspan: '3' }), el('th', { text: 'توضیحات' }))),
        body)),
      msg,
      el('div', { class: 'actions' }, el('button', { type: 'button', text: 'دانلود Excel', onclick: download })),
      frame);
    return card;
  }

  root.StatementCard = { create: create };
})(this);
