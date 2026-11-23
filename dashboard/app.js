/* Token Radar dashboard: sortable, filterable board + detail + live view.
   Data comes from data.js (window.RADAR), written by main.ts from the
   same snapshot as board.json. No network, no fetch. */
(function () {
  'use strict';
  var D = window.RADAR || { rows: [], live: [], fit: {}, validation: {} };
  var rows = D.rows.slice();
  var state = { q: '', cat: '', chain: '', scope: 'all', minTvl: 0, sort: 'rank', dir: 1, detail: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v == null) return '<span class="flat">n/a</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageText(a) {
    if (a == null) return 'unknown';
    if (a < 30) return a + 'd';
    if (a < 365) return Math.round(a / 30) + 'mo';
    return (a / 365).toFixed(1) + 'y';
  }
  function catName(r) { return r.category || 'Uncategorised'; }

  /* ---- header stats ---- */
  var medLive = D.fit ? D.fit.median_multiple : null;
  $('stats').innerHTML = [
    ['Board rows', D.board_size], ['Watchlist', D.watchlist_size],
    ['Early finds', D.early_size], ['Live tokens', D.live_size],
    ['Snapshot', D.as_of || '—'],
    ['Median live MCap/TVL', medLive == null ? '—' : '×' + medLive.toFixed(2)],
    ['Top implied value', rows.length ? moneyFull(rows[0].implied_value_usd) : '—']
  ].map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('');
  $('asof').textContent = D.as_of || '';

  /* ---- filter controls ---- */
  function fillSelect(id, values) {
    var sel = $(id);
    values.forEach(function (v) {
      var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
    });
  }
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (cats.indexOf(catName(r)) < 0) cats.push(catName(r));
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  fillSelect('cat', cats.sort());
  fillSelect('chain', chains.sort());

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.cat && catName(r) !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + catName(r)).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function sortRows(list) {
    var k = state.sort, d = state.dir;
    return list.slice().sort(function (a, b) {
      var va, vb;
      if (k === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      else if (k === 'category') { va = catName(a); vb = catName(b); }
      else if (k === 'chains') { va = a.chains[0] || ''; vb = b.chains[0] || ''; }
      else { va = a[k] == null ? -1 : a[k]; vb = b[k] == null ? -1 : b[k]; }
      if (va < vb) return -1 * d;
      if (va > vb) return 1 * d;
      return a.rank - b.rank;
    });
  }

  function renderBoard() {
    var list = sortRows(filtered());
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">#' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(catName(r)) + '</td><td>' + esc(r.chains[0] || '') + (r.chains.length > 1 ? ' +' + (r.chains.length - 1) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td><td class="num"><b>' + moneyFull(r.implied_value_usd) + '</b></td>' +
        '<td>' + (r.wrapped ? '<span class="badge early">WRAPPED</span>' : (r.watchlist ? '<span class="badge watch">WATCHLIST</span>' : '<span class="badge early">EARLY</span>')) + '</td></tr>';
    }).join('') || '<tr><td colspan="9">No protocols match these filters.</td></tr>';
    document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
      var k = th.getAttribute('data-sort');
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (state.sort === k ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    });
  }

  function renderDetail() {
    var box = $('detail');
    var r = null;
    if (state.detail) rows.forEach(function (x) { if (x.slug === state.detail) r = x; });
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var m = r.model;
    var liveNote = D.validation && D.fit
      ? 'Live-token protocols in this snapshot trade at a median market-cap-to-TVL multiple of ×' + D.fit.median_multiple +
        '; this protocol\'s fitted base multiple is ×' + m.base_multiple.toFixed(2) +
        ' (category adjustment ' + (m.category_adjustment >= 0 ? '+' : '') + m.category_adjustment + ' in log10).'
      : '';
    box.hidden = false;
    box.innerHTML =
      '<h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
      '<div class="meta"><span>Slug <b>' + esc(r.slug) + '</b></span><span>Category <b>' + esc(catName(r)) + '</b></span>' +
      '<span>Chains <b>' + esc(r.chains.join(', ')) + '</b></span><span>Listed <b>' + esc(r.listed_at || 'unknown') + '</b></span>' +
      '<span>' + (r.watchlist ? 'On the snapshot watchlist' : 'Early find, below the watchlist floor') + '</span>' +
      (r.wrapped ? '<span><b>Flagged:</b> a wrapped, staked or bridged product of a token that already trades — not a fresh launch</span>' : '') + '</div>' +
      '<dl class="grid">' +
      '<div><dt>Implied value</dt><dd>' + moneyFull(r.implied_value_usd) + '<small>the entry\'s own claim</small></dd></div>' +
      '<div><dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '<small>7d ' + (r.change_7d == null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</small></dd></div>' +
      '<div><dt>Base multiple</dt><dd>×' + m.base_multiple.toFixed(2) + '<small>fitted from live tokens</small></dd></div>' +
      '<div><dt>Growth multiplier</dt><dd>×' + m.growth_multiplier.toFixed(2) + '<small>7d change clamped to ' + m.growth_pct + '%</small></dd></div>' +
      '<div><dt>Maturity multiplier</dt><dd>×' + m.maturity_multiplier.toFixed(2) + '<small>age ' + ageText(m.age_days) + '</small></dd></div>' +
      '</dl>' +
      '<p>' + esc(liveNote) + ' The protocol records no token in the snapshot — that is the record, not proof it has none — and the implied value is not a prediction that a token will be issued.</p>' +
      '<h3>How to farm it — 6 steps</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="note">Every step states its cost and its time. Farming costs real gas and carries real risk; check the protocol\'s own pages before you act, and never pay anyone to claim for you.</p>' +
      '<p><button type="button" id="closeDetail">Close detail</button></p>';
    $('closeDetail').addEventListener('click', function () { state.detail = null; renderDetail(); });
  }

  function renderLive() {
    $('liveRows').innerHTML = D.live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(catName(r)) + '</td><td>' + esc(r.chains.slice(0, 2).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.multiple == null ? '—' : '×' + r.multiple.toFixed(2)) + '</td></tr>';
    }).join('');
  }

  function renderModel() {
    var f = D.fit, v = D.validation;
    $('modelText').innerHTML =
      '<p><strong>The idea.</strong> Live-token protocols in the same snapshot already have a market price. The model learns how that price relates to TVL, then prices each pre-token protocol on the same terms — as if its record stayed exactly as it is.</p>' +
      '<div class="formula"><code>implied = 10^(a + b × log10(TVL) + categoryAdj) × growthMult × maturityMult</code><br>' +
      'a = ' + f.intercept + ', b = ' + f.slope + ' — fitted by least squares on ' + f.live_count + ' live-token protocols (positive market cap, positive TVL, wrapped, bridged, staked and exchange products excluded). ' +
      'The median live multiple is ×' + f.median_multiple + '. A slope below 1 means larger protocols trade at a smaller multiple of TVL.</div>' +
      '<ul><li><strong>Category adjustment.</strong> Categories with at least five live members get a shrunken median-residual adjustment, capped at ±0.30 in log10 (at most a factor of two). Smaller categories get none — too little evidence.</li>' +
      '<li><strong>Growth.</strong> The 7-day TVL change, clamped to −50%…+100% and weighted at 0.45: <code>growthMult = 1 + 0.45 × clamped change</code>. Missing 7-day change counts as 0%.</li>' +
      '<li><strong>Maturity.</strong> Age is the snapshot date minus the listing date; unknown age is neutral. <code>maturityMult = 0.80 + 0.20 × min(age, 1095) / 1095</code>, so a brand-new protocol scores 0.80 and a three-year-old one 1.00.</li></ul>' +
      '<h3>Validation — stated honestly</h3>' +
      '<p>Leave-one-out over the ' + v.live_count + ' live-token protocols: refit the whole model without each protocol, predict it, and compare with its real market cap. ' +
      'The median prediction is off by a factor of <strong>×' + v.median_factor_error + '</strong> (median log10 error ' + v.median_log10_error + ', mean ' + v.mean_log10_error + '). ' +
      'Only ' + Math.round(v.within_factor_2 * 100) + '% of predictions land within a factor of two. The market is noisy, and this model is a ranking aid — it orders protocols by the snapshot\'s own figures, it does not forecast a price, an issuance or a date.</p>' +
      '<h3>What the board is not</h3>' +
      '<p>The board never says a protocol <em>has</em> no token — only that it <em>records</em> no token in the snapshot. A protocol may still have a token its record does not carry. Wrapped, staked and bridged products of tokens that already trade are ranked only when they are on the snapshot watchlist, and then they are flagged WRAPPED on the board — their underlying token already trades, so they are not fresh launches, and their market caps are not protocol tokens priced against their TVL, so they are left out of the fit too. Non-watchlist wrapped, bridged and staked products stay out of the ranking, as do exchanges and versioned pools. No protocol name is ever special-cased: the same function scores every row.</p>';
  }

  /* ---- views ---- */
  function show(view) {
    ['board', 'live', 'model'].forEach(function (v) { $('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === view);
    });
    if (view === 'live') renderLive();
    if (view === 'model') renderModel();
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-view')); });
  });

  /* ---- events ---- */
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('scope').addEventListener('change', function (e) { state.scope = e.target.value; renderBoard(); });
  $('minTvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); renderBoard(); });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' || k === 'implied_value_usd' || k === 'tvl_usd' ? -1 : 1; }
      renderBoard();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = tr.getAttribute('data-slug');
    renderDetail();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---- deep links for screenshots: #detail=slug, #scope=watchlist, #q=text, #cat=.., #view=live ---- */
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = kv[0], v = kv[1] ? decodeURIComponent(kv[1]) : '';
      if (k === 'detail') state.detail = v;
      if (k === 'scope' && (v === 'watchlist' || v === 'early' || v === 'all')) { state.scope = v; $('scope').value = v; }
      if (k === 'q') { state.q = v; $('q').value = v; }
      if (k === 'cat') { state.cat = v; $('cat').value = v; }
      if (k === 'chain') { state.chain = v; $('chain').value = v; }
      if (k === 'minTvl') { state.minTvl = Number(v) || 0; $('minTvl').value = String(state.minTvl); }
      if (k === 'view') show(v);
    });
  }
  readHash();
  renderBoard();
  renderDetail();
})();
