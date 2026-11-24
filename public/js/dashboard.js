// Dashboard: projects, AI workspace, wallet, Razorpay checkout, account.
(function () {
  'use strict';
  var RD = window.RD;
  var $ = RD.$, $all = RD.$all, el = RD.el, api = RD.api, toast = RD.toast;
  var state = { user: null, wallet: null, projects: [], current: null };

  function n(v) { return Number(v || 0).toLocaleString('en-IN'); }
  function when(s) { return s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''; }

  function walletCards(container) {
    if (!state.wallet || !container) return;
    var w = state.wallet;
    container.innerHTML = '';
    [['Available', w.available], ['Reserved', w.reserved], ['Used', w.used], ['Purchased', w.purchased]].forEach(function (p) {
      var c = el('div', { class: 'card' });
      c.appendChild(el('div', { class: 'label' }, p[0]));
      c.appendChild(el('div', { class: 'stat' }, n(p[1])));
      container.appendChild(c);
    });
  }

  function show(view) {
    $all('.view').forEach(function (v) { v.classList.add('hidden'); });
    var target = $('#view-' + view) || $('#view-overview');
    target.classList.remove('hidden');
    $all('.sidebar a[data-view]').forEach(function (a) { a.classList.toggle('active', a.dataset.view === view); });
    if (view === 'wallet') loadWallet();
  }

  async function loadWallet() {
    state.wallet = await api('GET', '/api/wallet');
    walletCards($('#wallet-strip'));
    walletCards($('#wallet-strip-2'));
    var body = $('#ledger-table tbody');
    body.innerHTML = '';
    state.wallet.ledger.forEach(function (e) {
      var tr = el('tr');
      [when(e.createdAt), e.type.replace(/_/g, ' '), (e.amount > 0 ? '+' : '') + n(e.amount), n(e.balanceAfter), e.note].forEach(function (v) {
        tr.appendChild(el('td', null, v));
      });
      body.appendChild(tr);
    });
    if (!state.wallet.ledger.length) body.appendChild(el('tr', null, '')).appendChild(el('td', { colspan: 5, class: 'muted' }, 'No transactions yet.'));
    var pays = await api('GET', '/api/payments/history');
    var pb = $('#payments-table tbody');
    pb.innerHTML = '';
    pays.orders.forEach(function (o) {
      var tr = el('tr');
      [when(o.createdAt), o.packageId, '₹' + (o.amountPaise / 100).toLocaleString('en-IN'), o.status].forEach(function (v) { tr.appendChild(el('td', null, v)); });
      pb.appendChild(tr);
    });
    if (!pays.orders.length) pb.appendChild(el('tr', null, '')).appendChild(el('td', { colspan: 4, class: 'muted' }, 'No payments yet.'));
    RD.renderPackages($('#buy-packages'), { buy: buyPackage });
  }

  var checkoutLoading = null;
  function loadCheckout() {
    if (window.Razorpay) return Promise.resolve();
    if (!checkoutLoading) {
      checkoutLoading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = resolve;
        s.onerror = function () { reject(new Error('Could not load Razorpay checkout')); };
        document.head.appendChild(s);
      });
    }
    return checkoutLoading;
  }

  async function buyPackage(pkg, btn) {
    btn.disabled = true;
    try {
      var order = await api('POST', '/api/payments/orders', { packageId: pkg.id });
      await loadCheckout();
      var rzp = new window.Razorpay({
        key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.orderId,
        name: 'RAILDESIGN AI', description: pkg.name + ' token package', theme: { color: '#6d5dfc' },
        handler: async function (r) {
          try {
            var res = await api('POST', '/api/payments/confirm', {
              orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature,
            });
            toast(res.duplicate ? 'This payment was already recorded.' : 'Tokens added to your wallet.');
            loadWallet();
          } catch (e) { toast(e.message, true); }
        },
      });
      rzp.on('payment.failed', function () { toast('Payment failed. No tokens were added.', true); });
      rzp.open();
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  async function loadProjects() {
    var data = await api('GET', '/api/projects');
    state.projects = data.projects;
    var list = $('#project-list');
    var recent = $('#recent-projects');
    list.innerHTML = '';
    recent.innerHTML = '';
    if (!state.projects.length) {
      list.appendChild(el('p', { class: 'muted' }, 'No projects yet. Create one to get started.'));
      recent.appendChild(el('p', { class: 'muted' }, 'Your recent projects appear here.'));
      return;
    }
    state.projects.forEach(function (p) {
      list.appendChild(projectItem(p));
    });
    state.projects.slice(0, 4).forEach(function (p) { recent.appendChild(projectItem(p)); });
  }

  function projectItem(p) {
    var item = el('div', { class: 'project-item' + (state.current && state.current.id === p.id ? ' active' : ''), role: 'button', tabindex: '0' });
    var left = el('div');
    left.appendChild(el('strong', null, p.name));
    left.appendChild(el('div', { class: 'muted', style: 'font-size:.82rem' }, (p.category || 'not generated yet') + ' · ' + p.fileCount + ' files · updated ' + when(p.updatedAt)));
    item.appendChild(left);
    item.appendChild(el('span', { class: 'badge' }, p.status));
    item.addEventListener('click', function () { openProject(p.id); });
    item.addEventListener('keydown', function (e) { if (e.key === 'Enter') openProject(p.id); });
    return item;
  }

  async function openProject(id) {
    location.hash = 'projects';
    show('projects');
    var project = await api('GET', '/api/projects/' + id);
    state.current = project;
    $('#workspace').classList.remove('hidden');
    $('#ws-name').textContent = project.name;
    $('#ws-estimate-out').textContent = '';
    $('#ws-prompt').value = '';
    $('#ws-progress').classList.add('hidden');
    $('#ws-resume').classList.add('hidden');
    renderFiles();
    renderVersions();
    refreshPreview();
    $('#ws-file-name').textContent = '';
    $('#ws-file-content').value = '';
    var jobs = await api('GET', '/api/projects/' + id + '/jobs');
    var failed = jobs.jobs.find(function (j) { return j.status === 'failed'; });
    if (failed) {
      $('#ws-progress').classList.remove('hidden');
      $('#ws-resume').classList.remove('hidden');
      $('#ws-resume').dataset.job = failed.id;
      renderJob(failed);
    }
    loadProjects();
  }

  function refreshPreview() {
    var frame = $('#ws-frame');
    if (!state.current || state.current.files.length === 0) {
      frame.removeAttribute('src');
      frame.srcdoc = '<p style="font-family:sans-serif;padding:24px;color:#475569">Generate this project to see a live preview.</p>';
      $('#ws-fullscreen').classList.add('hidden');
      return;
    }
    frame.removeAttribute('srcdoc');
    frame.src = '/api/projects/' + state.current.id + '/preview/index.html?v=' + Date.now();
    $('#ws-fullscreen').href = frame.src;
    $('#ws-fullscreen').classList.remove('hidden');
  }

  function renderFiles() {
    var box = $('#ws-files');
    box.innerHTML = '';
    if (!state.current.files.length) { box.textContent = 'No files yet.'; return; }
    state.current.files.forEach(function (f) {
      var row = el('div', { role: 'button', tabindex: '0', style: 'cursor:pointer;padding:3px 0' }, f.path + '  (' + f.bytes + ' B)');
      row.addEventListener('click', function () { openFile(f.path); });
      box.appendChild(row);
    });
  }

  async function openFile(path) {
    var data = await api('GET', '/api/projects/' + state.current.id + '/file?path=' + encodeURIComponent(path));
    state.pendingFile = path;
    $('#ws-file-name').textContent = path;
    $('#ws-file-content').value = data.content;
  }

  async function saveFile() {
    if (!state.pendingFile) { toast('Select a file first.', true); return; }
    try {
      await api('PUT', '/api/projects/' + state.current.id + '/file', { path: state.pendingFile, content: $('#ws-file-content').value });
      toast('File saved. Preview refreshed.');
      state.current = await api('GET', '/api/projects/' + state.current.id);
      renderFiles();
      refreshPreview();
    } catch (e) { toast(e.message, true); }
  }

  function renderVersions() {
    var box = $('#ws-versions');
    box.innerHTML = '';
    if (!state.current.versions.length) { box.textContent = 'Versions appear after your next change.'; return; }
    state.current.versions.slice(0, 10).forEach(function (v) {
      var row = el('div', { class: 'row', style: 'margin-bottom:6px' });
      row.appendChild(el('span', null, 'v' + v.number + ' · ' + when(v.createdAt)));
      var btn = el('button', { class: 'btn small', type: 'button' }, 'Restore');
      btn.addEventListener('click', async function () {
        if (!confirm('Restore version ' + v.number + '? Your current files are kept as a new version.')) return;
        try {
          await api('POST', '/api/projects/' + state.current.id + '/versions/' + v.number + '/restore', {});
          toast('Version restored.');
          openProject(state.current.id);
        } catch (e) { toast(e.message, true); }
      });
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  function renderJob(job) {
    $('#ws-progress').classList.remove('hidden');
    $('#ws-bar').style.width = job.progress + '%';
    var log = $('#ws-log');
    log.innerHTML = '';
    job.logs.forEach(function (entry) {
      log.appendChild(el('div', { class: entry.level === 'error' ? 'error' : '' }, entry.stage + ' · ' + entry.message));
    });
    if (job.status === 'completed') {
      log.appendChild(el('div', { class: 'ok' }, 'Completed. Charged ' + n(job.chargedTokens) + ' tokens.'));
    } else if (job.status === 'failed') {
      log.appendChild(el('div', { class: 'error' }, 'Stopped. Charged ' + n(job.chargedTokens) + ' tokens so far. You can resume.'));
    }
    log.scrollTop = log.scrollHeight;
  }

  async function estimate() {
    var prompt = $('#ws-prompt').value.trim();
    if (prompt.length < 3) { toast('Describe what to build first.', true); return; }
    try {
      var e = await api('POST', '/api/projects/' + state.current.id + '/estimate', { prompt: prompt });
      var note = '≈ ' + n(e.estimatedTokens) + ' tokens · available ' + n(e.balance.available) + (e.canAfford ? '' : ' (not enough)');
      $('#ws-estimate-out').textContent = note;
      if (e.missing.length) toast(e.missing[0]);
    } catch (err) { toast(err.message, true); }
  }

  async function generate() {
    var prompt = $('#ws-prompt').value.trim();
    if (prompt.length < 3) { toast('Describe what to build first.', true); return; }
    var btn = $('#ws-generate');
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      var res = await api('POST', '/api/projects/' + state.current.id + '/generate', { prompt: prompt });
      renderJob(res.job);
      $('#ws-resume').classList.toggle('hidden', res.job.status !== 'failed');
      $('#ws-resume').dataset.job = res.job.id;
      $('#ws-prompt').value = '';
      $('#ws-estimate-out').textContent = '';
      await openProject(state.current.id);
      loadWallet();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate';
    }
  }

  async function resume() {
    var id = $('#ws-resume').dataset.job;
    if (!id) return;
    try {
      var res = await api('POST', '/api/jobs/' + id + '/resume', {});
      renderJob(res.job);
      await openProject(state.current.id);
      loadWallet();
    } catch (err) { toast(err.message, true); }
  }

  async function download() {
    try {
      var res = await fetch('/api/projects/' + state.current.id + '/export', { credentials: 'same-origin' });
      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        throw new Error(body.error || 'Export failed');
      }
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: 'project.zip' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (err) { toast(err.message, true); }
  }

  async function createProject() {
    var name = $('#new-name').value.trim() || 'Untitled project';
    var prompt = $('#new-prompt').value.trim();
    var msg = $('#create-msg');
    try {
      var p = await api('POST', '/api/projects', { name: name });
      msg.textContent = 'Project created.';
      if (prompt.length >= 3) {
        var res = await api('POST', '/api/projects/' + p.id + '/generate', { prompt: prompt });
        msg.textContent = res.job.status === 'completed' ? 'Generated and tested.' : 'Generation stopped: ' + res.job.error;
      }
      $('#new-name').value = '';
      $('#new-prompt').value = '';
      await loadProjects();
      await loadWallet();
      openProject(p.id);
    } catch (err) {
      msg.textContent = err.message;
    }
  }

  function bindWorkspace() {
    $('#ws-estimate').addEventListener('click', estimate);
    $('#ws-generate').addEventListener('click', generate);
    $('#ws-resume').addEventListener('click', resume);
    $('#ws-save-file').addEventListener('click', saveFile);
    $('#ws-download').addEventListener('click', download);
    $('#ws-refresh').addEventListener('click', refreshPreview);
    $all('[data-vp]').forEach(function (b) {
      b.addEventListener('click', function () { $('#ws-frame').style.width = b.dataset.vp; });
    });
    $('#ws-rename').addEventListener('click', async function () {
      var name = window.prompt('New project name', state.current.name);
      if (!name) return;
      try { await api('PATCH', '/api/projects/' + state.current.id, { name: name }); openProject(state.current.id); }
      catch (e) { toast(e.message, true); }
    });
    $('#ws-duplicate').addEventListener('click', async function () {
      try { var c = await api('POST', '/api/projects/' + state.current.id + '/duplicate', {}); toast('Duplicated.'); openProject(c.id); }
      catch (e) { toast(e.message, true); }
    });
    $('#ws-delete').addEventListener('click', async function () {
      if (!confirm('Delete this project and its versions? This cannot be undone.')) return;
      try {
        await api('DELETE', '/api/projects/' + state.current.id);
        state.current = null;
        $('#workspace').classList.add('hidden');
        toast('Project deleted.');
        loadProjects();
      } catch (e) { toast(e.message, true); }
    });
  }

  function bindOverview() {
    $('#create-btn').addEventListener('click', createProject);
    $('#new-project-quick').addEventListener('click', function () { location.hash = 'overview'; show('overview'); $('#new-name').focus(); });
  }

  function onHash() {
    var view = (location.hash || '#overview').slice(1);
    show(view);
  }

  window.RD.dashboard = async function () {
    var user = await RD.requireAuth();
    if (!user) return;
    state.user = user;
    $('#welcome-name').textContent = user.name;
    $('#profile-name').value = user.name;
    $('#profile-email').value = user.email;
    if (user.role === 'admin') $('#admin-link').classList.remove('hidden');
    $all('.sidebar a[data-view]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); location.hash = a.dataset.view; });
    });
    window.addEventListener('hashchange', onHash);
    bindWorkspace();
    bindOverview();
    var pending = localStorage.getItem('rd-pending-prompt');
    if (pending) {
      $('#new-prompt').value = pending;
      localStorage.removeItem('rd-pending-prompt');
      location.hash = 'overview';
    }
    onHash();
    await Promise.all([loadWallet(), loadProjects()]);
  };
})();
