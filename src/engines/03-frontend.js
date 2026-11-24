'use strict';

// ENGINE 03 — Frontend Coding.
// Writes the real project files for the generated site: index.html, a stylesheet,
// a hash-routed app script, and a content file driven by the design layout.
// All user-provided text is inserted with textContent, never innerHTML.

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sampleItems(category, n = 3) {
  const names = {
    ecommerce: ['Featured product', 'Best seller', 'New arrival'],
    'railway-booking': ['Express route', 'Night train', 'Premium class'],
    streaming: ['Trending now', 'Top picks', 'New releases'],
    saas: ['Automation', 'Analytics', 'Team tools'],
  };
  const list = names[category] || ['Our service', 'Our approach', 'Our promise'];
  return Array.from({ length: n }, (_, i) => ({ title: list[i % list.length], text: 'Edit this text in assets/content.js to describe this item.' }));
}

function sectionFor(type, page, design, spec) {
  switch (type) {
    case 'hero':
      return { type, eyebrow: spec.category.replace(/-/g, ' '), title: `${design.appName}: ${page.title}`, text: 'Replace this headline with your message.', cta: { label: 'Get started', path: '/' } };
    case 'card-grid':
      return { type, title: 'Highlights', items: sampleItems(spec.category) };
    case 'stats':
      return { type, title: 'At a glance', items: [{ title: '10k+', text: 'Happy users' }, { title: '99.9%', text: 'Uptime' }, { title: '24/7', text: 'Support' }] };
    case 'pricing-table':
      return { type, title: 'Plans', items: [{ title: 'Basic', text: 'Get started', price: '₹199' }, { title: 'Pro', text: 'For growing teams', price: '₹999' }] };
    case 'testimonials':
      return { type, title: 'What people say', items: [{ title: 'Happy customer', text: '"It made our work simple."' }] };
    case 'form':
      return { type, title: page.title, fields: page.id === 'login' ? ['email', 'password'] : ['name', 'email', 'message'], submitLabel: 'Submit' };
    case 'table':
      return { type, title: 'Overview', columns: ['Item', 'Status'], rows: [['Sample', 'Active'], ['Sample two', 'Pending']] };
    case 'faq':
      return { type, title: 'Questions', items: [{ title: 'How does it work?', text: 'Explain the answer here.' }] };
    case 'gallery':
      return { type, title: 'Gallery', items: [{ title: 'Image one', text: 'Add your image' }, { title: 'Image two', text: 'Add your image' }] };
    case 'text':
      return { type, title: `About ${design.appName}`, text: 'Write a short description of your business here.' };
    case 'footer-cta':
      return { type: 'cta', title: 'Ready to start?', cta: { label: 'Contact us', path: '/contact' } };
    default:
      return { type: 'text', title: page.title, text: 'Content coming soon.' };
  }
}

function buildContent(design, spec) {
  const pages = {};
  for (const page of design.pages) {
    pages[page.id] = {
      title: page.title,
      path: page.path,
      sections: page.sections.map((s) => sectionFor(s, page, design, spec)),
    };
  }
  return { appName: design.appName, nav: design.layout.header.items, footer: design.layout.footer, pages };
}

function indexHtml(design) {
  const p = design.palette;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(design.appName)}</title>
  <link rel="stylesheet" href="assets/styles.css">
  <style>:root{--primary:${p.primary};--primary-text:${p.primaryText};--accent:${p.accent};--bg:${p.background};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--border:${p.border};--primary-soft:${p.primarySoft};}</style>
</head>
<body>
  <header class="site-header"><a class="brand" href="#/">${esc(design.appName)}</a><nav id="nav" aria-label="Main"></nav></header>
  <main id="app" tabindex="-1"></main>
  <footer class="site-footer" id="footer"></footer>
  <script src="assets/content.js"></script>
  <script src="assets/app.js"></script>
</body>
</html>
`;
}

function stylesCss(design) {
  return `*{box-sizing:border-box}
