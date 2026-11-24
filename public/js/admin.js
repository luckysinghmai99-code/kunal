// Admin dashboard: stats, users, manual token grants, package configuration.
(function () {
  'use strict';
  var RD = window.RD;
  var $ = RD.$, el = RD.el, api = RD.api, toast = RD.toast;

  async function load() {
    var stats = await api('GET', '/api/admin/stats');
    var box = $('#admin-stats');
    box.innerHTML = '';
    [['Users', stats.users], ['Projects', stats.projects], ['Jobs failed', stats.jobsFailed], ['Revenue (₹)', stats.revenueInr], ['Tokens in circulation', stats.tokensInCirculation], ['Tokens used', stats.tokensUsed]].forEach(function (p) {
      var c = el('div', { class: 'card' });
      c.appendChild(el('div', { class: 'label' }, p[0]));
      c.appendChild(el('div', { class: 'stat' }, Number(p[1]).toLocaleString('en-IN')));
      box.appendChild(c);
    });
    var users = await api('GET', '/api/admin/users');
    var tbody = $('#users-table tbody');
    tbody.innerHTML = '';
    users.users.forEach(function (u) {
      var tr = el('tr');
      [u.id, u.email, u.role, u.balance, u.reserved].forEach(function (v) { tr.appendChild(el('td', null, v)); });
      tbody.appendChild(tr);
    });
    var packages = await api('GET', '/api/packages');
    $('#packages-json').value = JSON.stringify(packages.packages.map(function (p) {
      return { id: p.id, name: p.name, priceInr: p.priceInr, tokens: p.tokens, bonusTokens: p.bonusTokens, discountPercent: p.discountPercent, active: true };
    }), null, 2);
  }

  RD.admin = async function () {
    var user = await RD.requireAuth();
    if (!user) return;
    if (user.role !== 'admin') {
      document.querySelector('main').textContent = 'Admin access required.';
      return;
    }
    $('#grant-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var f = e.target;
      var msg = $('#grant-msg');
      try {
        var res = await api('POST', '/api/admin/users/' + encodeURIComponent(f.userId.value.trim()) + '/grant', {
          amount: f.amount.value, reason: f.reason.value,
        });
        msg.textContent = 'Granted. New available balance: ' + res.available;
        msg.className = 'form-msg ok';
        load();
      } catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; }
    });
    $('#save-packages').addEventListener('click', async function () {
      var msg = $('#packages-msg');
      try {
        var list = JSON.parse($('#packages-json').value);
        await api('PUT', '/api/admin/packages', { packages: list });
        msg.textContent = 'Saved.'; msg.className = 'form-msg ok';
      } catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; toast(err.message, true); }
    });
    load();
  };
})();
