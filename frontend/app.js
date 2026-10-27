/* Project selector. Each project registers a view with mount(container) in VIEWS. */
(function () {
  'use strict';
  var VIEWS = { qaem: window.QaemView, shahran: window.ShahranView };
  var app = document.getElementById('app');
  var back = document.getElementById('back');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function wrap(child) { var w = el('div', 'wrap'); w.append(child); return w; }

  async function showProjects() {
    back.hidden = true;
    var projects;
    try {
      var res = await fetch('/api/projects');
      if (!res.ok) throw new Error(res.status);
      projects = await res.json();
    } catch (e) {
      app.replaceChildren(wrap(el('p', 'msg error', 'ارتباط با سرور برقرار نشد.')));
      return;
    }

    var grid = el('div', 'projects');
    projects.forEach(function (p) {
      var b = el('button', 'project-card');
      b.type = 'button';
      b.dataset.project = p.id;
      b.append(el('span', 'pc-title', p.title), el('span', 'pc-desc', p.description || ''));
      if (p.active && VIEWS[p.id]) {
        b.append(el('span', 'pc-go', 'ورود ←'));
        b.addEventListener('click', function () { open(p.id); });
      } else {
        b.disabled = true;
        b.append(el('span', 'pc-soon', 'به‌زودی'));
      }
      grid.append(b);
    });

    var hero = el('section', 'hero');
    var inner = el('div', 'wrap');
    inner.append(el('p', 'eyebrow', 'پروژه‌ها'), el('h2', '', 'یک پروژه را انتخاب کنید'),
      el('p', 'lead', 'اطلاعات هر پروژه را ثبت و پیگیری کنید.'));
    hero.append(inner);
    app.replaceChildren(hero, wrap(grid));
  }

  function open(id) {
    back.hidden = false;
    VIEWS[id].mount(app);
  }

  back.addEventListener('click', showProjects);
  showProjects();
})();