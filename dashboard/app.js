// Token Launch Radar dashboard. Reads window.RADAR (written by main.ts),
// renders the board, the live-token view, per-protocol detail and the model
// explanation. No network, no framework. State lives in the URL hash so a
// view can be screenshotted directly: #q= search, #category= filter,
// #p=<slug> detail, #tab= live or model.
(function () {
  'use strict';
  var D = window.RADAR;
  var rows = D.rows;
  var live = D.live;
  var maxImplied = rows.length ? rows[0].implied_value_usd : 1;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function age(v) {
    if (v === null || v === undefined) return '—';
    if (v < 30) return v + 'd';
    if (v < 365) return Math.round(v / 30) + 'mo';
    return (v / 365).toFixed(1) + 'y';
  }
  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    var out = { tab: 'board', q: '', category: '', chain: '', minTvl: 0, scope: 'all', sort: 'implied', p: '' };
    if (!h) return out;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i));
      var v = decodeURIComponent(kv.slice(i + 1));
      if (k === 'tab') out.tab = v;
      else if (k === 'q') out.q = v;
      else if (k === 'category') out.category = v;
      else if (k === 'chain') out.chain = v;
      else if (k === 'minTvl') out.minTvl = +v || 0;
      else if (k === 'scope') out.scope = v;
      else if (k === 'sort') out.sort = v;
      else if (k === 'p') out.p = v;
    });
    return out;
  }
  function writeHash(s) {
    var parts = [];
    if (s.tab !== 'board') parts.push('tab=' + encodeURIComponent(s.tab));
    if (s.q) parts.push('q=' + encodeURIComponent(s.q));
    if (s.category) parts.push('category=' + encodeURIComponent(s.category));
    if (s.chain) parts.push('chain=' + encodeURIComponent(s.chain));
    if (s.minTvl) parts.push('minTvl=' + s.minTvl);
    if (s.scope !== 'all') parts.push('scope=' + s.scope);
    if (s.sort !== 'implied') parts.push('sort=' + s.sort);
    if (s.p) parts.push('p=' + encodeURIComponent(s.p));
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  }

  var $ = function (id) { return document.getElementById(id); };

  // ---- filter option lists
  var chains = {};
  var cats = {};
  rows.forEach(function (r) {
    cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  var chainSel = $('fChain');
  chainSel.innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');
  $('fCat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  // ---- stats strip
  var watchN = rows.filter(function (r) { return r.watchlist; }).length;
  var medTvl = rows.map(function (r) { return r.tvl_usd; }).sort(function (a, b) { return a - b; })[Math.floor(rows.length / 2)];
  $('stats').innerHTML =
    '<div class="stat"><b>' + rows.length + '</b><span>Protocols ranked</span></div>' +
    '<div class="stat"><b>' + watchN + '</b><span>Watchlist (≥ $50M)</span></div>' +
    '<div class="stat"><b>' + (rows.length - watchN) + '</b><span>Early finds</span></div>' +
    '<div class="stat"><b>' + money(medTvl) + '</b><span>Median board TVL</span></div>' +
    '<div class="stat"><b>' + esc(D.asOf) + '</b><span>Snapshot date</span></div>';

  function filtered(s) {
    var q = s.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (s.category && r.category !== s.category) return false;
      if (s.chain && r.chains.indexOf(s.chain) < 0) return false;
      if (s.minTvl && r.tvl_usd < s.minTvl) return false;
      if (s.scope === 'watchlist' && !r.watchlist) return false;
      if (s.scope === 'early' && r.watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.breakdown.ageDays || 0) - (a.breakdown.ageDays || 0); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    }[s.sort] || function (a, b) { return b.implied_value_usd - a.implied_value_usd; };
    return list.sort(by);
  }

  function boardRow(r) {
    var w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 220));
    return '<tr><td class="rank">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span> ' +
      '<span class="badge' + (r.watchlist ? '' : ' early') + '">' + (r.watchlist ? 'WATCHLIST' : 'EARLY') + '</span><br>' +
      '<span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category) + '</td>' +
      '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + age(r.breakdown.ageDays) + '</td>' +
      '<td class="num"><span class="bar" style="width:' + w + 'px"></span>' + moneyFull(r.implied_value_usd) + '</td></tr>';
  }

  function renderDetail(s) {
    var box = $('detail');
    if (!s.p) { box.innerHTML = ''; return; }
    var r = null;
    rows.forEach(function (x) { if (x.slug === s.p) r = x; });
    if (!r) { box.innerHTML = '<p class="note">No protocol with slug ' + esc(s.p) + ' on this board.</p>'; return; }
    var b = r.breakdown;
    var catInfo = D.model.catMultiples[r.category] || { liveCount: 0 };
    var catNote = catInfo.liveCount >= 3
      ? esc(r.category) + ', live median ' + b.catMedian.toFixed(3)
      : esc(r.category) + ', too few live tokens for a median, so 1.00';
    var eq = moneyFull(r.tvl_usd) + ' TVL × 0.17 = ' + moneyFull(b.base) +
      '\n× chain ' + b.chainF.toFixed(2) + ' (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')' +
      '\n× momentum ' + b.momF.toFixed(2) + ' (7d ' + (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%') + ')' +
      '\n× category ' + b.catF.toFixed(2) + ' (' + catNote + ')' +
      '\n× maturity ' + b.matF.toFixed(2) + ' (' + (b.ageDays === null ? 'age unknown, counted as 365 days' : b.ageDays + ' days tracked') + ')' +
      '\n= ' + moneyFull(r.implied_value_usd) + ' implied value';
    box.innerHTML =
      '<button class="back" id="backBtn">← Back to the board</button>' +
      '<h2>' + esc(r.name) + ' <span class="badge' + (r.watchlist ? '' : ' early') + '">' + (r.watchlist ? 'WATCHLIST' : 'EARLY') + '</span></h2>' +
      '<p class="meta">Rank ' + r.rank + ' of ' + rows.length + ' · ' + esc(r.category) + ' · ' + esc(r.chains.join(', ')) +
      ' · TVL ' + moneyFull(r.tvl_usd) + ' · 7-day ' + (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%') +
      ' · tracked since ' + (r.listed_at || 'unknown') + ' · records no token</p>' +
      '<h3>Implied value — how the model gets there</h3>' +
      '<div class="equation">' + eq + '</div>' +
      '<h3>Farm plan — six steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('') + '</ol>';
    $('backBtn').addEventListener('click', function () {
      var ns = parseHash(); ns.p = ''; writeHash(ns); render();
    });
  }

  function renderLive() {
    $('liveBody').innerHTML = live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + r.ratio.toFixed(2) + '×</td></tr>';
    }).join('');
  }

  function renderModel() {
    var m = D.model;
    var multRows = Object.keys(m.catMultiples).sort().map(function (cat) {
      var e = m.catMultiples[cat];
      return '<tr><td>' + esc(cat) + '</td><td class="num">' + (e.liveCount >= 3 ? e.liveMedian.toFixed(3) : '—') + '</td>' +
        '<td class="num">' + e.liveCount + '</td><td class="num">' + e.multiple.toFixed(2) + '×</td></tr>';
    }).join('');
    $('modelWrap').innerHTML =
      '<div class="modelbox"><h2>The model — radar-2</h2>' +
      '<p><b>implied value = TVL × 0.17 × chain factor × momentum factor × category multiple × maturity factor.</b> ' +
      'Every input comes from the sealed snapshot alone. Nothing is hardcoded by protocol name, and the same snapshot always gives the same board.</p>' +
      '<h3>Why 0.17?</h3><p>The 144 protocols in this snapshot that already have a token carry a median market-cap-to-TVL ratio of ' +
      m.overallLiveMedian.toFixed(3) + '. The mean is 4.48, skewed by a few outliers, so the median is the honest anchor: a token is worth about 17 cents of market cap per dollar of TVL.</p>' +
      '<h3>Chain factor — 1 + 0.08 × (chains − 1), capped at 6 chains (max 1.40)</h3>' +
      '<p>Each extra chain is more launch surface: more users to reach, more venues to list on. Past six chains the extra surface flattens, so the factor caps there.</p>' +
      '<h3>Momentum factor — 1 + 0.006 × 7-day change, clamped to −50%…+100% (0.70–1.60)</h3>' +
      '<p>TVL growing fast means the protocol is gaining users right now and is closer to launch-ready than one bleeding TVL. A change outside the clamp, or an unreported one, counts at the clamp or at 0%.</p>' +
      '<h3>Category multiple — the category’s live median ÷ 0.169, clamped to 0.50–2.00</h3>' +
      '<p>Categories whose live tokens command more per TVL dollar are worth more per TVL dollar. A category with fewer than 3 live protocols has no trustworthy median and takes 1.00. The multiples are computed from the snapshot at run time.</p>' +
      '<table><thead><tr><th>Category</th><th class="num">Live median mcap/TVL</th><th class="num">Live n</th><th class="num">Multiple</th></tr></thead><tbody>' + multRows + '</tbody></table>' +
      '<h3>Maturity factor — 0.70 + 0.30 × min(age, 1460 days) / 1460</h3>' +
      '<p>A protocol that has run for years with no token has survived cycles and built the user base a launch needs. A two-week-old protocol has not. Unknown listing date counts as 365 days.</p>' +
      '<h3>Who gets on the board</h3><p>Only protocols that record no token (no market cap, no CoinGecko id, no symbol), whose name ends in no version marker, and whose category is not CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking or Restaked BTC — wrapped, staked or bridged products of tokens that already trade. All 40 watchlist protocols pass; the board adds the 160 highest-implied early protocols below the $50M floor that pass too.</p>' +
      '<h3>What the numbers are not</h3><p>An implied value is this radar’s own claim about what a token would be worth if the protocol’s record stayed as it is. It does not predict whether or when a token is issued. Farm steps are research, not financial advice, and every step names its cost and its time.</p></div>';
  }

  function render() {
    var s = parseHash();
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === s.tab);
    });
    var isBoard = s.tab === 'board';
    $('controls').style.display = isBoard ? '' : 'none';
    $('boardWrap').style.display = isBoard ? '' : 'none';
    $('liveWrap').hidden = s.tab !== 'live';
    $('modelWrap').hidden = s.tab !== 'model';
    $('q').value = s.q;
    $('fChain').value = s.chain;
    $('fCat').value = s.category;
    $('fTvl').value = String(s.minTvl);
    $('fScope').value = s.scope;
    $('fSort').value = s.sort;
    if (isBoard) {
      var list = filtered(s);
      $('boardBody').innerHTML = list.map(boardRow).join('');
      $('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' ranked protocols' +
        (s.p ? ' — detail open below' : '');
    } else {
      $('count').textContent = '';
    }
    renderDetail(s);
    if (s.tab === 'live') renderLive();
    if (s.tab === 'model') renderModel();
  }

  function syncFromControls() {
    var s = parseHash();
    s.q = $('q').value;
    s.chain = $('fChain').value;
    s.category = $('fCat').value;
    s.minTvl = +$('fTvl').value || 0;
    s.scope = $('fScope').value;
    s.sort = $('fSort').value;
    writeHash(s);
    render();
  }
  ['q', 'fChain', 'fCat', 'fTvl', 'fScope', 'fSort'].forEach(function (id) {
    $(id).addEventListener('input', syncFromControls);
    $(id).addEventListener('change', syncFromControls);
  });
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = parseHash();
      s.tab = b.getAttribute('data-tab');
      s.p = '';
      writeHash(s);
      render();
    });
  });
  window.addEventListener('hashchange', render);
  render();
})();
