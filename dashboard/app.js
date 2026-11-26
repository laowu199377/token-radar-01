// Token Radar — dashboard. No framework, no network: it renders window.RADAR
// (written by main.ts from the same board) and regenerates each protocol's
// farm plan from the row data, so the page's code and the board's data are
// visibly the same arithmetic. The farm-step strings below mirror
// lib/model.ts exactly — change one, change the other.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:40px">data.js did not load.</p>'; return; }

  // -- helpers ---------------------------------------------------------------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) {
    if (v === null || v === undefined) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    var s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
    return '<span class="' + (v >= 0 ? 'up' : 'down') + '">' + s + '</span>';
  }
  function age(v) {
    if (v === null || v === undefined) return '—';
    if (v < 30) return v + 'd';
    if (v < 365) return (v / 30).toFixed(1) + 'mo';
    return (v / 365).toFixed(1) + 'y';
  }

  // -- farm plan -----------------------------------------------------------
  // The plan rides in each row (row.farm_steps), written by lib/model.ts
  // from the same board, so the page shows exactly what board.json holds.
  // How it is built (lib/model.ts, farmSteps): capital tier from the
  // protocol's own TVL ($250 at >=$1B, $150 at >=$200M, $100 at >=$50M,
  // $50 below that); hold length from its own age (60 days if listed under
  // 6 months, 45 under a year, 30 after that, 45 if no listing date);
  // main and second actions chosen by category — lending/CDP, DEX/yield,
  // risk curator, prediction market, RWA, derivatives, stablecoin, or a
  // default deposit. Seven steps per protocol, each with a dollar amount
  // and a time cost, and each 20-600 characters.
  function farmSteps(row) { return row.farm_steps || []; }

  // -- state -----------------------------------------------------------------
  var state = { view: 'radar', q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1 };
  var $ = function (id) { return document.getElementById(id); };

  // -- header / stats --------------------------------------------------------
  $('asof').textContent = R.as_of;
  $('modelver').textContent = R.model_version;
  var totalImplied = R.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
  var wlRows = R.rows.filter(function (r) { return r.is_watchlist; });
  $('stats').innerHTML =
    '<div class="stat"><div class="k">Protocols ranked</div><div class="v">' + R.board_size + '</div><div class="d">pre-token, no wrapped / staked / bridged</div></div>' +
    '<div class="stat"><div class="k">Watchlist covered</div><div class="v">' + wlRows.length + ' / ' + R.watchlist_size + '</div><div class="d">all 40 in the top ' + Math.max.apply(null, wlRows.map(function (r) { return r.rank; })) + '</div></div>' +
    '<div class="stat"><div class="k">Total implied value</div><div class="v">' + money(totalImplied) + '</div><div class="d">sum of the board</div></div>' +
    '<div class="stat"><div class="k">Top launch</div><div class="v">' + money(R.rows[0].implied_value_usd) + '</div><div class="d">' + esc(R.rows[0].name) + ' · rank #1</div></div>';

  // -- filters ---------------------------------------------------------------
  var cats = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  // -- table -----------------------------------------------------------------
  var RADAR_HEAD = '<tr><th data-sort="rank" class="num sorted">#</th><th data-sort="name">Protocol</th><th data-sort="category">Category</th><th data-sort="chains">Chains</th><th data-sort="tvl" class="num">TVL</th><th data-sort="chg" class="num">7d</th><th data-sort="age" class="num">Age</th><th data-sort="value" class="num">Implied value</th></tr>';
  var LIVE_HEAD = '<tr><th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">Market cap</th></tr>';

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.wl && !r.is_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortKey(r) {
    switch (state.sort) {
      case 'rank': return r.rank;
      case 'name': return r.name.toLowerCase();
      case 'category': return (r.category || '').toLowerCase();
      case 'chains': return (r.chains || []).join(',');
      case 'tvl': return r.tvl_usd;
      case 'chg': return r.change_7d === null ? -999 : r.change_7d;
      case 'age': return r.age_days === null ? -1 : r.age_days;
      case 'value': return r.implied_value_usd;
      default: return r.rank;
    }
  }
  function renderTable() {
    var head = document.querySelector('#board thead');
    var body = $('rows');
    if (state.view === 'live') {
      head.innerHTML = LIVE_HEAD;
      body.innerHTML = R.live.map(function (l, i) {
        return '<tr data-slug="' + esc(l.slug) + '" data-live="1"><td class="num">' + (i + 1) + '</td><td class="name">' + esc(l.name) + '</td><td>' + esc(l.category || '—') + '</td><td class="chains">' + esc((l.chains || []).slice(0, 3).join(', ') || '—') + '</td><td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + money(l.mcap_usd) + '</td></tr>';
      }).join('');
      $('count').textContent = R.live.length + ' live-token protocols';
      $('controls').style.visibility = 'hidden';
      $('empty').hidden = true;
      return;
    }
    $('controls').style.visibility = 'visible';
    head.innerHTML = RADAR_HEAD;
    var rows = filteredRows().slice();
    rows.sort(function (a, b) {
      var ka = sortKey(a), kb = sortKey(b);
      if (ka < kb) return -1 * state.dir;
      if (ka > kb) return 1 * state.dir;
      return 0;
    });
    body.innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.is_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc((r.chains || []).slice(0, 3).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num age">' + age(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    $('count').textContent = rows.length + ' of ' + R.board_size + ' protocols';
    $('empty').hidden = rows.length > 0;
    head.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort);
      th.classList.toggle('asc', th.getAttribute('data-sort') === state.sort && state.dir === -1);
    });
  }

  // -- detail drawer ---------------------------------------------------------
  function findRow(slug) {
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i];
    return null;
  }
  function findLive(slug) {
    for (var i = 0; i < R.live.length; i++) if (R.live[i].slug === slug) return R.live[i];
    return null;
  }
  function openDetail(slug) {
    var r = findRow(slug), live = r ? null : findLive(slug);
    if (!r && !live) return;
    var d = $('detail');
    if (live) {
      d.innerHTML = '<h2>' + esc(live.name) + '</h2><p class="cat">' + esc(live.category || '') + ' · already trading</p>' +
        '<div class="kv"><div><div class="k">TVL</div><div class="v">' + money(live.tvl_usd) + '</div></div>' +
        '<div><div class="k">Market cap</div><div class="v">' + money(live.mcap_usd) + '</div></div></div>' +
        '<h3>Why it is not ranked</h3><p style="color:var(--muted);font-size:13px">This protocol already has a token trading, so the board shows the market\u2019s own value (market cap) instead of a model\u2019s. It is listed here for reference only — the radar ranks protocols still waiting for a launch.</p>';
    } else {
      var base = r.tvl_usd * R.model.base_multiple;
      var steps = farmSteps(r);
      d.innerHTML = '<h2>' + esc(r.name) + '</h2><p class="cat">Rank #' + r.rank + ' · ' + esc(r.category || '') + (r.is_watchlist ? ' · <span style="color:var(--amber)">Watchlist</span>' : '') + '</p>' +
        '<div class="kv"><div><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
        '<div><div class="k">7-day change</div><div class="v">' + (r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div></div>' +
        '<div><div class="k">No-token age</div><div class="v">' + age(r.age_days) + '</div></div>' +
        '<div><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div></div>' +
        '<h3>Model breakdown</h3><div class="breakdown">base = ' + money(r.tvl_usd) + ' × ' + R.model.base_multiple + ' = <code>' + money(base) + '</code><br>' +
        'growth ×' + r.growth_multiplier.toFixed(2) + ' (7d ' + (r.change_7d === null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ', clamped −50%…+150%, weight 0.5)<br>' +
        'maturity ×' + r.maturity_multiplier.toFixed(2) + ' (' + (r.age_days === null ? 'no listing date, counted as 1 year' : age(r.age_days) + ' old') + ', 0.50 → 1.20 over 4 years)<br>' +
        'implied = ' + money(base) + ' × ' + r.growth_multiplier.toFixed(2) + ' × ' + r.maturity_multiplier.toFixed(2) + ' = <code>' + money(r.implied_value_usd) + '</code></div>' +
        '<h3>Farm plan — 7 steps</h3><ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    }
    $('drawer').hidden = false;
  }
  function closeDetail() { $('drawer').hidden = true; }

  // -- events ----------------------------------------------------------------
  $('tab-radar').addEventListener('click', function () { state.view = 'radar'; $('tab-radar').classList.add('active'); $('tab-live').classList.remove('active'); renderTable(); });
  $('tab-live').addEventListener('click', function () { state.view = 'live'; $('tab-live').classList.add('active'); $('tab-radar').classList.remove('active'); renderTable(); });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderTable(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderTable(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderTable(); });
  $('wl').addEventListener('change', function (e) { state.wl = e.target.checked; renderTable(); });
  document.querySelector('#board thead').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-sort]');
    if (!th) return;
    var k = th.getAttribute('data-sort');
    if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
    renderTable();
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  $('drawer-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  // -- deep links (so a screenshot can open one exact view) ------------------
  // #detail=<slug>  #category=<name>  #watchlist=1  #view=live
  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var kv = part.split('='), k = decodeURIComponent(kv[0] || ''), v = decodeURIComponent(kv[1] || '');
      if (k === 'view' && v === 'live') { $('tab-live').click(); }
      if (k === 'category' && v) { state.cat = v; $('cat').value = v; }
      if (k === 'watchlist' && v === '1') { state.wl = true; $('wl').checked = true; }
      if (k === 'q' && v) { state.q = v; $('q').value = v; }
    });
    renderTable();
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (decodeURIComponent(kv[0] || '') === 'detail') openDetail(decodeURIComponent(kv[1] || ''));
    });
  }

  renderTable();
  applyHash();
})();
