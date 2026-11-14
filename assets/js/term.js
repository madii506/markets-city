/* markets terminal: watchlist, candles, time & sales, heatmap, order ticket, account, screener, portfolio, command line.
   Every number comes from /api/m (Jupiter, Solana RPC, the share's exchange, GeckoTerminal). Nothing is simulated. */
(function () {
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const API = '/api/m', WAL = window.MarketsWallet;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const px = x => x == null || !isFinite(x) ? '—' : x === 0 ? '0.00' : x >= 1000 ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : x >= 1 ? x.toFixed(2) : x >= 0.01 ? x.toFixed(4) : x >= 1e-7 ? x.toFixed(Math.min(12, 3 - Math.floor(Math.log10(x)))).replace(/0+$/, '') : x.toExponential(2);
  const usd = x => x == null || !isFinite(x) ? '—' : '$' + px(x);
  const big = x => x == null ? '—' : x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : '$' + x.toFixed(0);
  const int = x => x == null ? '—' : Math.round(x).toLocaleString('en-US');
  const amt = (x, d) => x == null || !isFinite(x) ? '—' : x === 0 ? '0' : x.toLocaleString('en-US', { maximumFractionDigits: d != null ? d : (x >= 1000 ? 2 : x >= 1 ? 4 : 6) });
  const pc = x => x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2) + '%';
  const cls = x => x == null ? 'mute' : x >= 0 ? 'up' : 'dn';
  const mono = s => esc(String(s || '?').replace('.', '').slice(0, 4));
  const lg = (sym, icon, k) => `<span class="lg ${k || ''}">${mono(sym)}${icon ? `<img src="${esc(icon)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { } } };
  const hhmmss = t => new Date(t).toISOString().slice(11, 19);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(el, to, fmt, from, ms) { if (!el) return; if (still || to == null || !isFinite(to)) { el.textContent = fmt(to); return; } const f0 = from != null ? from : 0, t0 = performance.now(), d = ms || 1000; const step = now => { const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(f0 + (to - f0) * e); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
  const flashCls = (o, n) => o != null && n != null && o !== n ? (n > o ? ' fu' : ' fd') : '';

  const S = { P: null, by: {}, city: null, cc: 'all', cs: 'all', wk: 'stock', view: null, sym: store.get('markets.sym') || 'NVDA', wq: '', ws: 'liq', mq: '', mk: 'all', ms: 'liq', md: -1,
    side: 'buy', cash: 'SOL', amt: '', quote: null, qid: 0, quoteAt: 0, quoting: false, slip: 100, range: '1D', chart: null, trades: null, tsSeen: new Set(), bal: null, balAt: 0, busy: false };

  async function api(a, params, init) {
    const u = new URL(API, location.origin); u.searchParams.set('a', a);
    for (const k in (params || {})) u.searchParams.set(k, params[k]);
    const r = await fetch(u, Object.assign({ cache: 'no-store' }, init || {}));
    const j = await r.json().catch(() => ({ error: 'the server sent a bad response' }));
    if (!r.ok || j.error) throw new Error(j.error || 'error ' + r.status);
    return j;
  }
  const post = (a, body) => api(a, {}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let toastT = 0;
  const toast = m => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3000); };
  const solIcon = () => S.P && S.P.sol && S.P.sol.icon, usdcIcon = () => S.P && S.P.usdc && S.P.usdc.icon;
  const cashUsd = c => c === 'USDC' ? 1 : (S.P && S.P.sol.usd);
  const stock = () => S.by[S.sym];

  // ---------------------------------------------------------------- clock + feed status
  setInterval(() => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 1000);
  function feed(ok) { const l = $('#live'); l.classList.toggle('off', !ok); l.innerHTML = ok ? '<i>●</i> LIVE' : '<i>●</i> OFFLINE'; }

  // ---------------------------------------------------------------- prices
  let first = true;
  async function loadPrices() {
    try {
      const j = await api('prices');
      const prev = S.by; S.P = j;
      const city = (j.city || []).map(c => Object.assign({}, c, { icon: c.icon || cityIcon(c), tok: c.sym }));
      S.by = Object.fromEntries(j.stocks.concat(city).map(s => [s.sym, s])); feed(true);
      if (!S.by[S.sym]) S.sym = 'NVDA';
      $('#solp').innerHTML = j.sol.usd ? `SOL <b>${usd(j.sol.usd)}</b> <span class="${cls(j.sol.ch24)}">${pc(j.sol.ch24)}</span>` : '';
      renderTape(); renderWatch(prev); renderHeat(); renderQuote(); renderMarkets(); renderAccount(); renderOverview();
      if (S.view === 'trade') renderTicket();
      if (first) { first = false; loadChart(); loadTrades(); loadStats(S.sym); }
    } catch (e) {
      feed(false);
      if (!S.P) { $('#qh').innerHTML = `<div class="empty">The price feed is offline: ${esc(e.message)} <button class="kb" id="rt">Retry</button></div>`; const b = $('#rt'); if (b) b.onclick = loadPrices; }
    }
  }

  // ---------------------------------------------------------------- tape
  function renderTape() {
    const L = S.P.stocks.filter(s => !s.thin && s.usd != null).sort((a, b) => (b.liq || 0) - (a.liq || 0));
    const it = s => `<span class="tk" data-sym="${esc(s.sym)}"><b>${esc(s.sym)}</b>${px(s.usd)} <span class="${cls(s.ch24)}">${s.ch24 >= 0 ? '▲' : '▼'}${Math.abs(s.ch24 || 0).toFixed(2)}%</span></span>`;
    const sol = S.P.sol.usd ? `<span class="tk"><b>SOL</b>${px(S.P.sol.usd)} <span class="${cls(S.P.sol.ch24)}">${S.P.sol.ch24 >= 0 ? '▲' : '▼'}${Math.abs(S.P.sol.ch24 || 0).toFixed(2)}%</span></span>` : '';
    const h = sol + L.map(it).join('');
    $('#tape').innerHTML = h + h;
  }
  $('#tape').addEventListener('click', e => { const t = e.target.closest('[data-sym]'); if (t) pick(t.dataset.sym); });

  // ---------------------------------------------------------------- watchlist
  function wlList() {
    const q = S.wq.trim().toLowerCase();
    const L = Object.values(S.by).filter(s => (S.wk === 'city' ? s.kind === 'city' : s.kind !== 'city') && (!q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
    if (S.ws === 'sym') L.sort((a, b) => a.sym.localeCompare(b.sym));
    else if (S.ws === 'ch') L.sort((a, b) => (a.thin - b.thin) || ((b.ch24 == null ? -99 : b.ch24) - (a.ch24 == null ? -99 : a.ch24)));
    else L.sort((a, b) => (a.thin - b.thin) || (b.liq || 0) - (a.liq || 0));
    return L;
  }
  function renderWatch(prev) {
    if (!S.P) return;
    const L = wlList();
    $('#wlN').textContent = L.length + '/' + Object.values(S.by).filter(s => (S.wk === 'city') === (s.kind === 'city')).length;
    $('#wlb').innerHTML = L.map(s => {
      const p0 = prev && prev[s.sym], moved = p0 && p0.usd != null && s.usd != null && p0.usd !== s.usd;
      return `<div class="wr${s.sym === S.sym ? ' on' : ''}${s.thin ? ' thin' : ''}${moved ? ' fl' : ''}" data-sym="${esc(s.sym)}" title="${esc(s.name)}">${lg(s.sym, s.icon)}<b>${esc(s.sym)}</b><span class="p">${s.thin ? 'thin' : px(s.usd)}</span><span class="c ${cls(s.ch24)}">${s.thin ? '' : pc(s.ch24)}</span></div>`;
    }).join('') || (S.wk === 'city' ? '<div class="empty">no city coins trading yet. the first founder opens the doors. <a href="#city" style="color:var(--acc)">see the city →</a></div>' : '<div class="empty">no match.</div>');
  }
  $('#wlb').addEventListener('click', e => { const r = e.target.closest('[data-sym]'); if (r) pick(r.dataset.sym); });
  $('#wlq').addEventListener('input', e => { S.wq = e.target.value; renderWatch(); });
  $('#wlk').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.wk = b.dataset.k; $$('#wlk button').forEach(x => x.classList.toggle('on', x === b)); renderWatch(); });
  $('#wls').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.ws = b.dataset.s; $$('#wls button').forEach(x => x.classList.toggle('on', x === b)); renderWatch(); });

  // ---------------------------------------------------------------- heatmap
  function heatColor(s) {
    if (s.thin || s.ch24 == null) return ['#f3eef5', 'var(--dim)'];
    const a = Math.pow(Math.min(1, Math.abs(s.ch24) / 4), 0.8), to = s.ch24 >= 0 ? [23, 138, 88] : [201, 55, 90];
    const c = [243, 238, 245].map((b, i) => Math.round(b + (to[i] - b) * a));
    return [`rgb(${c.join(',')})`, a > 0.55 ? '#ffffff' : (s.ch24 >= 0 ? '#11663f' : '#9c2443')];
  }
  const lastHeat = {}; let heatSeen = false;
  function renderHeat() {
    const order = { etf: 0, metal: 1, stock: 2 };
    const L = S.P.stocks.slice().sort((a, b) => (a.thin - b.thin) || (order[a.kind] - order[b.kind]) || (b.liq || 0) - (a.liq || 0));
    const up = L.filter(s => !s.thin && s.ch24 > 0).length, dn = L.filter(s => !s.thin && s.ch24 < 0).length;
    $('#hmN').innerHTML = `<span class="up">${up}▲</span> <span class="dn">${dn}▼</span>`;
    const first = !heatSeen; heatSeen = true;
    $('#hmg').innerHTML = L.map((s, i) => { const [bg, fg] = heatColor(s); const fl = flashCls(lastHeat[s.sym], s.usd); lastHeat[s.sym] = s.usd; return `<div class="hm-t${s.sym === S.sym ? ' on' : ''}${fl}${first ? ' pop' : ''}" data-sym="${esc(s.sym)}" style="background:${bg};color:${fg};--i:${i}" title="${esc(s.name)}"><b>${esc(s.sym)}</b>${s.thin ? 'thin' : pc(s.ch24)}</div>`; }).join('');
  }
  $('#hmg').addEventListener('click', e => { const t = e.target.closest('[data-sym]'); if (t) pick(t.dataset.sym); });

  // ---------------------------------------------------------------- key stats for a stock
  const DAY = {}, Y1 = {};
  async function loadStats(sym) {
    const s = S.by[sym]; if (!s || s.kind === 'city' || Y1[sym]) return;
    Y1[sym] = { busy: true };
    try { const c = await api('chart', { sym, r: '1Y' }); const L = c.pts; Y1[sym] = { lo: Math.min(...L.map(p => p[3])), hi: Math.max(...L.map(p => p[2])), first: L[0][4], last: L[L.length - 1][4], src: c.src }; }
    catch (e) { Y1[sym] = { err: true }; }
    if (S.sym === sym) renderQuote();
  }
  const rangeBar = (lo, hi, v) => lo != null && hi > lo && v != null ? `<i class="rb"><i style="left:${(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100).toFixed(1)}%"></i></i>` : '';

  // ---------------------------------------------------------------- quote header
  const lastQ = {};
  function renderQuote() {
    const s = stock(); if (!s) return;
    const c = S.chart && S.chart.sym === s.sym ? S.chart : null;
    const state = c && c.state ? `<span class="tag">${esc((c.exch || 'US market').toUpperCase())} ${c.state === 'open' ? 'OPEN' : c.state === 'pre' ? 'PRE-MARKET' : c.state === 'after' ? 'AFTER HOURS' : 'CLOSED'}</span>` : '';
    if (s.kind === 'city') {
      $('#qh').innerHTML = `${lg(s.sym, s.icon, 'l')}<div class="nm"><b>${esc(s.sym)}</b><small>${esc(s.name)} · ${esc(window.MarketsItems ? MarketsItems.CAT[s.cat] : s.cat)} · founded by ${short(s.founder)}</small></div>
      <div class="px"><b>${usd(s.usd)}</b><span class="${cls(s.ch24)}">${pc(s.ch24)} 24h</span></div>
      <div class="qs"><span>MCAP <b>${big(s.mcap)}</b></span><span>DEPTH <b>${big(s.liq)}</b></span><span>HOLDERS <b>${int(s.holders)}</b></span><span>VOL 24H <b>${big(s.vol24)}</b></span><span class="tag">CITY COIN · NOT A REAL ASSET</span><span><a href="https://pump.fun/coin/${esc(s.mint)}" target="_blank" rel="noopener">pump.fun ↗</a></span><span>TOKEN <a href="https://solscan.io/token/${esc(s.mint)}" target="_blank" rel="noopener">${short(s.mint)} ↗</a></span></div>`;
      return;
    }
    const qf = lastQ.sym === s.sym ? flashCls(lastQ.usd, s.usd) : ''; lastQ.sym = s.sym; lastQ.usd = s.usd;
    $('#qh').innerHTML = `${lg(s.sym, s.icon, 'l')}<div class="nm"><b>${esc(s.sym)}</b><small>${esc(s.name)} · ${esc(s.tok)} · ${esc(s.kind)}</small></div>
      <div class="px"><b class="${qf}">${s.thin ? '—' : usd(s.usd)}</b><span class="${cls(s.ch24)}">${s.thin ? 'thin market' : pc(s.ch24) + ' 24h'}</span></div>
      <div class="qs"><span>DEPTH <b>${big(s.liq)}</b></span><span>HOLDERS <b>${int(s.holders)}</b></span><span>MCAP <b>${big(s.mcap)}</b></span><span>VOL 24H <b>${big(s.vol24)}</b></span>${state}<span>TOKEN <a href="https://solscan.io/token/${esc(s.mint)}" target="_blank" rel="noopener">${short(s.mint)} ↗</a></span></div>
      <div class="ks">${(d => d ? `<span><em>Day range</em><b>${px(d.lo)} – ${px(d.hi)}</b>${rangeBar(d.lo, d.hi, c && c.last != null ? c.last : null)}</span><span><em>Prev close</em><b>${px(d.prev)}</b></span>` : '')(DAY[s.sym])}${(y => y && y.lo != null ? `<span><em>52-week range</em><b>${px(y.lo)} – ${px(y.hi)}</b>${rangeBar(y.lo, y.hi, y.last)}</span><span><em>1 year</em><b class="${cls((y.last / y.first - 1) * 100)}">${pc((y.last / y.first - 1) * 100)}</b></span>` : y && y.busy ? '<span><em>52-week range</em><b class="mute">loading…</b></span>' : '')(Y1[s.sym])}${SECTOR[s.sym] ? `<span><em>Sector</em><b>${esc(SECTOR[s.sym])}</b></span>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- pick a stock
  function pick(sym, keepHash) {
    if (!S.by[sym]) { cmdOut('unknown stock: ' + sym, 'err'); return; }
    const changed = sym !== S.sym; S.sym = sym; store.set('markets.sym', sym);
    if (!keepHash && location.hash !== '#trade/' + sym) history.replaceState(null, '', '#trade/' + encodeURIComponent(sym));
    if (S.view !== 'trade') show('trade');
    if (changed) { S.amt = ''; $('#amt').value = ''; resetQuote(); $('#log').innerHTML = ''; S.trades = null; S.tsSeen = new Set(); }
    $$('.wr').forEach(r => r.classList.toggle('on', r.dataset.sym === sym));
    $$('.hm-t').forEach(r => r.classList.toggle('on', r.dataset.sym === sym));
    const row = $(`.wr[data-sym="${CSS.escape(sym)}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
    renderQuote(); renderTicket(); loadStats(sym); if (changed) { loadChart(); loadTrades(); }
  }

  // ---------------------------------------------------------------- chart: candles of the share this token tracks
  $('#rg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setRange(b.dataset.r); });
  function setRange(r) { S.range = r; $$('#rg button').forEach(x => x.classList.toggle('on', x.dataset.r === r)); loadChart(); }
  let chartKey = '';
  async function loadChart() {
    const sym = S.sym, r = S.range, key = sym + r; chartKey = key;
    $('#chart').innerHTML = '<div class="msg">loading the chart…</div>'; $('#ohlc').textContent = ''; $('#chLbl').textContent = '';
    try { const c = await api('chart', { sym, r }); if (chartKey !== key) return; S.chart = c; if (r === '1D') DAY[sym] = { lo: Math.min(...c.pts.map(p => p[3])), hi: Math.max(...c.pts.map(p => p[2])), prev: c.prev }; drawChart(); renderQuote(); }
    catch (e) { if (chartKey !== key) return; S.chart = null; $('#chart').innerHTML = `<div class="msg">no chart for ${esc(sym)} right now.<br>the price above is still live.</div>`; }
  }
  const tl = (t, r) => { const d = new Date(t); return r === '1D' ? d.toISOString().slice(11, 16) : r === '1W' ? d.toUTCString().slice(0, 3) + ' ' + d.toISOString().slice(11, 16) : d.toISOString().slice(5, 10); };
  function drawChart() { drawCandles(S.chart, $('#chart'), S.range, $('#ohlc'), $('#chLbl')); }
  function drawCandles(c, box, range, ohlcEl, lblEl) {
    if (!c || !box) return;
    const W = Math.max(200, box.clientWidth), H = Math.max(120, box.clientHeight);
    lblEl.textContent = c.label;
    const P = c.pts, n = P.length, pad = { l: 6, r: 62, t: 12, b: 20 }, vh = Math.round((H - pad.t - pad.b) * 0.18);
    const ph = H - pad.t - pad.b - vh - 6;
    let lo = Infinity, hi = -Infinity, vmax = 1;
    for (const p of P) { lo = Math.min(lo, p[3]); hi = Math.max(hi, p[2]); vmax = Math.max(vmax, p[5] || 0); }
    if (range === '1D' && c.prev) { lo = Math.min(lo, c.prev); hi = Math.max(hi, c.prev); }
    const sp = (hi - lo) || hi * 0.01; lo -= sp * 0.06; hi += sp * 0.06;
    const cw = (W - pad.l - pad.r) / n, bw = Math.max(1, Math.min(9, cw * 0.62));
    const X = i => pad.l + cw * (i + 0.5), Y = v => pad.t + ph * (1 - (v - lo) / (hi - lo));
    const vy0 = pad.t + ph + 6 + vh;
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g += `<line x1="${pad.l}" x2="${W - pad.r + 4}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#efe7f2" stroke-dasharray="2 4"/><text x="${W - pad.r + 8}" y="${(y + 4).toFixed(1)}" fill="#9a90b5" font-size="10.5" font-family="JBM,monospace">${v >= 10000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : px(v)}</text>`; }
    for (let k = 0; k < 5; k++) { const i = Math.min(n - 1, Math.round((n - 1) * k / 4)); g += `<text x="${Math.min(W - pad.r - 40, Math.max(pad.l, X(i) - 18)).toFixed(1)}" y="${H - 5}" fill="#9a90b5" font-size="10.5" font-family="JBM,monospace">${esc(tl(P[i][0], range))}</text>`; }
    let cand = '', vol = '';
    for (let i = 0; i < n; i++) {
      const [t, o, h, l, cl, v] = P[i], up = cl >= o, col = up ? '#1f9e66' : '#d6416a', x = X(i);
      cand += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(h).toFixed(1)}" y2="${Y(l).toFixed(1)}" stroke="${col}" stroke-width="1"/>`;
      const y0 = Y(Math.max(o, cl)), y1 = Y(Math.min(o, cl));
      cand += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y1 - y0).toFixed(1)}" fill="${up ? col : col}" fill-opacity="${up ? 0.9 : 0.9}"/>`;
      if (v) { const hgt = Math.max(1, vh * v / vmax); vol += `<rect x="${(x - bw / 2).toFixed(1)}" y="${(vy0 - hgt).toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${col}" fill-opacity=".28"/>`; }
    }
    const last = P[n - 1][4], ly = Y(last), lastUp = last >= (range === '1D' && c.prev ? c.prev : P[0][1]);
    const prevL = range === '1D' && c.prev ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(c.prev).toFixed(1)}" y2="${Y(c.prev).toFixed(1)}" stroke="#8a80a6" stroke-opacity=".4" stroke-dasharray="4 4"/><text x="${pad.l + 4}" y="${(Y(c.prev) - 4).toFixed(1)}" fill="#9a90b5" font-size="10" font-family="JBM,monospace">prev close ${px(c.prev)}</text>` : '';
    const lastTag = `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${lastUp ? '#1f9e66' : '#d6416a'}" stroke-opacity=".5" stroke-dasharray="1 3"/><rect x="${W - pad.r + 2}" y="${(ly - 9).toFixed(1)}" width="${pad.r - 4}" height="18" fill="${lastUp ? '#1f9e66' : '#d6416a'}"/><text x="${W - pad.r + 7}" y="${(ly + 4).toFixed(1)}" fill="#ffffff" font-size="10.5" font-weight="700" font-family="JBM,monospace">${px(last)}</text>`;
    const dk = (c.sym || '') + range; const sweep = !still && box.dataset.k !== dk; box.dataset.k = dk;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"${sweep ? ' class="drawin"' : ''}>${g}${prevL}${vol}${cand}${lastTag}<line id="cx" y1="${pad.t}" y2="${H - pad.b}" stroke="#8a80a6" stroke-opacity=".5" stroke-dasharray="3 3" visibility="hidden"/><line id="cy" x1="${pad.l}" x2="${W - pad.r}" stroke="#8a80a6" stroke-opacity=".5" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
    const svg = box.querySelector('svg'), cx = svg.querySelector('#cx'), cy = svg.querySelector('#cy');
    const oh = i => { const [t, o, h, l, cl, v] = P[i]; ohlcEl.innerHTML = `${esc(tl(t, range))} O <b>${px(o)}</b> H <b>${px(h)}</b> L <b>${px(l)}</b> C <b class="${cl >= o ? 'up' : 'dn'}">${px(cl)}</b>${v ? ' V <b>' + int(v) + '</b>' : ''}`; };
    oh(n - 1);
    const move = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height; const i = Math.max(0, Math.min(n - 1, Math.floor((x - pad.l) / cw))); cx.setAttribute('x1', X(i)); cx.setAttribute('x2', X(i)); cx.setAttribute('visibility', 'visible'); cy.setAttribute('y1', y); cy.setAttribute('y2', y); cy.setAttribute('visibility', y < pad.t + ph ? 'visible' : 'hidden'); oh(i); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { cx.setAttribute('visibility', 'hidden'); cy.setAttribute('visibility', 'hidden'); oh(n - 1); });
  }
  let rzT = 0; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { drawChart(); if (S.view === 'perps') drawPerpChart(); if (S.view === 'overview' && OV.spy) drawCandles(OV.spy, $('#ovChart'), '1D', $('#ovOhlc'), $('#ovChLbl')); }, 120); });

  // ---------------------------------------------------------------- time & sales: real trades from the stock's deepest pool
  let tsKey = '';
  async function loadTrades(quiet) {
    const sym = S.sym; tsKey = sym;
    if (!quiet) { $('#tsb').innerHTML = '<div class="empty">reading the pool…</div>'; $('#tsPool').textContent = ''; }
    try {
      const j = await api('trades', { sym }); if (tsKey !== sym) return;
      S.trades = j; renderTrades();
    } catch (e) { if (tsKey !== sym) return; if (!S.trades) $('#tsb').innerHTML = `<div class="empty">no trade feed for ${esc(sym)} right now.</div>`; }
  }
  function renderTrades() {
    const j = S.trades; if (!j) return;
    $('#tsPool').textContent = (j.pool.name || '') + (j.pool.dex ? ' · ' + j.pool.dex.replace(/[-_]/g, ' ') : '');
    if (!j.trades.length) { $('#tsb').innerHTML = '<div class="empty">no trades in this pool yet.</div>'; return; }
    const fresh = S.tsSeen.size > 0;
    $('#tsb').innerHTML = `<div class="tsr h"><span>TIME UTC</span><span>SIDE</span><span class="r">SIZE</span><span class="r">VALUE</span><span class="r">PRICE</span></div>` + j.trades.map(t => {
      const n = fresh && !S.tsSeen.has(t.tx); S.tsSeen.add(t.tx);
      return `<div class="tsr${n ? ' new' : ''}"><a href="https://solscan.io/tx/${esc(t.tx)}" target="_blank" rel="noopener" title="view on Solscan">${hhmmss(t.t)}</a><span class="${t.side === 'buy' ? 'up' : 'dn'}">${t.side.toUpperCase()}</span><span class="r">${amt(t.amt, 4)}</span><span class="r">${usd(t.usd)}</span><span class="r">${px(t.px)}</span></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- order ticket
  const SOL_RESERVE = 0.015;
  const held = mint => S.bal && S.bal.tokens.find(t => t.mint === mint);
  const inSym = () => S.side === 'buy' ? S.cash : S.sym, outSym = () => S.side === 'buy' ? S.sym : S.cash;
  function balOf(sym) {
    if (!S.bal) return null;
    if (sym === 'SOL') return { ui: Math.max(0, S.bal.sol), raw: BigInt(S.bal.lamports || 0) };
    if (sym === 'USDC') { const t = S.bal.tokens.find(x => x.kind === 'cash'); return t ? { ui: t.amount, raw: BigInt(t.raw) } : { ui: 0, raw: 0n }; }
    const s = S.by[sym], t = s && held(s.mint); return t ? { ui: t.amount, raw: BigInt(t.raw) } : { ui: 0, raw: 0n };
  }
  function toRaw(str, dec) { if (!/^\d*\.?\d*$/.test(str) || str === '' || str === '.') return null; const [i, f = ''] = str.split('.'); const r = BigInt((i || '0') + (f + '0'.repeat(dec)).slice(0, dec)); return r > 0n ? r : null; }
  function rawIn() {
    const sym = inSym();
    if (sym === 'SOL') return toRaw(S.amt, 9);
    if (sym === 'USDC') return toRaw(S.amt, 6);
    const b = balOf(sym), s = stock();
    if (b && b.ui > 0 && b.raw > 0n) { const x = parseFloat(S.amt); if (!(x > 0)) return null; if (Math.abs(x - b.ui) <= b.ui * 1e-9) return b.raw; return BigInt(Math.floor(x / b.ui * Number(b.raw))); }
    return toRaw(S.amt, (s && s.decimals) || 8);
  }
  function insufficient() { const b = balOf(inSym()); if (!b || !WAL.W.addr) return false; const r = rawIn(); if (r == null) return false; if (inSym() === 'SOL') return Number(r) / 1e9 > b.ui - SOL_RESERVE; return r > b.raw; }
  const cashSel = id => `${lg(S.cash, S.cash === 'SOL' ? solIcon() : usdcIcon())}<select id="${id}" aria-label="Cash"><option ${S.cash === 'SOL' ? 'selected' : ''}>SOL</option><option ${S.cash === 'USDC' ? 'selected' : ''}>USDC</option></select>`;
  function renderTicket() {
    const s = stock(); if (!s) return;
    $$('#side2 button').forEach(b => b.classList.toggle('on', b.dataset.s === S.side));
    const st = `${lg(s.sym, s.icon)}${esc(s.sym)}`;
    $('#tokIn').innerHTML = S.side === 'buy' ? cashSel('cIn') : st;
    $('#tokOut').innerHTML = S.side === 'buy' ? st : cashSel('cOut');
    const sel = $('#cIn') || $('#cOut'); if (sel) sel.onchange = e => { S.cash = e.target.value; resetQuote(); renderTicket(); if (rawIn() != null) onAmount(); };
    const bi = balOf(inSym());
    $('#balIn').innerHTML = WAL.W.addr && bi ? `<span>bal ${amt(bi.ui)} ${esc(inSym())}</span><span><button data-max=".25">25%</button><button data-max=".5">50%</button><button data-max="1">max</button></span>` : '';
    $('#ackRow').hidden = store.get('markets.ack') === '1' || !WAL.W.addr;
    renderQ();
  }
  function renderQ() {
    const s = stock(); if (!s) return;
    const q = S.quote, x = parseFloat(S.amt), o = $('#outAmt');
    if (q && !q.error) { o.textContent = amt(q.outUi); o.classList.remove('wait'); } else { o.textContent = S.quoting ? '…' : '0.00'; o.classList.add('wait'); }
    const pin = inSym() === S.sym ? s.rawUsd : cashUsd(inSym());
    let d = `<div><span>VALUE</span><span>${x > 0 && pin ? '≈ ' + usd(x * pin) : '—'}</span></div>`;
    if (q && !q.error) {
      const rate = q.outUi > 0 ? (S.side === 'buy' ? q.inUi / q.outUi : q.outUi / q.inUi) : null;
      const imp = Math.max(q.impact || 0, 0), loss = q.inUsd && q.outUsd ? Math.max(0, (q.inUsd - q.outUsd) / q.inUsd) : 0;
      d += `<div><span>PRICE</span><span>1 ${esc(s.sym)} = ${amt(rate, 6)} ${esc(S.cash)}</span></div>`;
      d += `<div class="${imp > 0.1 ? 'bad' : imp > 0.02 ? 'warn' : ''}"><span>IMPACT</span><span>${(imp * 100).toFixed(imp < 0.001 ? 3 : 2)}%</span></div>`;
      if (loss > 0.03) d += `<div class="${loss > 0.1 ? 'bad' : 'warn'}"><span>VS MARKET</span><span>−${(loss * 100).toFixed(1)}%</span></div>`;
      d += `<div><span>MIN GET</span><span>${amt(q.minUi)} ${esc(outSym())}</span></div>`;
      if (q.route && q.route.length) d += `<div><span>ROUTE</span><span>${esc([...new Set(q.route)].slice(0, 3).join(' → '))}</span></div>`;
    }
    d += `<div><span>SLIPPAGE</span><span class="slip" id="slip">${[50, 100, 200].map(v => `<button data-sl="${v}" class="${S.slip === v ? 'on' : ''}">${v / 100}%</button>`).join('')}</span></div>`;
    $('#det').innerHTML = d;
    const go = $('#go'); go.classList.toggle('sell', S.side === 'sell');
    const ack = store.get('markets.ack') === '1' || $('#ack').checked;
    const imp = q && !q.error ? Math.max(q.impact || 0, q.inUsd && q.outUsd ? (q.inUsd - q.outUsd) / q.inUsd : 0) : 0;
    let t = '', on = false;
    if (S.busy) t = 'WORKING…';
    else if (!WAL.W.addr) { t = 'CONNECT WALLET'; on = true; }
    else if (!(x > 0)) t = 'ENTER AN AMOUNT';
    else if (insufficient()) t = 'NOT ENOUGH ' + inSym();
    else if (q && q.error) t = q.error.toUpperCase();
    else if (!q) t = 'GETTING THE BEST PRICE…';
    else if (imp > 0.15) t = 'PRICE IMPACT TOO HIGH';
    else if (!ack) t = 'TICK THE BOX ABOVE';
    else { t = `${S.side === 'buy' ? 'BUY' : 'SELL'} ${s.sym}`; on = true; }
    go.textContent = t; go.disabled = !on;
  }
  function resetQuote() { S.quote = null; S.qid++; S.quoting = false; }
  let qT = 0;
  function onAmount() { resetQuote(); clearTimeout(qT); if (rawIn() != null) { S.quoting = true; qT = setTimeout(getQuote, 360); } renderQ(); }
  async function getQuote() {
    const raw = rawIn(); if (raw == null) { S.quoting = false; renderQ(); return; }
    const id = ++S.qid; S.quoting = true;
    try { const q = await api('quote', { in: inSym(), out: outSym(), amt: raw.toString(), slip: S.slip }); if (id !== S.qid) return; S.quote = q; S.quoteAt = Date.now(); }
    catch (e) { if (id !== S.qid) return; S.quote = { error: e.message }; }
    S.quoting = false; renderQ();
  }
  setInterval(() => { if (S.view === 'trade' && S.quote && !S.quote.error && !S.busy && !document.hidden && Date.now() - S.quoteAt > 15000) getQuote(); }, 2500);
  function setAmount(v) { S.amt = v; $('#amt').value = v; onAmount(); }
  $('#amt').addEventListener('input', e => { let v = e.target.value.replace(',', '.').replace(/[^\d.]/g, ''); const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); if (v !== e.target.value) e.target.value = v; S.amt = v; onAmount(); });
  function setSide(sd) { if (S.side === sd) return; S.side = sd; S.amt = ''; $('#amt').value = ''; resetQuote(); renderTicket(); }
  $('#side2').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setSide(b.dataset.s); });
  function maxOf(f) { const b = balOf(inSym()); if (!b) return null; let v = b.ui * f; if (inSym() === 'SOL') v = Math.max(0, Math.min(v, b.ui - SOL_RESERVE)); if (f === 1 && inSym() === S.sym) return String(b.ui); return v > 0 ? v.toFixed(inSym() === 'USDC' ? 2 : 6).replace(/\.?0+$/, '') : '0'; }
  $('#tkt').addEventListener('click', e => {
    const m = e.target.closest('[data-max]'); if (m) { const v = maxOf(+m.dataset.max); if (v != null) setAmount(v); return; }
    const sl = e.target.closest('[data-sl]'); if (sl) { S.slip = +sl.dataset.sl; if (S.quote && !S.quote.error) getQuote(); renderQ(); }
  });
  $('#ack').addEventListener('change', e => { if (e.target.checked) store.set('markets.ack', '1'); renderQ(); });
  $('#go').addEventListener('click', () => { if (!WAL.W.addr) return openWallet(); execute(); });

  const log = (h, k) => { const l = $('#log'); const d = document.createElement('div'); if (k) d.className = k; d.innerHTML = h; l.appendChild(d); while (l.children.length > 6) l.firstChild.remove(); l.scrollTop = l.scrollHeight; return d; };
  async function execute() {
    const s = stock(); if (!s || S.busy) return;
    S.busy = true; renderQ(); $('#log').innerHTML = '';
    let line;
    try {
      if (!S.quote || S.quote.error || Date.now() - S.quoteAt > 10000) { line = log('refreshing the price<span class="spin"></span>'); await getQuote(); line.innerHTML = 'price refreshed'; }
      if (!S.quote || S.quote.error) throw new Error((S.quote && S.quote.error) || 'no price right now');
      const q = S.quote, side = S.side, cash = S.cash;
      line = log('building the swap<span class="spin"></span>');
      const sw = await post('swap', { quote: q.quote, user: WAL.W.addr }); line.innerHTML = 'swap built by jupiter';
      line = log('confirm in your wallet<span class="spin"></span>');
      const sig = await WAL.signAndSend(sw.tx, async b64 => (await post('send', { tx: b64 })).sig);
      const link = `<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">${short(sig)} ↗</a>`;
      line.innerHTML = 'signed · sent ' + link;
      line = log('waiting for solana<span class="spin"></span>');
      const st = await waitSig(sig);
      if (st === 'failed') { line.className = 'err'; line.innerHTML = 'failed on-chain, nothing was swapped ' + link; }
      else if (st === 'unknown') { line.innerHTML = 'not confirmed yet, if it never lands nothing is spent ' + link; }
      else { line.className = 'ok'; line.innerHTML = `${side === 'buy' ? 'bought' : 'sold'} ${amt(side === 'buy' ? q.outUi : q.inUi)} ${esc(s.sym)} for ${amt(side === 'buy' ? q.inUi : q.outUi)} ${esc(cash)} ${link}`; toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${s.sym}`); }
      S.amt = ''; $('#amt').value = ''; resetQuote();
      setTimeout(refreshBal, 1200); setTimeout(refreshBal, 6000); setTimeout(() => loadTrades(true), 4000);
    } catch (e) { if (line) { line.className = 'err'; line.textContent = e.message; } else log(esc(e.message), 'err'); }
    S.busy = false; renderQ();
  }
  async function waitSig(sig) { for (let k = 0; k < 50; k++) { try { const s = await api('status', { sig }); if (s.status === 'failed') return 'failed'; if (s.status === 'confirmed' || s.status === 'finalized') return 'ok'; } catch { } await sleep(1500); } return 'unknown'; }

  // ---------------------------------------------------------------- wallet + account
  function openWallet() {
    const inst = WAL.installed().map(w => w.name);
    $('#wlist').innerHTML = WAL.WALLETS.map(w => `<button class="wl2" data-w="${w.name}"><i style="background:${w.color}">${w.name[0]}</i>${w.name.toLowerCase()}<small>${inst.includes(w.name) ? 'detected' : WAL.mobile && w.ul ? 'open in app' : 'get it ↗'}</small></button>`).join('');
    $('#wsheet').classList.add('on');
  }
  $('#wlist').addEventListener('click', async e => { const b = e.target.closest('[data-w]'); if (!b) return; try { const a = await WAL.connect(b.dataset.w); if (a) { closeSheets(); toast('connected ' + short(a)); } } catch (err) { toast(WAL.isReject(err) ? 'connection cancelled' : (err.message || 'could not connect')); } });
  const closeSheets = () => $$('.sheet').forEach(s => s.classList.remove('on'));
  $$('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-close]')) closeSheets(); }));
  document.addEventListener('click', e => { if (e.target.closest('[data-connect]')) openWallet(); });
  WAL.on(w => {
    $('#wslot').innerHTML = w.addr ? `<span class="who"><span class="ad">${short(w.addr)}</span><button class="kb" id="dc" title="Disconnect" aria-label="Disconnect">×</button></span>` : `<button class="kb hot" data-connect>Connect wallet</button>`;
    const dc = $('#dc'); if (dc) dc.onclick = () => { WAL.disconnect(); S.bal = null; renderAll(); };
    S.bal = null; if (w.addr) refreshBal(); renderAll();
    if (S.view === 'perps') { loadPositions(); perpQuoteSoon(); }
  });
  async function refreshBal() {
    const a = WAL.W.addr; if (!a) return;
    try { const [b] = await Promise.all([api('wallet', { addr: a }), api('ppos', { addr: a }).then(j => { P2.pos = j.positions; }).catch(() => { })]); if (a !== WAL.W.addr) return; S.bal = b; S.balAt = Date.now(); S.balErr = null; } catch (e) { S.balErr = e.message; }
    renderAccount(); renderTicket(); if (S.view === 'portfolio') renderPortfolio();
  }
  function totals() {
    const B = S.bal, st = B.tokens.filter(t => ['stock', 'etf', 'metal', 'city'].includes(t.kind)), cash = B.tokens.filter(t => t.kind === 'cash'), oth = B.tokens.filter(t => t.kind === 'token' && t.value != null && t.value >= 0.01);
    const vS = st.reduce((a, t) => a + (t.value || 0), 0), vC = (B.solValue || 0) + cash.reduce((a, t) => a + (t.value || 0), 0), vO = oth.reduce((a, t) => a + (t.value || 0), 0);
    const day = st.reduce((a, t) => a + (t.value != null && t.ch24 != null ? t.value - t.value / (1 + t.ch24 / 100) : 0), 0) + (B.solValue && B.solCh24 != null ? B.solValue - B.solValue / (1 + B.solCh24 / 100) : 0);
    const pp = (P2.pos || []), vP = pp.reduce((a, p) => a + (p.value != null ? p.value : (p.coll || 0) + (p.pnl || 0)), 0);
    return { st, cash, oth, pp, vS, vC, vO, vP, tot: vS + vC + vO + vP, day };
  }
  function renderAccount() {
    const a = $('#acc');
    if (!WAL.W.addr) { $('#accR').textContent = ''; a.innerHTML = `<div class="mute">No wallet connected.</div><div class="sub" style="font-size:12px">Connect Phantom, Solflare or Backpack. Your keys never leave your wallet.</div><div><button class="kb hot" data-connect>Connect wallet</button></div>`; return; }
    $('#accR').innerHTML = `<a class="mute" style="text-transform:none;letter-spacing:0" href="https://solscan.io/account/${esc(WAL.W.addr)}" target="_blank" rel="noopener">${short(WAL.W.addr)} ↗</a>`;
    if (!S.bal) { a.innerHTML = `<div class="mute">${S.balErr ? 'could not read the wallet: ' + esc(S.balErr) : 'Reading your wallet<span class="spin"></span>'}</div>`; return; }
    const T = totals(), B = S.bal;
    const seg = (v, c) => T.tot > 0 && v > 0 ? `<i style="width:${(v / T.tot * 100).toFixed(2)}%;background:${c}"></i>` : '';
    a.innerHTML = `<div><div class="lbl">NET WORTH</div><div class="nw">${usd(T.tot)}</div><div class="${cls(T.day)}" style="font-size:11.5px">${T.day >= 0 ? '+' : '−'}${usd(Math.abs(T.day))} today</div></div>
      <div class="bar2">${seg(T.vS, '#6b4a9e')}${seg(T.vP, '#1f9e66')}${seg(T.vC, '#b9a7e2')}${seg(T.vO, '#e9a0bf')}</div>
      ${T.pp.length ? `<div class="ln" data-perps="1">${lg('PERP', null, 'm')}<div><b>PERPS</b><small>${T.pp.length} open</small></div><div class="r">${usd(T.vP)}<small class="${cls(T.pp.reduce((a, p) => a + (p.pnl || 0), 0))}">${(t => (t >= 0 ? '+' : '−') + usd(Math.abs(t)))(T.pp.reduce((a, p) => a + (p.pnl || 0), 0))} pnl</small></div></div>` : ''}
      <div>${[['SOL', B.solIcon, amt(B.sol, 4), B.solValue, B.solCh24]].concat(T.cash.map(t => ['USDC', t.icon, amt(t.amount, 2), t.value, null])).concat(T.st.map(t => [t.sym, t.icon, amt(t.amount), t.value, t.ch24])).map(([sy, ic, am, v, ch]) => `<div class="ln" data-sym="${esc(sy)}">${lg(sy, ic, 'm')}<div><b>${esc(sy)}</b><small>${am}</small></div><div class="r">${usd(v)}<small class="${cls(ch)}">${ch == null ? '' : pc(ch)}</small></div></div>`).join('')}</div>
      ${T.st.length ? '' : '<div class="mute" style="font-size:11.5px">No stocks yet. The city is waiting.</div>'}`;
  }
  $('#acc').addEventListener('click', e => { if (e.target.closest('[data-perps]')) { location.hash = '#perps'; return; } const r = e.target.closest('.ln[data-sym]'); if (r && S.by[r.dataset.sym]) pick(r.dataset.sym); });

  // ---------------------------------------------------------------- screener
  function renderMarkets() {
    if (!S.P) return;
    const L0 = S.P.stocks, deep = L0.filter(s => !s.thin).length;
    $('#mkLead').textContent = `${L0.length} stocks, ETFs and metals on Solana · ${deep} with deep markets · prices live from Jupiter`;
    const q = S.mq.trim().toLowerCase();
    let L = L0.filter(s => (S.mk === 'all' || s.kind === S.mk) && (!q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
    const key = { px: s => s.usd, ch: s => s.ch24, liq: s => s.liq, hd: s => s.holders, mc: s => s.mcap, vol: s => s.vol24 }[S.ms];
    if (S.ms === 'sym') L.sort((a, b) => a.sym.localeCompare(b.sym) * -S.md); else L.sort((a, b) => (a.thin - b.thin) || (((key(a) == null ? -Infinity : key(a)) - (key(b) == null ? -Infinity : key(b))) * S.md));
    const th = (k, t) => `<button data-sort="${k}" class="${S.ms === k ? 'on' : ''}">${t}${S.ms === k ? (S.md < 0 ? '↓' : '↑') : ''}</button>`;
    $('#mkTbl').innerHTML = `<div class="tr th"><span>SYMBOL</span><span>NAME</span><span>KIND</span><span class="r">${th('px', 'LAST')}</span><span class="r">${th('ch', '24H')}</span><span class="r">${th('liq', 'DEPTH')}</span><span class="r">${th('vol', 'VOL 24H')}</span><span class="r">${th('hd', 'HOLDERS')}</span><span class="r">${th('mc', 'MCAP')}</span><span></span></div>` +
      (L.map(s => `<div class="tr${s.thin ? ' thin' : ''}" data-sym="${esc(s.sym)}"><span>${lg(s.sym, s.icon)} <b>${esc(s.sym)}</b></span><span class="nmc">${esc(s.name)}</span><span class="mute">${esc(s.kind)}</span><span class="r">${s.thin ? 'thin' : px(s.usd)}</span><span class="r ${cls(s.ch24)}">${s.thin ? '—' : pc(s.ch24)}</span><span class="r">${big(s.liq)}</span><span class="r">${big(s.vol24)}</span><span class="r">${int(s.holders)}</span><span class="r">${big(s.mcap)}</span><span class="go2">Trade →</span></div>`).join('') || '<div class="empty">no match.</div>');
  }
  $('#mkq').addEventListener('input', e => { S.mq = e.target.value; renderMarkets(); });
  $('#mkKind').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.mk = b.dataset.k; $$('#mkKind button').forEach(x => x.classList.toggle('on', x === b)); renderMarkets(); });
  $('#mkTbl').addEventListener('click', e => { const s = e.target.closest('[data-sort]'); if (s) { const k = s.dataset.sort; if (S.ms === k) S.md *= -1; else { S.ms = k; S.md = -1; } renderMarkets(); return; } const r = e.target.closest('.tr[data-sym]'); if (r) pick(r.dataset.sym); });

  // ---------------------------------------------------------------- portfolio
  function renderPortfolio() {
    const pf = $('#pf');
    if (!WAL.W.addr) { pf.innerHTML = `<h1>Portfolio</h1><div class="lead">Your empire, priced live from the chain.</div><div class="pn" style="padding:22px"><div class="mute">No wallet connected.</div><div style="margin-top:12px"><button class="kb hot" data-connect>Connect wallet</button></div></div>`; return; }
    if (!S.bal) { pf.innerHTML = `<h1>Portfolio</h1><div class="lead">${S.balErr ? 'Could not read the wallet: ' + esc(S.balErr) : 'Reading your wallet<span class="spin"></span>'}</div>`; return; }
    const T = totals(), B = S.bal;
    const seg = (v, c) => T.tot > 0 && v > 0 ? `<i style="width:${(v / T.tot * 100).toFixed(2)}%;background:${c}"></i>` : '';
    const row = t => `<div class="tr" data-sym="${esc(t.sym)}" style="grid-template-columns:minmax(150px,1.2fr) minmax(150px,1.6fr) 120px 110px 110px 92px 70px"><span>${lg(t.sym, t.icon)} <b>${esc(t.sym)}</b></span><span class="nmc">${esc(t.name)}</span><span class="r">${amt(t.amount)}</span><span class="r">${usd(t.price)}</span><span class="r"><b>${usd(t.value)}</b></span><span class="r ${cls(t.ch24)}">${pc(t.ch24)}</span><span class="go2">${S.by[t.sym] ? 'Trade →' : ''}</span></div>`;
    const head = `<div class="tr th" style="grid-template-columns:minmax(150px,1.2fr) minmax(150px,1.6fr) 120px 110px 110px 92px 70px"><span>SYMBOL</span><span>NAME</span><span class="r">AMOUNT</span><span class="r">PRICE</span><span class="r">VALUE</span><span class="r">24H</span><span></span></div>`;
    pf.innerHTML = `<h1>Portfolio</h1><div class="lead"><a class="sub" href="https://solscan.io/account/${esc(B.wallet)}" target="_blank" rel="noopener">${short(B.wallet)} ↗</a> · <button class="sub" id="pfr" style="text-decoration:underline">refresh</button></div>
      <div class="pf-top"><div class="pn"><div class="lbl">NET WORTH</div><div class="big">${usd(T.tot)}</div><div class="${cls(T.day)}">${T.day >= 0 ? '+' : '−'}${usd(Math.abs(T.day))} today</div><div class="bar2" style="margin-top:12px">${seg(T.vS, '#6b4a9e')}${seg(T.vP, '#1f9e66')}${seg(T.vC, '#b9a7e2')}${seg(T.vO, '#e9a0bf')}</div><div class="legend"><span><i style="background:#6b4a9e"></i>stocks &amp; city ${usd(T.vS)}</span><span><i style="background:#1f9e66"></i>perps ${usd(T.vP)}</span><span><i style="background:#b9a7e2"></i>cash ${usd(T.vC)}</span><span><i style="background:#e9a0bf"></i>other ${usd(T.vO)}</span></div></div>
      <div class="pn"><div class="lbl">CASH</div><div style="display:grid;gap:8px;margin-top:10px"><div>${lg('SOL', B.solIcon, 'm')} <b>${amt(B.sol, 4)} SOL</b> <span class="mute">${usd(B.solValue)}</span></div>${(T.cash.length ? T.cash : [{ amount: 0, value: 0, icon: usdcIcon() }]).map(t => `<div>${lg('USDC', t.icon, 'm')} <b>${amt(t.amount, 2)} USDC</b> <span class="mute">${usd(t.value)}</span></div>`).join('')}</div></div></div>
      ${T.pp.length ? `<div class="lbl" style="margin:14px 0 6px">PERPS · ${T.pp.length} OPEN · <a href="#perps" style="color:var(--acc)">manage →</a></div><div class="scroll-x"><div class="tbl" style="min-width:760px"><div class="tr th" style="grid-template-columns:150px 100px 110px 110px 110px 1fr"><span>MARKET</span><span class="r">SIZE</span><span class="r">ENTRY</span><span class="r">MARK</span><span class="r">LIQ</span><span class="r">PNL</span></div>${T.pp.map(p => `<div class="tr" style="grid-template-columns:150px 100px 110px 110px 110px 1fr" onclick="location.hash='#perps'"><span><b class="${p.side === 'long' ? 'up' : 'dn'}">${esc(p.asset)} ${p.side === 'long' ? 'LONG' : 'SHORT'}</b> <span class="mute">${p.lev ? p.lev.toFixed(1) + 'x' : ''}</span></span><span class="r">${usd(p.size)}</span><span class="r">${usd(p.entry)}</span><span class="r">${usd(p.mark)}</span><span class="r dn">${usd(p.liq)}</span><span class="r ${cls(p.pnl)}">${p.pnl >= 0 ? '+' : '−'}${usd(Math.abs(p.pnl || 0))} <span class="mute">${pc(p.pnlPct)}</span></span></div>`).join('')}</div></div>` : ''}
      <div class="lbl" style="margin:14px 0 6px">STOCKS &amp; CITY · ${T.st.length}</div>
      <div class="scroll-x"><div class="tbl" style="min-width:760px">${T.st.length ? head + T.st.map(row).join('') : '<div class="empty">No stocks yet. The city is waiting. <a href="#markets" style="color:var(--acc)">browse markets →</a></div>'}</div></div>
      ${T.oth.length ? `<div class="lbl" style="margin:14px 0 6px">OTHER TOKENS · ${T.oth.length}</div><div class="scroll-x"><div class="tbl" style="min-width:760px">${head + T.oth.slice(0, 30).map(row).join('')}</div></div>` : ''}`;
    const r = $('#pfr'); if (r) r.onclick = () => { r.textContent = 'refreshing…'; refreshBal(); };
    pf.querySelectorAll('.tr[data-sym]').forEach(n => n.onclick = () => { if (S.by[n.dataset.sym]) pick(n.dataset.sym); });
  }

  // ---------------------------------------------------------------- command line
  const cmd = $('#cmd');
  let outT = 0;
  function cmdOut(t, k) { const o = $('#cmdOut'); o.textContent = t; o.className = 'out ' + (k || ''); clearTimeout(outT); outT = setTimeout(() => { o.textContent = ''; }, 9000); }
  const findSym = w => { if (!w || !S.P) return null; const u = w.toUpperCase().replace(/X$/, ''); if (S.by[u]) return u; if (S.by[w.toUpperCase()]) return w.toUpperCase(); const n = S.P.stocks.find(s => s.name.toLowerCase().startsWith(w.toLowerCase()) || s.tok.toUpperCase() === w.toUpperCase()); return n ? n.sym : null; };
  const HELP = 'overview · buy <sym> <amt> [sol|usdc] · sell <sym> <amt|all|50%> · long|short <sol|btc|eth> <usdc> <lev>x · chart <sym> [1d…1y] · find <text> · city · claim <asset> · perps · portfolio · docs · connect';
  function run(line) {
    const w = line.trim().split(/\s+/).filter(Boolean); if (!w.length) return;
    const c = w[0].toLowerCase();
    if (c === 'help' || c === '?') return cmdOut(HELP);
    if (c === 'clear') { $('#log').innerHTML = ''; return cmdOut(''); }
    if (c === 'connect') { openWallet(); return cmdOut('pick a wallet'); }
    if (c === 'disconnect') { WAL.disconnect(); return cmdOut('disconnected', 'ok'); }
    if (c === 'search' || c === 'k') { skOpen(); return cmdOut('search', 'ok'); }
    if (c === 'overview' || c === 'home' || c === 'ov') { location.hash = '#overview'; return cmdOut('market overview', 'ok'); }
    if (c === 'markets' || c === 'ls') { location.hash = '#markets'; return cmdOut('all stocks', 'ok'); }
    if (c === 'portfolio' || c === 'pf') { location.hash = '#portfolio'; return cmdOut('your portfolio', 'ok'); }
    if (c === 'city') { location.hash = '#city'; return cmdOut('the city', 'ok'); }
    if (c === 'perps' || c === 'perp') { location.hash = '#perps'; return cmdOut('the perps desk', 'ok'); }
    if (c === 'long' || c === 'short') { const a = (w[1] || 'sol').toUpperCase(); if (!['SOL', 'BTC', 'ETH'].includes(a)) return cmdOut('perps: sol, btc or eth', 'err'); location.hash = '#perps'; P2.a = a; P2.side = c; if (w[2] && /^\d*\.?\d+$/.test(w[2])) { P2.amt = w[2]; $('#pamt').value = w[2]; } const lv = (w[3] || '').replace(/x$/i, ''); if (lv && +lv >= 1.1 && +lv <= 100) { P2.lev = +lv; $('#plev').value = lv; } setTimeout(() => { renderPerpMarkets && P2.mk && renderPerpMarkets(); renderPerpHead(); perpQuoteSoon(); loadPerpChart(); }, 50); return cmdOut(`${c} ${a}${w[2] ? ' · ' + w[2] + ' ' + P2.input : ''}${lv ? ' · ' + lv + 'x' : ''} · press the button to sign`, 'ok'); }
    if (c === 'docs' || c === 'man') { location.hash = '#docs'; return cmdOut('the docs', 'ok'); }
    if (c === 'claim') { location.hash = '#city'; const id = (w[1] || '').toLowerCase(); setTimeout(() => { const it = S.city && S.city.items.find(i => i.id === id || i.sym.toLowerCase() === id); if (it) openClaim(it.id); }, 400); return cmdOut(id ? 'claim ' + id : 'pick an open asset to claim', 'ok'); }
    if (c === 'find' || c === 'grep') { S.wq = w.slice(1).join(' '); $('#wlq').value = S.wq; show('trade'); renderWatch(); return cmdOut(`filter: ${S.wq || 'none'}`, 'ok'); }
    if (c === 'chart') { const s = findSym(w[1]); if (!s) return cmdOut('unknown stock: ' + (w[1] || ''), 'err'); pick(s); const r = (w[2] || '').toUpperCase(); if (['1D', '1W', '1M', '6M', '1Y'].includes(r)) setRange(r); return cmdOut(`chart ${s} ${S.range}`, 'ok'); }
    if (c === 'buy' || c === 'sell') {
      const s = findSym(w[1]); if (!s) return cmdOut('unknown stock: ' + (w[1] || '') + ' · try: ' + c + ' nvda 0.5', 'err');
      pick(s); setSide(c);
      const cashW = (w[3] || '').toUpperCase(); if (cashW === 'SOL' || cashW === 'USDC') { S.cash = cashW; renderTicket(); }
      let a = (w[2] || '').toLowerCase();
      if (c === 'sell' && (a === 'all' || a === 'max' || /%$/.test(a))) { if (!WAL.W.addr) { openWallet(); return cmdOut('connect a wallet to sell', 'err'); } const f = a === 'all' || a === 'max' ? 1 : Math.min(100, parseFloat(a)) / 100; const v = maxOf(f); if (!v || v === '0') return cmdOut('you hold no ' + s, 'err'); a = v; }
      if (a && !/^\d*\.?\d+$/.test(a)) return cmdOut('amount must be a number', 'err');
      if (a) setAmount(a);
      $('#go').focus();
      return cmdOut(`ticket ready: ${c} ${s}${a ? ' · ' + a + ' ' + (c === 'buy' ? S.cash : s) : ''} · press enter to sign`, 'ok');
    }
    const s = findSym(w[0]); if (s) { pick(s); return cmdOut(`${s} · ${S.by[s].name}`, 'ok'); }
    cmdOut(`command not found: ${c} · type help`, 'err');
  }
  const hist = []; let hi = -1;
  cmd.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const v = cmd.value; if (v.trim()) { hist.unshift(v); hist.length = Math.min(hist.length, 30); } hi = -1; cmd.value = ''; run(v); }
    else if (e.key === 'ArrowUp') { if (hist.length) { hi = Math.min(hist.length - 1, hi + 1); cmd.value = hist[hi]; e.preventDefault(); } }
    else if (e.key === 'ArrowDown') { hi = Math.max(-1, hi - 1); cmd.value = hi < 0 ? '' : hist[hi]; e.preventDefault(); }
    else if (e.key === 'Tab') { const p = cmd.value.split(' '), last = p[p.length - 1]; if (last && S.P) { const m = S.P.stocks.find(s => s.sym.toLowerCase().startsWith(last.toLowerCase())); if (m) { p[p.length - 1] = m.sym.toLowerCase(); cmd.value = p.join(' ') + ' '; } } e.preventDefault(); }
    else if (e.key === 'Escape') cmd.blur();
  });

  // ---------------------------------------------------------------- keys
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA'); };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeSheets(); return; }
    if (e.key === 'F2') { e.preventDefault(); show('trade'); $('#wlq').focus(); return; }
    if (e.key === 'F3' || e.key === 'F4') { e.preventDefault(); show('trade'); setSide(e.key === 'F3' ? 'buy' : 'sell'); $('#amt').focus(); return; }
    if (typing()) return;
    if (e.key === '/') { e.preventDefault(); cmd.focus(); return; }
    if (/^[1-7]$/.test(e.key)) { location.hash = ['#overview', '#trade', '#markets', '#city', '#perps', '#portfolio', '#docs'][+e.key - 1]; return; }
    if (S.view === 'perps' && (e.key === 'l' || e.key === 's')) { P2.side = e.key === 'l' ? 'long' : 'short'; perpQuoteSoon(); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.view === 'trade' && S.P) { e.preventDefault(); const L = wlList(), i = L.findIndex(s => s.sym === S.sym); const n = L[Math.max(0, Math.min(L.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) pick(n.sym); }
  });


  // ---------------------------------------------------------------- the city: real estate, businesses and rides, each a real coin
  const IT = window.MarketsItems;
  const iconCache = {};
  function cityIcon(c) { const k = c.id || c.sym; if (iconCache[k]) return iconCache[k]; const art = c.art || c.icon; return (iconCache[k] = IT && art && IT.ICON[art] ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(IT.tile({ cat: c.cat, icon: art }, 64, { r: 0 })) : null); }
  async function loadCity() {
    try { S.city = await api('city'); renderCity(); if (S.view === 'overview') renderOverview(); }
    catch (e) { if (!S.city) $('#cgrid').innerHTML = `<div class="empty">The city is not answering: ${esc(e.message)} <button class="kb" id="crt">Retry</button></div>`; const b = $('#crt'); if (b) b.onclick = loadCity; }
  }
  function renderCity() {
    const C = S.city; if (!C) return;
    const L = C.items.filter(i => (S.cc === 'all' || i.cat === S.cc) && (S.cs === 'all' || (S.cs === 'live' ? i.status === 'live' : i.status !== 'live')));
    const n = C.items.filter(i => i.status === 'live').length;
    $('#ctCount').textContent = `${n}/${C.items.length} founded`;
    $('#ctLead').textContent = C.registry ? 'Real estate, businesses and rides. Every one is a real coin on Solana: claim an open one to launch it and earn its creator fees, or buy into one that already has a founder.' : 'Real estate, businesses and rides, each one a real coin on Solana. Claiming opens as soon as the city registry is connected.';
    $('#cgrid').innerHTML = L.map(i => {
      const art = IT.tile(i, 300, { r: 0, slice: true });
      const st = i.status === 'live' ? 'FOUNDED' : i.status === 'pending' ? 'BEING FOUNDED' : 'OPEN';
      const body = i.status === 'live'
        ? `<div class="cs"><span>PRICE <b>${i.usd != null ? '$' + (i.usd < 0.01 ? i.usd.toPrecision(3) : px(i.usd)) : '—'}</b></span><span>24H <b class="${cls(i.ch24)}">${pc(i.ch24)}</b></span><span>MCAP <b>${big(i.mcap)}</b></span><span>HOLDERS <b>${int(i.holders)}</b></span><span style="grid-column:1/-1">FOUNDER <b>${short(i.founder)}</b></span></div>
           <div class="act"><button class="kb hot" data-trade="${esc(i.sym)}">Trade</button><a class="kb" style="display:grid;place-items:center" href="https://pump.fun/coin/${esc(i.mint)}" target="_blank" rel="noopener">pump.fun ↗</a></div>`
        : i.status === 'pending'
          ? `<div class="open-note">Someone is signing the launch right now. If they walk away it opens again in a few minutes.</div>`
          : `<div class="open-note">No founder yet. Claim it to launch $${esc(i.sym)} on pump.fun and earn its creator fees.</div><div class="act"><button class="kb hot" data-claim="${esc(i.id)}" ${C.registry ? '' : 'disabled title="opens when the registry is connected"'}>Claim it</button></div>`;
      return `<div class="ci ${i.status}" id="ci-${esc(i.id)}"><div class="art">${art}<span class="st">${st}</span><span class="cat">${esc(IT.CAT[i.cat])}</span></div><div class="cb"><div class="cn"><b>${esc(i.name)}</b><span>$${esc(i.sym)}</span></div><div class="cl">${esc(i.line)}</div>${body}</div></div>`;
    }).join('') || '<div class="empty">Nothing here with these filters.</div>';
    const focus = (location.hash.match(/^#city\/(\w+)/) || [])[1];
    if (focus) { const el = document.getElementById('ci-' + focus); if (el) { el.scrollIntoView({ block: 'center' }); el.style.borderColor = 'var(--acc)'; } }
  }
  $('#ctCat').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.cc = b.dataset.c; $$('#ctCat button').forEach(x => x.classList.toggle('on', x === b)); renderCity(); });
  $('#ctSt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.cs = b.dataset.s; $$('#ctSt button').forEach(x => x.classList.toggle('on', x === b)); renderCity(); });
  $('#cgrid').addEventListener('click', e => {
    const t = e.target.closest('[data-trade]'); if (t) { if (S.by[t.dataset.trade]) pick(t.dataset.trade); else { toast('opening the market…'); loadPrices().then(() => pick(t.dataset.trade)); } return; }
    const c = e.target.closest('[data-claim]'); if (c && !c.disabled) openClaim(c.dataset.claim);
  });

  let claiming = null;
  function openClaim(id) {
    const it = S.city && S.city.items.find(i => i.id === id); if (!it) return;
    if (it.status !== 'open') { toast('that one already has a founder'); return; }
    claiming = it;
    $('#clArt').innerHTML = IT.tile(it, 84, { r: 0 });
    $('#csh').textContent = 'found ' + it.name.toLowerCase();
    $('#clSub').innerHTML = `$${esc(it.sym)} · ${esc(IT.CAT[it.cat])}`;
    $('#clText').innerHTML = `You launch <b>$${esc(it.sym)}</b> on pump.fun from your own wallet and become its founder. pump.fun pays the founder creator fees on every trade of it, for as long as it trades. Anyone can then buy and sell it here. It is a memecoin named after a city asset, not a share of a real building or vehicle.`;
    $('#clLog').innerHTML = ''; renderClaimDet(); $('#csheet').classList.add('on');
  }
  function renderClaimDet() {
    const b = Math.max(0, Math.min(10, parseFloat($('#clBuy').value) || 0));
    $('#clDet').innerHTML = `<div><span>CREATE ON PUMP.FUN</span><span>≈ 0.02 SOL</span></div><div><span>YOUR FIRST BUY</span><span>${amt(b, 4)} SOL</span></div><div><span>NETWORK + PRIORITY</span><span>≈ 0.0005 SOL</span></div><div><span>YOU EARN</span><span class="up">creator fees on every trade</span></div>`;
    $('#clGo').textContent = WAL.W.addr ? `CLAIM $${claiming ? claiming.sym : ''}` : 'CONNECT WALLET';
  }
  $('#clBuy').addEventListener('input', e => { e.target.value = e.target.value.replace(',', '.').replace(/[^\d.]/g, ''); renderClaimDet(); });
  $('#clGo').addEventListener('click', async () => {
    if (!WAL.W.addr) return openWallet();
    const it = claiming; if (!it || $('#clGo').disabled) return;
    const buy = Math.max(0, Math.min(10, parseFloat($('#clBuy').value) || 0));
    if (S.bal && S.bal.sol < buy + 0.03) { toast(`you need about ${amt(buy + 0.03, 3)} SOL for this`); return; }
    const go = $('#clGo'), L = $('#clLog'); go.disabled = true; L.innerHTML = '';
    const say = (h, k) => { const d = document.createElement('div'); if (k) d.className = k; d.innerHTML = h; L.appendChild(d); return d; };
    let line;
    try {
      line = say('making the coin key in this browser<span class="spin"></span>');
      const W3 = await WAL.web3(); const kp = W3.Keypair.generate(); const mint = kp.publicKey.toBase58();
      line.innerHTML = 'coin address ' + short(mint);
      line = say('drawing the coin image<span class="spin"></span>'); const image = await IT.png(it, 512); line.innerHTML = 'coin image ready';
      line = say('reserving it and uploading to pump.fun<span class="spin"></span>');
      const c = await post('claim', { item: it.id, user: WAL.W.addr, mint, buy, image, x: (window.MARKETS || {}).x || '' }); line.innerHTML = 'reserved for you for 4 minutes';
      line = say('sign the launch in your wallet<span class="spin"></span>');
      const raw = await WAL.signLaunch(c.tx, kp); line.innerHTML = 'signed';
      line = say('sending<span class="spin"></span>');
      const { sig } = await post('send', { tx: raw }); const link = `<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">${short(sig)} ↗</a>`; line.innerHTML = 'sent ' + link;
      line = say('waiting for solana<span class="spin"></span>');
      const st = await waitSig(sig);
      if (st === 'failed') throw new Error('the launch failed on-chain, nothing was created');
      line.innerHTML = 'confirmed';
      line = say('opening the doors<span class="spin"></span>');
      await post('confirm', { item: it.id, sig });
      line.className = 'ok'; line.innerHTML = `you founded ${esc(it.name)}. <a href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">see it on pump.fun ↗</a>`;
      toast('you founded ' + it.name);
      loadCity(); setTimeout(loadPrices, 1500); setTimeout(refreshBal, 3000);
    } catch (e) { if (line) { line.className = 'err'; line.textContent = e.message; } else say(esc(e.message), 'err'); loadCity(); }
    go.disabled = false; renderClaimDet();
  });


  // ---------------------------------------------------------------- perps: long or short SOL, BTC and ETH on Jupiter Perps
  const P2 = { mk: null, a: store.get('markets.perp') || 'SOL', side: 'long', input: 'USDC', amt: '', lev: 5, q: null, qAt: 0, qid: 0, quoting: false, pos: null, busy: false, range: '1D', chart: null, closing: null };
  const PLOGO = { SOL: () => solIcon(), BTC: () => S.P && S.P.perpIcons && S.P.perpIcons.BTC, ETH: () => S.P && S.P.perpIcons && S.P.perpIcons.ETH };
  const plogo = (a, k) => lg(a, PLOGO[a] && PLOGO[a](), k);
  async function loadPerps() {
    try { const j = await api('perps'); P2.mk = j.markets; renderPerpMarkets(); renderPerpHead(); renderPerpTicket(); if (S.view === 'overview') renderOverview(); }
    catch (e) { if (!P2.mk) $('#pqh').innerHTML = `<div class="empty">the perps desk is not answering: ${esc(e.message)} <button class="kb" id="prt">Retry</button></div>`; const b = $('#prt'); if (b) b.onclick = loadPerps; }
  }
  const pm = () => P2.mk && P2.mk.find(m => m.asset === P2.a);
  function renderPerpMarkets() {
    $('#pmk').innerHTML = P2.mk.map(m => `<div class="pmr${m.asset === P2.a ? ' on' : ''}" data-a="${m.asset}">${plogo(m.asset, 'm')}<div><b>${m.asset}-PERP</b><small>${esc(m.name)}</small></div><div class="r">${usd(m.price)}<br><span class="${cls(m.ch24)}">${pc(m.ch24)}</span></div></div>`).join('');
    const m = pm(); if (!m) return;
    $('#pst').innerHTML = `<div><span>24H HIGH</span><b>${usd(m.hi)}</b></div><div><span>24H LOW</span><b>${usd(m.lo)}</b></div><div><span>24H VOLUME</span><b>${big(m.vol)}</b></div><div><span>MAX LEVERAGE</span><b>100x</b></div><div><span>MIN COLLATERAL</span><b>$10</b></div><div><span>COLLATERAL</span><b>USDC or SOL</b></div>`;
  }
  function renderPerpHead() {
    const m = pm(); if (!m) return;
    $('#pqh').innerHTML = `${plogo(m.asset, 'l')}<div class="nm"><b>${m.asset}-PERP</b><small>${esc(m.name)} perpetual · up to 100x · settles in USD</small></div><div class="px"><b>${usd(m.price)}</b><span class="${cls(m.ch24)}">${pc(m.ch24)} 24h</span></div>
      <div class="qs"><span>24H HIGH <b>${usd(m.hi)}</b></span><span>24H LOW <b>${usd(m.lo)}</b></span><span>VOL 24H <b>${big(m.vol)}</b></span><span class="tag">LEVERAGE CAN LIQUIDATE YOUR WHOLE COLLATERAL</span></div>`;
  }
  $('#pmk').addEventListener('click', e => { const r = e.target.closest('[data-a]'); if (!r || r.dataset.a === P2.a) return; P2.a = r.dataset.a; store.set('markets.perp', P2.a); P2.q = null; P2.qid++; renderPerpMarkets(); renderPerpHead(); renderPerpTicket(); loadPerpChart(); perpQuoteSoon(); });
  // chart: the coin itself
  $('#prg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; P2.range = b.dataset.r; $$('#prg button').forEach(x => x.classList.toggle('on', x === b)); loadPerpChart(); });
  let pchKey = '';
  async function loadPerpChart() {
    const key = P2.a + P2.range; pchKey = key; $('#pchart').innerHTML = '<div class="msg">loading the chart…</div>'; $('#pohlc').textContent = '';
    try { const c = await api('chart', { sym: P2.a + '-PERP', r: P2.range }); if (pchKey !== key) return; P2.chart = c; drawPerpChart(); }
    catch (e) { if (pchKey !== key) return; P2.chart = null; $('#pchart').innerHTML = `<div class="msg">no chart right now.<br>the price above is still live.</div>`; }
  }
  function drawPerpChart() { if (P2.chart) drawCandles(P2.chart, $('#pchart'), P2.range, $('#pohlc'), $('#pchLbl')); }
  // ticket
  const inPx = () => P2.input === 'USDC' ? 1 : (S.P && S.P.sol.usd);
  const pBal = () => !S.bal ? null : P2.input === 'SOL' ? Math.max(0, S.bal.sol - 0.02) : ((S.bal.tokens.find(t => t.kind === 'cash') || {}).amount || 0);
  function renderPerpTicket() {
    $$('#pside button').forEach(b => b.classList.toggle('on', b.dataset.s === P2.side));
    $('#plevV').textContent = (+P2.lev).toFixed(1) + 'x';
    $$('#plevs button').forEach(b => b.classList.toggle('on', +b.dataset.l === +P2.lev));
    const x = parseFloat(P2.amt), usdIn = x > 0 && inPx() ? x * inPx() : 0, b = pBal();
    $('#pbal').innerHTML = WAL.W.addr && b != null ? `<span>bal ${amt(b, P2.input === 'SOL' ? 4 : 2)} ${P2.input}</span><span><button data-pmax=".5">50%</button><button data-pmax="1">max</button></span>` : '';
    const size = P2.q && !P2.q.error ? P2.q.quote.size : usdIn * P2.lev;
    const so = $('#psize'); so.textContent = size > 0 ? usd(size) : '$0.00'; so.classList.toggle('wait', !(size > 0));
    const mk = pm(); $('#pmkTok').textContent = size > 0 && mk && mk.price ? '≈ ' + amt(size / mk.price, mk.price > 1000 ? 5 : 3) + ' ' + mk.asset : (mk ? mk.asset : '');
    let d = `<div><span>COLLATERAL</span><span>${usdIn > 0 ? '≈ ' + usd(usdIn) : '—'}</span></div>`;
    const q = P2.q && !P2.q.error ? P2.q.quote : null;
    if (q) {
      d += `<div><span>ENTRY</span><span>${usd(q.entry)}</span></div><div class="${q.liq && pm() && Math.abs(q.liq - pm().price) / pm().price < 0.05 ? 'bad' : 'warn'}"><span>LIQUIDATION</span><span>${usd(q.liq)}</span></div><div><span>LEVERAGE</span><span>${q.lev ? q.lev.toFixed(2) + 'x' : '—'}</span></div><div><span>OPEN FEE</span><span>${usd(q.fee)}${q.impactFee ? ' + ' + usd(q.impactFee) + ' impact' : ''}</span></div>`;
    } else if (P2.q && P2.q.error) d += `<div class="bad"><span>DESK</span><span>${esc(P2.q.error)}</span></div>`;
    else if (usdIn > 0 && !WAL.W.addr) d += `<div><span>ENTRY · LIQ</span><span>connect to see exact prices</span></div>`;
    $('#pdet').innerHTML = d;
    $('#pack').hidden = store.get('markets.pack') === '1' || !WAL.W.addr;
    const go = $('#pgo'), m = pm(); go.classList.toggle('sell', P2.side === 'short');
    let t = '', on = false;
    const ack = store.get('markets.pack') === '1' || $('#packC').checked;
    if (P2.busy) t = 'WORKING…';
    else if (!WAL.W.addr) { t = 'CONNECT WALLET'; on = true; }
    else if (!(x > 0)) t = 'ENTER AN AMOUNT';
    else if (usdIn && usdIn < 10) t = 'MIN COLLATERAL IS $10';
    else if (b != null && x > b) t = 'NOT ENOUGH ' + P2.input;
    else if (P2.q && P2.q.error) t = P2.q.error.toUpperCase().slice(0, 40);
    else if (!q) t = P2.quoting ? 'PRICING THE ORDER…' : 'GETTING A QUOTE…';
    else if (!ack) t = 'TICK THE BOX ABOVE';
    else { t = `${P2.side === 'long' ? 'LONG' : 'SHORT'} ${m ? m.asset : ''} ${(+P2.lev).toFixed(1)}x`; on = true; }
    go.textContent = t; go.disabled = !on;
  }
  let pqT = 0;
  function perpQuoteSoon() { P2.q = null; P2.qid++; clearTimeout(pqT); const x = parseFloat(P2.amt); if (x > 0 && WAL.W.addr && (!inPx() || x * inPx() >= 10)) { P2.quoting = true; pqT = setTimeout(perpQuote, 550); } else P2.quoting = false; renderPerpTicket(); }
  async function perpQuote() {
    const id = ++P2.qid; P2.quoting = true;
    try { const r = await post('popen', { asset: P2.a, side: P2.side, input: P2.input, amount: P2.amt, leverage: P2.lev, slip: 200, user: WAL.W.addr, tp: $('#ptp').value || undefined, sl: $('#psl').value || undefined }); if (id !== P2.qid) return; P2.q = r; P2.qAt = Date.now(); }
    catch (e) { if (id !== P2.qid) return; P2.q = { error: e.message }; }
    P2.quoting = false; renderPerpTicket();
  }
  $('#pamt').addEventListener('input', e => { let v = e.target.value.replace(',', '.').replace(/[^\d.]/g, ''); const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); if (v !== e.target.value) e.target.value = v; P2.amt = v; perpQuoteSoon(); });
  $('#pin').addEventListener('change', e => { P2.input = e.target.value; perpQuoteSoon(); });
  $('#plev').addEventListener('input', e => { P2.lev = Math.round(+e.target.value * 10) / 10; perpQuoteSoon(); });
  $('#plevs').addEventListener('click', e => { const b = e.target.closest('[data-l]'); if (!b) return; P2.lev = +b.dataset.l; $('#plev').value = P2.lev; perpQuoteSoon(); });
  $('#pside').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || P2.side === b.dataset.s) return; P2.side = b.dataset.s; perpQuoteSoon(); });
  ['#ptp', '#psl'].forEach(q => $(q).addEventListener('input', e => { e.target.value = e.target.value.replace(',', '.').replace(/[^\d.]/g, ''); perpQuoteSoon(); }));
  $('#ptk').addEventListener('click', e => { const m = e.target.closest('[data-pmax]'); if (!m) return; const b = pBal(); if (!b) return; const v = (b * +m.dataset.pmax).toFixed(P2.input === 'SOL' ? 4 : 2).replace(/\.?0+$/, ''); $('#pamt').value = v; P2.amt = v; perpQuoteSoon(); });
  $('#packC').addEventListener('change', e => { if (e.target.checked) store.set('markets.pack', '1'); renderPerpTicket(); });
  const plog = (h, k) => { const l = $('#plog'); const d = document.createElement('div'); if (k) d.className = k; d.innerHTML = h; l.appendChild(d); while (l.children.length > 6) l.firstChild.remove(); return d; };
  $('#pgo').addEventListener('click', async () => {
    if (!WAL.W.addr) return openWallet();
    if (P2.busy) return; P2.busy = true; renderPerpTicket(); $('#plog').innerHTML = '';
    let line;
    try {
      if (!P2.q || P2.q.error || Date.now() - P2.qAt > 15000) { line = plog('pricing the order<span class="spin"></span>'); await perpQuote(); line.innerHTML = 'priced'; }
      if (!P2.q || P2.q.error) throw new Error((P2.q && P2.q.error) || 'no quote');
      const q = P2.q;
      line = plog('sign the order in your wallet<span class="spin"></span>');
      const signed = await WAL.signOnly(q.tx); line.innerHTML = 'signed';
      line = plog('sending to the keeper<span class="spin"></span>');
      const { sig } = await post('pexec', { action: 'increase-position', tx: signed });
      const link = `<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">${short(sig)} ↗</a>`; line.innerHTML = 'sent ' + link;
      line = plog('waiting for solana<span class="spin"></span>');
      const st = await waitSig(sig);
      if (st === 'failed') { line.className = 'err'; line.innerHTML = 'failed on-chain, nothing was opened ' + link; }
      else { line.className = 'ok'; line.innerHTML = `${P2.side === 'long' ? 'long' : 'short'} ${esc(P2.a)} ${(q.quote.lev || P2.lev).toFixed(1)}x opened · size ${usd(q.quote.size)} · liq ${usd(q.quote.liq)} ${link}`; toast(`${P2.side === 'long' ? 'Long' : 'Short'} ${P2.a} opened`); }
      P2.amt = ''; $('#pamt').value = ''; $('#ptp').value = ''; $('#psl').value = ''; P2.q = null;
      setTimeout(loadPositions, 2500); setTimeout(loadPositions, 8000); setTimeout(refreshBal, 3000);
    } catch (e) { if (line) { line.className = 'err'; line.textContent = e.message; } else plog(esc(e.message), 'err'); }
    P2.busy = false; renderPerpTicket();
  });
  // positions
  async function loadPositions() {
    if (!WAL.W.addr) { P2.pos = null; renderPositions(); return; }
    try { const j = await api('ppos', { addr: WAL.W.addr }); P2.pos = j.positions; P2.posErr = null; } catch (e) { P2.posErr = e.message; }
    renderPositions();
  }
  function renderPositions() {
    const el = $('#ppos');
    if (!WAL.W.addr) { $('#pposN').textContent = ''; el.innerHTML = `<div class="empty">connect a wallet to see your positions. <button class="kb hot" data-connect>Connect wallet</button></div>`; return; }
    if (!P2.pos) { el.innerHTML = `<div class="empty">${P2.posErr ? 'could not read positions: ' + esc(P2.posErr) : 'reading your positions<span class="spin"></span>'}</div>`; return; }
    $('#pposN').textContent = P2.pos.length ? P2.pos.length + ' open' : '';
    if (!P2.pos.length) { el.innerHTML = '<div class="empty">no open positions. pick a side.</div>'; return; }
    el.innerHTML = `<div class="prow h"><span>MARKET</span><span class="r">SIZE</span><span class="r">COLLATERAL</span><span class="r">ENTRY</span><span class="r">MARK</span><span class="r">LIQ</span><span class="r">PNL</span><span></span></div>` + P2.pos.map(p => `<div class="prow"><span><b class="${p.side === 'long' ? 'up' : 'dn'}">${esc(p.asset)} ${p.side === 'long' ? 'LONG' : 'SHORT'}</b> <span class="mute">${p.lev ? p.lev.toFixed(1) + 'x' : ''}</span></span><span class="r">${usd(p.size)}</span><span class="r">${usd(p.coll)}</span><span class="r">${usd(p.entry)}</span><span class="r">${usd(p.mark)}</span><span class="r dn">${usd(p.liq)}</span><span class="r ${cls(p.pnl)}">${p.pnl >= 0 ? '+' : '−'}${usd(Math.abs(p.pnl || 0))} <span class="mute">${pc(p.pnlPct)}</span></span><span class="r"><button class="kb" data-close="${esc(p.key)}">${P2.closing === p.key ? 'confirm?' : 'close'}</button></span></div>`).join('');
  }
  $('#pposR').addEventListener('click', loadPositions);
  $('#ppos').addEventListener('click', async e => {
    const b = e.target.closest('[data-close]'); if (!b || P2.busy) return;
    const key = b.dataset.close;
    if (P2.closing !== key) { P2.closing = key; renderPositions(); setTimeout(() => { if (P2.closing === key) { P2.closing = null; renderPositions(); } }, 6000); return; }
    P2.closing = null; P2.busy = true; $('#plog').innerHTML = '';
    let line;
    try {
      line = plog('pricing the close<span class="spin"></span>');
      const r = await post('pclose', { position: key, receive: 'USDC', slip: 200 }); line.innerHTML = `close for ${r.quote.pnl >= 0 ? '+' : '−'}${usd(Math.abs(r.quote.pnl || 0))} pnl after fees`;
      line = plog('sign the close in your wallet<span class="spin"></span>');
      const signed = await WAL.signOnly(r.tx); line.innerHTML = 'signed';
      line = plog('sending to the keeper<span class="spin"></span>');
      const { sig } = await post('pexec', { action: 'decrease-position', tx: signed });
      const link = `<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">${short(sig)} ↗</a>`;
      const st = await waitSig(sig);
      line.className = st === 'failed' ? 'err' : 'ok'; line.innerHTML = (st === 'failed' ? 'the close failed on-chain ' : 'closed, USDC is on its way to your wallet ') + link;
      setTimeout(loadPositions, 2500); setTimeout(refreshBal, 3000);
    } catch (e2) { if (line) { line.className = 'err'; line.textContent = e2.message; } }
    P2.busy = false; renderPerpTicket(); renderPositions();
  });

  // ---------------------------------------------------------------- docs
  function renderDocs() {
    if ($('#docsBody').dataset.done) return; $('#docsBody').dataset.done = 1;
    const sec = [
      ['what', 'what is markets', `<p>markets is the city's stock market: a trading terminal on Solana for real stocks, plus a city of real estate, businesses and rides that trade as coins. Everything happens from your own wallet. Nothing is held for you, and every trade settles on-chain in seconds.</p>`],
      ['stocks', 'stocks', `<p>The stocks are <b>xStocks</b>: tokens issued by Backed, each backed 1:1 by the real share held with a regulated custodian, with a price that tracks the share. They are not the shares themselves and carry no voting rights. <b>xStocks are not offered to US persons</b> or in some other countries; the terminal asks you to confirm before your first trade.</p><p>Prices come live from Jupiter. The chart shows the real share on its exchange (Nasdaq or NYSE). Time &amp; sales lists real trades from the token's deepest on-chain pool.</p>`],
      ['trade', 'how a trade works', `<ul><li>Pick a stock, choose buy or sell, and enter an amount in SOL or USDC.</li><li>Jupiter finds the best route. You see the price, the price impact and the minimum you will receive before you sign.</li><li>Your wallet (Phantom, Solflare or Backpack) signs and sends it. The terminal follows it until Solana confirms it and links the transaction.</li></ul><p>Quotes refresh every 15 seconds. If the price moves past your slippage (0.5%, 1% or 2%), the trade fails and nothing is spent.</p>`],
      ['city', 'the city', `<p>The city lists 24 assets: 8 real estate, 8 businesses and 8 rides. Each one becomes a real coin on pump.fun the first time someone claims it.</p><ul><li><b>Claim</b> an open asset: your browser makes the coin's key, you sign the launch in your wallet (about 0.02 SOL plus an optional first buy), and you become its founder.</li><li><b>Founders earn</b> pump.fun's creator fees on every trade of their coin.</li><li><b>Trade</b> any founded asset from the terminal like a stock.</li></ul><p>A city coin is a memecoin named after a city asset. It is not a share of a real building, business or vehicle.</p>`],
      ['perps', 'perps', `<p>The perps desk opens leveraged longs and shorts on <b>SOL, BTC and ETH</b> through Jupiter Perps.</p><ul><li>Pay collateral in USDC or SOL (at least $10) and pick a leverage from 1.1x to 100x. Position size = collateral × leverage.</li><li>Before you sign you see the entry price, your liquidation price and the open fee, quoted by Jupiter.</li><li>Your wallet signs, Jupiter's keeper fills the order in seconds, and the position shows up under positions with live PnL.</li><li>Close a position with one click (you confirm, then sign). You receive USDC.</li></ul><p><b>If the price reaches your liquidation price you lose your whole collateral.</b> Borrow fees accrue while a position is open.</p>`],
      ['terminal', 'the terminal', `<div class="kv"><span>/</span><span>focus the command line</span><span>1 2 3 4 5 6</span><span>trade · stocks · city · perps · portfolio · docs</span><span>L / S</span><span>long / short on the perps desk</span><span>↑ ↓</span><span>move through the watchlist</span><span>F2</span><span>filter the watchlist</span><span>F3 / F4</span><span>buy / sell in the order ticket</span></div><p>Commands:</p><div class="kv"><span>buy nvda 0.5 sol</span><span>fill the ticket to buy NVDA with 0.5 SOL</span><span>sell tsla all</span><span>sell everything you hold (also 50%)</span><span>chart aapl 1m</span><span>open a chart (1d, 1w, 1m, 6m, 1y)</span><span>find gold</span><span>filter the watchlist</span><span>long sol 50 5x</span><span>fill the perps ticket: long SOL with 50 USDC at 5x</span><span>city</span><span>open the city</span><span>portfolio · docs · connect</span><span>open a view or the wallet sheet</span></div>`],
      ['fees', 'fees', `<p>markets adds no fee to trades. You pay the Solana network fee and the price impact of the route, both shown before you sign. City launches cost what pump.fun charges to create a coin, plus your optional first buy.</p>`],
      ['safety', 'safety', `<ul><li>markets never asks for a seed phrase or a private key, and never holds funds.</li><li>Every transaction is built by Jupiter or PumpPortal and shown in your wallet before you sign it.</li><li>A city coin's mint key is made in your browser and only its public address leaves it.</li><li>Thin markets (less than $5,000 on-chain) are labelled; a trade there can move the price a lot.</li></ul>`],
      ['data', 'where the data comes from', `<div class="kv"><span>prices, logos, holders</span><span>Jupiter token API</span><span>quotes and swaps</span><span>Jupiter swap API</span><span>stock charts</span><span>the share on its exchange, via Yahoo Finance</span><span>pool charts, time &amp; sales</span><span>GeckoTerminal</span><span>balances, confirmations</span><span>Solana RPC</span><span>city launches</span><span>pump.fun and PumpPortal</span></div>`],
      ['risk', 'risk', `<p>Prices can move fast. Tokenized stocks can trade away from the share when markets are closed or liquidity is thin. City coins are memecoins and can go to zero. Nothing here is financial advice. markets is independent and is not affiliated with any game studio, Backed, Jupiter, pump.fun or the listed companies.</p>`],
    ];
    $('#docsBody').innerHTML = `<nav>${sec.map(([id, t]) => `<a href="#docs/${id}" data-doc="${id}">${t}</a>`).join('')}</nav><article>${sec.map(([id, t, h]) => `<h2 id="doc-${id}">${t}</h2>${h}`).join('')}</article>`;
    $('#docsBody nav').addEventListener('click', e => { const a = e.target.closest('[data-doc]'); if (!a) return; e.preventDefault(); const h = document.getElementById('doc-' + a.dataset.doc); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  // ---------------------------------------------------------------- overview: the whole market on one page
  const SECTOR = { SPY: 'Index funds', QQQ: 'Index funds', IWM: 'Index funds', VTI: 'Index funds', VOO: 'Index funds', TQQQ: 'Index funds', SCHF: 'Index funds', IEMG: 'Index funds', IJR: 'Index funds',
    TBLL: 'Bonds & metals', TLT: 'Bonds & metals', GOLD: 'Bonds & metals', SLV: 'Bonds & metals',
    AAPL: 'Tech', MSFT: 'Tech', GOOGL: 'Tech', META: 'Tech', AMZN: 'Tech', NFLX: 'Tech', ORCL: 'Tech', CRM: 'Tech', CRWD: 'Tech', CSCO: 'Tech', IBM: 'Tech', ACN: 'Tech', APP: 'Tech', PLTR: 'Tech',
    NVDA: 'Chips', AVGO: 'Chips', AMD: 'Chips', INTC: 'Chips', MRVL: 'Chips',
    COIN: 'Crypto', HOOD: 'Crypto', MSTR: 'Crypto', CRCL: 'Crypto', DFDV: 'Crypto',
    JPM: 'Finance', BAC: 'Finance', GS: 'Finance', V: 'Finance', 'BRK.B': 'Finance',
    LLY: 'Health', ABBV: 'Health', ABT: 'Health', AZN: 'Health', DHR: 'Health', JNJ: 'Health', MDT: 'Health', MRK: 'Health', NVO: 'Health', PFE: 'Health', TMO: 'Health', UNH: 'Health',
    TSLA: 'Consumer', WMT: 'Consumer', KO: 'Consumer', PEP: 'Consumer', PG: 'Consumer', MCD: 'Consumer', HD: 'Consumer', GME: 'Consumer', CMCSA: 'Consumer', OPEN: 'Consumer',
    XOM: 'Energy & industry', CVX: 'Energy & industry', HON: 'Energy & industry', LIN: 'Energy & industry' };
  const SEC_ORDER = ['Index funds', 'Tech', 'Chips', 'Crypto', 'Finance', 'Health', 'Consumer', 'Energy & industry', 'Bonds & metals'];
  const IXS = [['SPY', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['GOLD', 'Gold'], ['SOL', 'Solana']];
  const OV = { sparks: {}, sparksAt: 0, spy: null, spyAt: 0, shown: false, drawn: {}, last: {} };
  function spark(vals, up) {
    if (!vals || vals.length < 2) return '<svg viewBox="0 0 200 46"></svg>';
    const lo = Math.min(...vals), hi = Math.max(...vals), W = 200, H = 46, d = (hi - lo) || 1, c = up ? '#1f9e66' : '#d6416a';
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * W).toFixed(1)},${(H - 3 - (v - lo) / d * (H - 8)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="0,${H} ${pts} ${W},${H}" fill="${c}" fill-opacity=".08"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  function renderOverview() {
    if (S.view !== 'overview' || !S.P) return;
    const L = S.P.stocks.filter(s => !s.thin && s.usd != null && s.ch24 != null);
    const st = OV.spy && OV.spy.state, stTxt = { open: 'US market open', pre: 'US pre-market', after: 'US after hours', closed: 'US market closed' }[st];
    $('#ovState').innerHTML = `${stTxt ? `<span class="chip ${st}"><i></i>${stTxt}</span>` : ''}<span class="chip open"><i></i>Solana live · ${hhmmss(S.P.t || Date.now())} UTC</span>`;
    $('#ovLead').textContent = `${S.P.stocks.length} stocks, ETFs and metals on Solana, ${L.length} with deep markets. Prices from Jupiter, charts from each share's exchange.`;
    const first = !OV.shown; OV.shown = true;
    $('#ovIx').innerHTML = IXS.map(([sym, nm], i) => {
      const s = sym === 'SOL' ? { sym: 'SOL', usd: S.P.sol.usd, ch24: S.P.sol.ch24, icon: S.P.sol.icon } : S.by[sym]; if (!s) return '';
      const sp = OV.sparks[sym], drawSp = sp && !OV.drawn[sym]; if (drawSp) OV.drawn[sym] = 1;
      return `<div class="pn ix${first ? ' pop' : ''}" style="--i:${i * 2}" data-go="${sym === 'SOL' ? '#perps/SOL' : '#trade/' + sym}"><div class="t">${lg(sym, s.icon, 'm')}<b>${esc(sym)}</b>${esc(nm)}</div><div class="v" data-v="${s.thin ? '' : s.usd}">${s.thin ? '—' : usd(s.usd)}</div><div class="c ${cls(s.ch24)}">${pc(s.ch24)} 24h</div>${spark(sp, (s.ch24 || 0) >= 0).replace('<svg ', drawSp && !still ? '<svg class="drawin" ' : '<svg ')}</div>`;
    }).join('');
    if (first) $$('#ovIx .v[data-v]').forEach(el => { const v = parseFloat(el.dataset.v); if (isFinite(v)) countUp(el, v, usd, v * 0.95, 1200); });
    const up = L.filter(s => s.ch24 > 0.05).length, dn = L.filter(s => s.ch24 < -0.05).length, fl = L.length - up - dn, n = L.length || 1;
    const liq = S.P.stocks.reduce((a, s) => a + (s.liq || 0), 0), hold = S.P.stocks.reduce((a, s) => a + (s.holders || 0), 0), avg = L.length ? L.reduce((a, s) => a + s.ch24, 0) / L.length : null;
    $('#ovBrd').innerHTML = `<div><div class="row2"><span class="k">Up vs down</span><span class="v"><span class="up">${up}</span><span class="mute" style="font-size:15px"> / </span><span class="dn">${dn}</span></span></div>
        <div class="bb${first ? ' grow' : ''}" style="margin-top:10px"><i style="width:${up / n * 100}%;background:#1f9e66"></i><i style="width:${fl / n * 100}%;background:#d9d1e1"></i><i style="width:${dn / n * 100}%;background:#d6416a"></i></div>
        <div class="bl"><span class="up">${up} up</span><span class="mute">${fl} flat</span><span class="dn">${dn} down</span></div></div>
      <div class="row2"><span class="k">Average move</span><span class="v ${cls(avg)}">${pc(avg)}</span></div>
      <div class="row2"><span class="k">On-chain liquidity</span><span class="v">${big(liq)}</span></div>
      <div class="row2"><span class="k">Holders, all stocks</span><span class="v">${int(hold)}</span></div>
      <div class="row2"><span class="k">SOL</span><span class="v">${usd(S.P.sol.usd)} <span class="${cls(S.P.sol.ch24)}" style="font-size:13px">${pc(S.P.sol.ch24)}</span></span></div>`;
    let ri = 0; const row = (s, sub) => `<div class="rw${first ? ' pop' : ''}${flashCls(OV.last[s.sym + (sub ? 'x' : '')], s.usd)}" style="--i:${(ri++ % 6) + 4}" data-sym="${esc(s.sym)}">${lg(s.sym, s.icon, 'm')}<div><b>${esc(s.sym)}</b><small>${esc(sub || s.name)}</small></div><div class="r">${usd(s.usd)}<small class="${cls(s.ch24)}">${pc(s.ch24)}</small></div></div>`;
    const lists = [['Top gainers', L.slice().sort((a, b) => b.ch24 - a.ch24), null], ['Top losers', L.slice().sort((a, b) => a.ch24 - b.ch24), null],
      ['Deepest markets', L.slice().sort((a, b) => (b.liq || 0) - (a.liq || 0)), s => big(s.liq) + ' on-chain'], ['Most holders', L.slice().sort((a, b) => (b.holders || 0) - (a.holders || 0)), s => int(s.holders) + ' holders']];
    $('#ovLists').innerHTML = lists.map(([t, arr, sub]) => `<div class="pn ol"><div class="ph"><b>${t}</b></div>${arr.length ? arr.slice(0, 6).map(s => row(s, sub && sub(s))).join('') : '<div class="empty">No deep markets right now.</div>'}</div>`).join('');
    L.forEach(s => { OV.last[s.sym] = s.usd; OV.last[s.sym + 'x'] = s.usd; });
    const by = {}; let secI = 0; L.forEach(s => { const k = SECTOR[s.sym] || 'Other'; (by[k] = by[k] || []).push(s); });
    $('#ovSec').innerHTML = SEC_ORDER.concat(Object.keys(by).filter(k => !SEC_ORDER.includes(k))).filter(k => by[k]).map(k => {
      const arr = by[k].sort((a, b) => (b.liq || 0) - (a.liq || 0)), a = arr.reduce((x, s) => x + s.ch24, 0) / arr.length;
      return `<div class="sec"><h4>${esc(k)} <span class="${cls(a)}">${pc(a)}</span></h4><div class="tl">${arr.map(s => { const [bg, fg] = heatColor(s); return `<a class="${first ? 'pop' : ''}" href="#trade/${encodeURIComponent(s.sym)}" style="background:${bg};color:${fg};--i:${(secI++ % 24) + 8}" title="${esc(s.name)} · ${usd(s.usd)}"><b>${esc(s.sym)}</b>${pc(s.ch24)}</a>`; }).join('')}</div></div>`;
    }).join('') || '<div class="empty">No deep markets right now.</div>';
    const M = P2.mk;
    if (M) $('#ovPerps').innerHTML = ['SOL', 'BTC', 'ETH'].map(a => M.find(m => m.asset === a)).filter(Boolean).map(m => {
      const pos = m.hi > m.lo && m.price != null ? Math.max(0, Math.min(1, (m.price - m.lo) / (m.hi - m.lo))) : null, ic = m.asset === 'SOL' ? S.P.sol.icon : (S.P.perpIcons || {})[m.asset];
      return `<a href="#perps/${m.asset}"><div class="t">${lg(m.asset, ic, 'm')}${m.asset}-PERP</div><div class="v">${usd(m.price)}</div><div class="${cls(m.ch24)}" style="font-weight:700;font-size:12.5px">${pc(m.ch24)} 24h</div>${pos != null ? `<div class="rg2"><i style="left:${(pos * 100).toFixed(1)}%"></i></div><div class="lo" title="24h range"><span>${m.lo >= 10000 ? '$' + Math.round(m.lo).toLocaleString('en-US') : usd(m.lo)}</span><span>${m.hi >= 10000 ? '$' + Math.round(m.hi).toLocaleString('en-US') : usd(m.hi)}</span></div>` : ''}</a>`;
    }).join('') || '<div class="empty">The perps feed did not answer.</div>';
    const C = S.city && S.city.items;
    if (C) {
      const live = C.filter(i => i.status === 'live').sort((a, b) => (b.mcap || 0) - (a.mcap || 0)), open = C.filter(i => i.status === 'open').length;
      $('#ovCityN').textContent = `${live.length} founded · ${open} open`;
      $('#ovCity').innerHTML = (live.length ? live.slice(0, 5).map(i => `<div class="rw" data-city="${esc(i.id)}">${lg(i.sym, cityIcon(i), 'm')}<div><b>$${esc(i.sym)}</b><small>${esc(i.name)}</small></div><div class="r">${i.mcap != null ? big(i.mcap) + ' mcap' : '—'}<small class="${cls(i.ch24)}">${pc(i.ch24)}</small></div></div>`).join('') : '<div class="empty">No city coin has a founder yet. The first claim launches one.</div>')
        + (open ? `<div class="rw" data-go="#city" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${open} assets open to claim</b><small>Launch its coin on pump.fun, earn its creator fees</small></div><div class="r" style="color:var(--acc)">Claim →</div></div>` : '');
    }
  }
  async function loadOverview() {
    const now = Date.now();
    loadCity(); loadPerps();
    if (now - OV.spyAt > 55000) { OV.spyAt = now; api('chart', { sym: 'SPY', r: '1D' }).then(c => { OV.spy = c; if (S.view === 'overview') { drawCandles(c, $('#ovChart'), '1D', $('#ovOhlc'), $('#ovChLbl')); renderOverview(); } }).catch(() => { if (!OV.spy) $('#ovChart').innerHTML = '<div class="msg">The chart feed did not answer. It retries every minute.</div>'; }); }
    if (now - OV.sparksAt > 290000) {
      OV.sparksAt = now;
      api('sparks', { syms: 'SPY,QQQ,GOLD' }).then(j => { Object.assign(OV.sparks, j.sparks || {}); renderOverview(); }).catch(() => { });
      api('chart', { sym: 'SOL-PERP', r: '1D' }).then(c => { OV.sparks.SOL = c.pts.map(p => p[4]); renderOverview(); }).catch(() => { });
    }
  }
  $('#ov').addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { location.hash = g.dataset.go; return; }
    const r = e.target.closest('[data-sym]'); if (r) { location.hash = '#trade/' + encodeURIComponent(r.dataset.sym); return; }
    const c = e.target.closest('[data-city]'); if (c) location.hash = '#city/' + encodeURIComponent(c.dataset.city);
  });

  // ---------------------------------------------------------------- search everything (Ctrl+K)
  const PAGES = [['overview', 'Market overview'], ['trade', 'Trade'], ['markets', 'All stocks'], ['city', 'The city'], ['perps', 'Perps desk'], ['portfolio', 'Portfolio'], ['docs', 'Docs']];
  let SK = { on: false, i: 0, L: [] };
  function skItems(q) {
    q = q.trim().toLowerCase(); const out = [], m = (...t) => !q || t.some(x => String(x || '').toLowerCase().includes(q));
    if (S.P) S.P.stocks.filter(s => m(s.sym, s.name, s.tok)).sort((a, b) => (a.sym.toLowerCase() === q ? -1 : 0) - (b.sym.toLowerCase() === q ? -1 : 0) || (a.thin - b.thin) || (b.liq || 0) - (a.liq || 0)).slice(0, q ? 8 : 5)
      .forEach(s => out.push({ k: 'Stock', t: s.sym, d: s.name, r: s.thin ? 'thin' : usd(s.usd), c: s.ch24, icon: s.icon, go: '#trade/' + encodeURIComponent(s.sym) }));
    ['SOL', 'BTC', 'ETH'].filter(a => m(a, a + '-perp', 'perp', { SOL: 'solana', BTC: 'bitcoin', ETH: 'ethereum' }[a])).slice(0, q ? 3 : 1)
      .forEach(a => { const mk = P2.mk && P2.mk.find(x => x.asset === a); out.push({ k: 'Perp', t: a + '-PERP', d: 'Long or short up to 100x', r: mk ? usd(mk.price) : '', c: mk && mk.ch24, go: '#perps/' + a }); });
    if (S.city) S.city.items.filter(i => m(i.sym, i.name, i.line)).slice(0, q ? 6 : 3)
      .forEach(i => out.push({ k: 'City', t: '$' + i.sym, d: i.name, r: i.status === 'live' ? big(i.mcap) + ' mcap' : i.status === 'open' ? 'open to claim' : 'launching', c: i.status === 'live' ? i.ch24 : null, icon: cityIcon(i), go: '#city/' + i.id }));
    PAGES.filter(([id, t]) => m(id, t)).slice(0, q ? 3 : 7).forEach(([id, t]) => out.push({ k: 'Page', t, d: '', r: '', go: '#' + id }));
    return out;
  }
  function skRender() {
    const q = $('#skq').value; SK.L = skItems(q); SK.i = Math.min(SK.i, Math.max(0, SK.L.length - 1));
    $('#skl').innerHTML = SK.L.map((x, i) => `<button class="sk-r${i === SK.i ? ' on' : ''}" data-i="${i}"><span class="sk-k">${x.k}</span>${x.k === 'Page' ? '' : lg(x.t.replace(/^\$|-PERP$/g, ''), x.icon, 'm')}<span class="sk-t"><b>${esc(x.t)}</b><small>${esc(x.d)}</small></span><span class="sk-v">${esc(x.r)}${x.c != null ? `<small class="${cls(x.c)}">${pc(x.c)}</small>` : ''}</span></button>`).join('') || `<div class="empty">Nothing matches “${esc(q)}”.</div>`;
    const on = $('#skl .sk-r.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function skOpen() { SK.on = true; SK.i = 0; if (!S.city) loadCity(); if (!P2.mk) loadPerps(); $('#sk').classList.add('on'); $('#skq').value = ''; skRender(); setTimeout(() => $('#skq').focus(), 30); }
  function skClose() { SK.on = false; $('#sk').classList.remove('on'); }
  function skGo(i) { const x = SK.L[i]; if (!x) return; skClose(); location.hash = x.go; }
  $('#skq').addEventListener('input', () => { SK.i = 0; skRender(); });
  $('#skq').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); SK.i = Math.max(0, Math.min(SK.L.length - 1, SK.i + (e.key === 'ArrowDown' ? 1 : -1))); skRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); skGo(SK.i); }
    else if (e.key === 'Escape') { e.preventDefault(); skClose(); }
  });
  $('#skl').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) skGo(+b.dataset.i); });
  $('#sk').addEventListener('click', e => { if (e.target.id === 'sk') skClose(); });
  $('#skBtn').addEventListener('click', skOpen);
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); SK.on ? skClose() : skOpen(); } }, true);

  // ---------------------------------------------------------------- router
  const ind = document.createElement('span'); ind.className = 'tab-ind'; $('#tabs').prepend(ind);
  function placeInd() { const a = $('#tabs a.on'); if (!a) { ind.style.opacity = 0; return; } ind.style.opacity = 1; ind.style.width = a.offsetWidth + 'px'; ind.style.transform = `translateX(${a.offsetLeft}px)`; requestAnimationFrame(() => ind.classList.add('ready')); }
  addEventListener('resize', () => placeInd());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeInd());
  function show(v) {
    S.view = v;
    $$('.view').forEach(n => n.classList.toggle('on', n.id === 'v-' + v));
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
    placeInd();
    if (v === 'overview') { renderOverview(); loadOverview(); if (OV.spy) requestAnimationFrame(() => drawCandles(OV.spy, $('#ovChart'), '1D', $('#ovOhlc'), $('#ovChLbl'))); }
    if (v === 'trade') { renderTicket(); requestAnimationFrame(drawChart); }
    if (v === 'markets') renderMarkets();
    if (v === 'portfolio') { renderPortfolio(); if (WAL.W.addr && Date.now() - S.balAt > 8000) refreshBal(); }
    if (v === 'city') { if (S.city) renderCity(); loadCity(); }
    if (v === 'perps') { loadPerps(); loadPerpChart(); loadPositions(); renderPerpTicket(); }
    if (v === 'docs') { renderDocs(); const id = (location.hash.match(/^#docs\/(\w+)/) || [])[1]; if (id) setTimeout(() => { const h = document.getElementById('doc-' + id); if (h) h.scrollIntoView({ block: 'start' }); }, 30); }
  }
  function route() {
    const [v, a] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
    if (v === '' || v === 'overview') return show('overview');
    if (v === 'markets') return show('markets');
    if (v === 'portfolio') return show('portfolio');
    if (v === 'city') return show('city');
    if (v === 'perps') { const k = (a || '').toUpperCase(); if (['SOL', 'BTC', 'ETH'].includes(k)) P2.a = k; return show('perps'); }
    if (v === 'docs') return show('docs');
    show('trade');
    if (a && a !== S.sym) { if (S.P) pick(a.toUpperCase(), true); else S.sym = a.toUpperCase(); }
  }
  window.addEventListener('hashchange', route);
  function renderAll() { renderAccount(); renderTicket(); if (S.view === 'portfolio') renderPortfolio(); }

  // ---------------------------------------------------------------- go
  route();
  renderTicket(); renderAccount();
  loadPrices();
  setInterval(() => { if (!document.hidden) loadPrices(); }, 15000);
  setInterval(() => { if (!document.hidden && S.view === 'trade') loadTrades(true); }, 15000);
  setInterval(() => { if (!document.hidden && S.view === 'perps') { loadPerps(); if (WAL.W.addr) loadPositions(); if (P2.q && !P2.q.error && !P2.busy && Date.now() - P2.qAt > 15000) perpQuote(); } }, 10000);
  setInterval(() => { if (!document.hidden && WAL.W.addr) refreshBal(); }, 30000);
  setInterval(() => { if (!document.hidden && S.view === 'overview') loadOverview(); }, 30000);
  WAL.restore();
})();
