// Shared UI: API client, theme, shell (header/footer), train background, forms, toasts.
(function () {
  'use strict';

  var LOGO = '<svg viewBox="0 0 64 40" aria-hidden="true"><defs><linearGradient id="rdg" x1="0" x2="1"><stop offset="0" stop-color="#6d5dfc"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><path d="M32 20C22 4 4 4 4 20s18 16 28 0 26-16 28 0-18 16-28 0z" fill="none" stroke="url(#rdg)" stroke-width="5" stroke-linecap="round"/><rect x="26" y="16" width="12" height="8" rx="2" fill="url(#rdg)"/></svg>';

  var TRAIN_SVG = '<svg viewBox="0 0 800 400" aria-hidden="true">' +
    '<path id="rd-track" class="track" d="M400 200 C300 50 100 50 100 200 C100 350 300 350 400 200 C500 50 700 50 700 200 C700 350 500 350 400 200 Z"/>' +
    '<g><rect class="train-glow" x="-16" y="-8" width="32" height="16" rx="8"/><rect class="train-car" x="-12" y="-6" width="24" height="12" rx="4"/>' +
    '<animateMotion dur="18s" repeatCount="indefinite" rotate="auto"><mpath href="#rd-track"/></animateMotion></g></svg>';

  var PAGE_LINKS = [
    { href: '/features', label: 'Features' }, { href: '/studio', label: 'AI Design Studio' },
    { href: '/templates', label: 'Templates' }, { href: '/pricing', label: 'Pricing' },
    { href: '/about', label: 'About' }, { href: '/contact', label: 'Contact' },
  ];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  // ---- Theme
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
  }
  function initTheme() {
    applyTheme(localStorage.getItem('rd-theme'));
  }
  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var isDark = current === 'dark' || (!current && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = isDark ? 'light' : 'dark';
    localStorage.setItem('rd-theme', next);
    applyTheme(next);
  }

  // ---- Toasts
  function toast(message, isError) {
    var wrap = $('.toast-wrap') || document.body.appendChild(el('div', { class: 'toast-wrap', 'aria-live': 'polite' }));
    var t = el('div', { class: 'toast' + (isError ? ' error' : '') }, message);
    wrap.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  // ---- API client (JSON, cookie session, errors normalised)
  async function api(method, url, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(url, opts);
    var data = null;
    var type = res.headers.get('content-type') || '';
    if (type.indexOf('application/json') !== -1) data = await res.json();
    if (!res.ok) {
      var err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  var currentUser = null;
  async function me() {
    try {
      var data = await api('GET', '/api/me');
      currentUser = data.user;
      return currentUser;
    } catch (e) {
      currentUser = null;
      return null;
    }
  }

  // ---- Shell
  function renderShell() {
    var header = $('#site-header');
    if (header) {
      var inner = el('div', { class: 'inner' });
      var brand = el('a', { class: 'brand', href: '/' });
      brand.innerHTML = LOGO + '<span>RAILDESIGN AI</span>';
      inner.appendChild(brand);
      var nav = el('nav', { class: 'nav-links', 'aria-label': 'Main' });
      PAGE_LINKS.forEach(function (l) {
        var a = el('a', { href: l.href }, l.label);
        if (window.location.pathname === l.href) a.className = 'active';
        nav.appendChild(a);
      });
      inner.appendChild(nav);
      inner.appendChild(el('span', { class: 'spacer' }));
      var right = el('div', { class: 'row', id: 'auth-links' });
      inner.appendChild(right);
      inner.appendChild(el('button', { class: 'icon-btn', type: 'button', id: 'theme-toggle', title: 'Toggle theme', 'aria-label': 'Toggle theme' }, '◐'));
      header.appendChild(inner);
      $('#theme-toggle').addEventListener('click', toggleTheme);
    }
    var footer = $('#site-footer');
    if (footer) {
      footer.innerHTML = '';
      footer.className = 'site-footer';
      var fin = el('div', { class: 'inner' });
      fin.appendChild(el('span', null, '© ' + new Date().getFullYear() + ' RAILDESIGN AI'));
      var links = el('span');
      [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/contact', 'Contact']].forEach(function (p) {
        links.appendChild(el('a', { href: p[0] }, p[1]));
      });
      fin.appendChild(links);
      footer.appendChild(fin);
    }
    if (!$('.train-bg')) {
      var bg = el('div', { class: 'train-bg' });
      bg.innerHTML = TRAIN_SVG;
      document.body.insertBefore(bg, document.body.firstChild);
      var svg = bg.querySelector('svg');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && svg.pauseAnimations) svg.pauseAnimations();
    }
  }

  async function renderAuthLinks() {
    var box = $('#auth-links');
    if (!box) return;
    var user = await me();
    box.innerHTML = '';
    if (user) {
      box.appendChild(el('a', { class: 'btn small', href: '/dashboard' }, 'Dashboard'));
      if (user.role === 'admin') box.appendChild(el('a', { class: 'btn small', href: '/admin' }, 'Admin'));
      var out = el('button', { class: 'btn small ghost', type: 'button' }, 'Log out');
      out.addEventListener('click', async function () {
        try { await api('POST', '/api/auth/logout', {}); } catch (e) { /* ignore */ }
        window.location.href = '/';
      });
      box.appendChild(out);
    } else {
      box.appendChild(el('a', { class: 'btn small ghost', href: '/login' }, 'Log in'));
      box.appendChild(el('a', { class: 'btn small primary', href: '/signup' }, 'Start free'));
    }
  }

  async function requireAuth() {
    var user = await me();
    if (!user) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return null;
    }
    return user;
  }

  // ---- Generic form handler: <form data-api="/api/x" data-method="POST" data-redirect="/dashboard">
  function bindForms() {
    $all('form[data-api]').forEach(function (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var msg = $('.form-msg', form);
        var button = $('button[type=submit]', form);
        var payload = {};
        new FormData(form).forEach(function (v, k) { payload[k] = v; });
        if (button) button.disabled = true;
        if (msg) { msg.textContent = 'Please wait…'; msg.className = 'form-msg'; }
        try {
          var data = await api(form.getAttribute('data-method') || 'POST', form.getAttribute('data-api'), payload);
          if (msg) { msg.textContent = form.getAttribute('data-success') || (data && data.message) || 'Done.'; msg.className = 'form-msg ok'; }
          form.reset();
          var redirect = form.getAttribute('data-redirect');
          if (redirect) {
            var next = new URLSearchParams(window.location.search).get('next');
            window.location.href = next && next.charAt(0) === '/' && next.charAt(1) !== '/' ? next : redirect;
          }
        } catch (err) {
          if (msg) { msg.textContent = err.message; msg.className = 'form-msg error'; }
          else toast(err.message, true);
        } finally {
          if (button) button.disabled = false;
        }
      });
    });
  }

  // ---- Packages (pricing page, homepage preview, dashboard)
  async function renderPackages(container, opts) {
    opts = opts || {};
    try {
      var data = await api('GET', '/api/packages');
      container.innerHTML = '';
      data.packages.forEach(function (p, i) {
        var card = el('div', { class: 'card price-card' + (i === 2 ? ' featured' : '') });
        card.appendChild(el('h3', null, p.name));
        card.appendChild(el('div', { class: 'price' }, '₹' + p.payableInr.toLocaleString('en-IN')));
        var sub = p.discountPercent ? ' · ' + p.discountPercent + '% off' : '';
        card.appendChild(el('p', null, p.totalTokens + ' tokens' + (p.bonusTokens ? ' (incl. ' + p.bonusTokens + ' bonus)' : '') + sub));
        if (opts.buy) {
          var b = el('button', { class: 'btn primary small', type: 'button' }, 'Buy');
          b.addEventListener('click', function () { opts.buy(p, b); });
          card.appendChild(b);
        } else {
          card.appendChild(el('a', { class: 'btn small', href: '/signup' }, 'Get started'));
        }
        container.appendChild(card);
      });
      if (!data.paymentsConfigured && opts.buy) {
        container.parentNode.insertBefore(el('p', { class: 'muted' }, 'Payments are not yet connected on this server. Purchases open once Razorpay keys are configured.'), container);
      }
    } catch (err) {
      container.textContent = 'Could not load packages.';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    renderShell();
    bindForms();
    renderAuthLinks();
    var hook = document.body.getAttribute('data-page-init');
    if (hook && window.RD && typeof window.RD[hook] === 'function') window.RD[hook]();
  });

  window.RD = window.RD || {};
  window.RD.api = api;
  window.RD.$ = $;
  window.RD.$all = $all;
  window.RD.el = el;
  window.RD.toast = toast;
  window.RD.requireAuth = requireAuth;
  window.RD.renderPackages = renderPackages;
  window.RD.me = me;
  window.RD.getUser = function () { return currentUser; };
  window.RD.logo = LOGO;
})();