body{margin:0;font-family:${design.typography.body};background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--primary)}
.site-header{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:14px 24px;background:var(--surface);border-bottom:1px solid var(--border)}
.brand{font-weight:800;text-decoration:none;color:var(--text)}
nav a{margin-left:16px;text-decoration:none;color:var(--muted)}
nav a.active,nav a:hover{color:var(--primary)}
main{max-width:1100px;margin:0 auto;padding:32px 20px;min-height:70vh}
.eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:.8rem;color:var(--accent);font-weight:700}
.hero h1{font-family:${design.typography.heading};font-size:${design.typography.scale.hero};margin:.2em 0}
.btn{display:inline-block;margin-top:12px;padding:12px 20px;border-radius:${design.tokens.radius};background:var(--primary);color:var(--primary-text);text-decoration:none;font-weight:600;border:0;cursor:pointer}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:${design.tokens.radius};padding:20px;box-shadow:${design.tokens.shadow}}
.card .price{font-size:1.5rem;font-weight:800;color:var(--primary)}
.section{margin:40px 0}
form{display:grid;gap:12px;max-width:440px}
input,textarea{padding:12px;border:1px solid var(--border);border-radius:10px;font:inherit;background:var(--surface);color:var(--text)}
table{width:100%;border-collapse:collapse;background:var(--surface)}
th,td{text-align:left;padding:10px;border-bottom:1px solid var(--border)}
.site-footer{text-align:center;padding:24px;color:var(--muted);border-top:1px solid var(--border)}
.msg{margin-top:12px;color:var(--accent)}
${(design.animations || []).length ? '.card,.hero{animation:fadeUp .6s ease both}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}' : ''}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media (max-width:640px){nav a{margin-left:10px}.hero h1{font-size:2rem}}
`;
}

function contentJs(content) {
  return `// Site content. Edit this file to change text, sections and navigation.\nwindow.SITE = ${JSON.stringify(content, null, 2)};\n`;
}

function appJs() {
  return `(function () {
  'use strict';
  var site = window.SITE;
  var nav = document.getElementById('nav');
  var app = document.getElementById('app');
  var footer = document.getElementById('footer');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderNav(active) {
    nav.textContent = '';
    site.nav.forEach(function (item) {
      var a = el('a', item.path === active ? 'active' : '', item.label);
      a.href = '#' + item.path;
      nav.appendChild(a);
    });
  }

  function renderSection(section) {
    var wrap = el('section', 'section ' + section.type);
    if (section.type === 'hero') wrap.classList.add('hero');
    if (section.eyebrow) wrap.appendChild(el('div', 'eyebrow', section.eyebrow));
    if (section.title) wrap.appendChild(el(section.type === 'hero' ? 'h1' : 'h2', '', section.title));
    if (section.text) wrap.appendChild(el('p', '', section.text));
    if (section.items) {
      var grid = el('div', section.type === 'table' ? '' : 'grid');
      section.items.forEach(function (item) {
        var card = el('div', 'card');
        card.appendChild(el('h3', '', item.title));
        if (item.price) card.appendChild(el('div', 'price', item.price));
        if (item.text) card.appendChild(el('p', '', item.text));
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }
    if (section.rows) {
      var table = el('table');
      var head = el('tr');
      section.columns.forEach(function (c) { head.appendChild(el('th', '', c)); });
      table.appendChild(head);
      section.rows.forEach(function (row) {
        var tr = el('tr');
        row.forEach(function (cell) { tr.appendChild(el('td', '', cell)); });
        table.appendChild(tr);
      });
      wrap.appendChild(table);
    }
    if (section.fields) {
      var form = el('form');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = el('div', 'msg', 'Thanks! Connect this form to your backend endpoint.');
        form.appendChild(msg);
      });
      section.fields.forEach(function (name) {
        var input = name === 'message' ? el('textarea') : el('input');
        input.name = name;
        input.placeholder = name.charAt(0).toUpperCase() + name.slice(1);
        input.required = true;
        if (name === 'email') input.type = 'email';
        if (name === 'password') input.type = 'password';
        form.appendChild(input);
      });
      form.appendChild(el('button', 'btn', section.submitLabel || 'Submit')).type = 'submit';
      wrap.appendChild(form);
    }
    if (section.cta) {
      var link = el('a', 'btn', section.cta.label);
      link.href = '#' + section.cta.path;
      wrap.appendChild(link);
    }
    return wrap;
  }

  function render() {
    var path = window.location.hash.replace(/^#/, '') || '/';
    var page = site.pages[path === '/' ? 'home' : path.replace(/^\\//, '')] || site.pages.home;
    var activePath = page === site.pages.home ? '/' : page.path;
    document.title = page.title + ' · ' + site.appName;
    renderNav(activePath);
    app.textContent = '';
    page.sections.forEach(function (s) { app.appendChild(renderSection(s)); });
    footer.textContent = site.footer.copyright;
    app.focus();
  }

  window.addEventListener('hashchange', render);
  render();
})();
`;
}

function generate(design, spec) {
  const content = buildContent(design, spec);
  return {
    'index.html': indexHtml(design),
    'assets/styles.css': stylesCss(design),
    'assets/content.js': contentJs(content),
    'assets/app.js': appJs(),
  };
}

module.exports = { generate, buildContent };
