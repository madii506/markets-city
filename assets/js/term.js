/* markets terminal: watchlist, candles, time & sales, heatmap, order ticket, account, screener, portfolio, command line.
   Every number comes from /api/m (Jupiter, Solana RPC, the share's exchange, GeckoTerminal). Nothing is simulated. */
(function () {
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const API = '/api/m', WAL = window.MarketsWallet;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const px = x => x == null || !isFinite(x) ? '—' : x === 0 ? '0.00' : x >= 1000 ? x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : x >= 1 ? x.toFixed(2) : x.toFixed(4);
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

  const S = { P: null, by: {}, view: null, sym: store.get('markets.sym') || 'NVDA', wq: '', ws: 'liq', mq: '', mk: 'all', ms: 'liq', md: -1,
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
      const prev = S.by; S.P = j; S.by = Object.fromEntries(j.stocks.map(s => [s.sym, s])); feed(true);
      if (!S.by[S.sym]) S.sym = 'NVDA';
      $('#solp').innerHTML = j.sol.usd ? `SOL <b>${usd(j.sol.usd)}</b> <span class="${cls(j.sol.ch24)}">${pc(j.sol.ch24)}</span>` : '';
      renderTape(); renderWatch(prev); renderHeat(); renderQuote(); renderMarkets(); renderAccount();
      if (S.view === 'trade') renderTicket();
      if (first) { first = false; loadChart(); loadTrades(); }
    } catch (e) {
      feed(false);
      if (!S.P) { $('#qh').innerHTML = `<div class="empty">price feed offline: ${esc(e.message)} <button class="kb" id="rt">[ retry ]</button></div>`; const b = $('#rt'); if (b) b.onclick = loadPrices; }
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
    const L = S.P.stocks.filter(s => !q || s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    if (S.ws === 'sym') L.sort((a, b) => a.sym.localeCompare(b.sym));
    else if (S.ws === 'ch') L.sort((a, b) => (a.thin - b.thin) || ((b.ch24 == null ? -99 : b.ch24) - (a.ch24 == null ? -99 : a.ch24)));
    else L.sort((a, b) => (a.thin - b.thin) || (b.liq || 0) - (a.liq || 0));
    return L;
  }
  function renderWatch(prev) {
    if (!S.P) return;
    const L = wlList();
    $('#wlN').textContent = L.length + '/' + S.P.stocks.length;
    $('#wlb').innerHTML = L.map(s => {
      const p0 = prev && prev[s.sym], moved = p0 && p0.usd != null && s.usd != null && p0.usd !== s.usd;
      return `<div class="wr${s.sym === S.sym ? ' on' : ''}${s.thin ? ' thin' : ''}${moved ? ' fl' : ''}" data-sym="${esc(s.sym)}" title="${esc(s.name)}">${lg(s.sym, s.icon)}<b>${esc(s.sym)}</b><span class="p">${s.thin ? 'thin' : px(s.usd)}</span><span class="c ${cls(s.ch24)}">${s.thin ? '' : pc(s.ch24)}</span></div>`;
    }).join('') || '<div class="empty">no match.</div>';
  }
  $('#wlb').addEventListener('click', e => { const r = e.target.closest('[data-sym]'); if (r) pick(r.dataset.sym); });
  $('#wlq').addEventListener('input', e => { S.wq = e.target.value; renderWatch(); });
  $('#wls').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.ws = b.dataset.s; $$('#wls button').forEach(x => x.classList.toggle('on', x === b)); renderWatch(); });

  // ---------------------------------------------------------------- heatmap
  function heatColor(s) {
    if (s.thin || s.ch24 == null) return ['#100f1e', 'var(--dim)'];
    const m = Math.min(1, Math.abs(s.ch24) / 4), a = 0.16 + m * 0.62;
    return s.ch24 >= 0 ? [`rgba(46,170,110,${a.toFixed(2)})`, m > 0.45 ? '#04140b' : 'var(--up)'] : [`rgba(220,60,80,${a.toFixed(2)})`, m > 0.45 ? '#1a0408' : '#ff9aa6'];
  }
  function renderHeat() {
    const order = { etf: 0, metal: 1, stock: 2 };
    const L = S.P.stocks.slice().sort((a, b) => (a.thin - b.thin) || (order[a.kind] - order[b.kind]) || (b.liq || 0) - (a.liq || 0));
    const up = L.filter(s => !s.thin && s.ch24 > 0).length, dn = L.filter(s => !s.thin && s.ch24 < 0).length;
    $('#hmN').innerHTML = `<span class="up">${up}▲</span> <span class="dn">${dn}▼</span>`;
    $('#hmg').innerHTML = L.map(s => { const [bg, fg] = heatColor(s); return `<div class="hm-t${s.sym === S.sym ? ' on' : ''}" data-sym="${esc(s.sym)}" style="background:${bg};color:${fg}" title="${esc(s.name)}"><b>${esc(s.sym)}</b>${s.thin ? 'thin' : pc(s.ch24)}</div>`; }).join('');
  }
  $('#hmg').addEventListener('click', e => { const t = e.target.closest('[data-sym]'); if (t) pick(t.dataset.sym); });

  // ---------------------------------------------------------------- quote header
  function renderQuote() {
    const s = stock(); if (!s) return;
    const c = S.chart && S.chart.sym === s.sym ? S.chart : null;
    const state = c && c.state ? `<span class="tag">${esc((c.exch || 'US market').toUpperCase())} ${c.state === 'open' ? 'OPEN' : c.state === 'pre' ? 'PRE-MARKET' : c.state === 'after' ? 'AFTER HOURS' : 'CLOSED'}</span>` : '';
    $('#qh').innerHTML = `${lg(s.sym, s.icon, 'l')}<div class="nm"><b>${esc(s.sym)}</b><small>${esc(s.name)} · ${esc(s.tok)} · ${esc(s.kind)}</small></div>
      <div class="px"><b>${s.thin ? '—' : usd(s.usd)}</b><span class="${cls(s.ch24)}">${s.thin ? 'thin market' : pc(s.ch24) + ' 24h'}</span></div>
      <div class="qs"><span>DEPTH <b>${big(s.liq)}</b></span><span>HOLDERS <b>${int(s.holders)}</b></span><span>MCAP <b>${big(s.mcap)}</b></span><span>VOL 24H <b>${big(s.vol24)}</b></span>${state}<span>TOKEN <a href="https://solscan.io/token/${esc(s.mint)}" target="_blank" rel="noopener">${short(s.mint)} ↗</a></span></div>`;
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
    renderQuote(); renderTicket(); if (changed) { loadChart(); loadTrades(); }
  }

  // ---------------------------------------------------------------- chart: candles of the share this token tracks
  $('#rg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setRange(b.dataset.r); });
  function setRange(r) { S.range = r; $$('#rg button').forEach(x => x.classList.toggle('on', x.dataset.r === r)); loadChart(); }
  let chartKey = '';
  async function loadChart() {
    const sym = S.sym, r = S.range, key = sym + r; chartKey = key;
    $('#chart').innerHTML = '<div class="msg">loading the chart…</div>'; $('#ohlc').textContent = ''; $('#chLbl').textContent = '';
    try { const c = await api('chart', { sym, r }); if (chartKey !== key) return; S.chart = c; drawChart(); renderQuote(); }
    catch (e) { if (chartKey !== key) return; S.chart = null; $('#chart').innerHTML = `<div class="msg">no chart for ${esc(sym)} right now.<br>the price above is still live.</div>`; }
  }
  const tl = (t, r) => { const d = new Date(t); return r === '1D' ? d.toISOString().slice(11, 16) : r === '1W' ? d.toUTCString().slice(0, 3) + ' ' + d.toISOString().slice(11, 16) : d.toISOString().slice(5, 10); };
  function drawChart() {
    const c = S.chart; if (!c) return;
    const box = $('#chart'), W = Math.max(200, box.clientWidth), H = Math.max(120, box.clientHeight);
    $('#chLbl').textContent = c.label;
    const P = c.pts, n = P.length, pad = { l: 6, r: 62, t: 12, b: 20 }, vh = Math.round((H - pad.t - pad.b) * 0.18);
    const ph = H - pad.t - pad.b - vh - 6;
    let lo = Infinity, hi = -Infinity, vmax = 1;
    for (const p of P) { lo = Math.min(lo, p[3]); hi = Math.max(hi, p[2]); vmax = Math.max(vmax, p[5] || 0); }
    if (S.range === '1D' && c.prev) { lo = Math.min(lo, c.prev); hi = Math.max(hi, c.prev); }
    const sp = (hi - lo) || hi * 0.01; lo -= sp * 0.06; hi += sp * 0.06;
    const cw = (W - pad.l - pad.r) / n, bw = Math.max(1, Math.min(9, cw * 0.62));
    const X = i => pad.l + cw * (i + 0.5), Y = v => pad.t + ph * (1 - (v - lo) / (hi - lo));
    const vy0 = pad.t + ph + 6 + vh;
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); g += `<line x1="${pad.l}" x2="${W - pad.r + 4}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#1c1a31" stroke-dasharray="2 4"/><text x="${W - pad.r + 8}" y="${(y + 4).toFixed(1)}" fill="#5f5a82" font-size="10.5" font-family="JBM,monospace">${v >= 1000 ? v.toFixed(0) : v.toFixed(2)}</text>`; }
    for (let k = 0; k < 5; k++) { const i = Math.min(n - 1, Math.round((n - 1) * k / 4)); g += `<text x="${Math.min(W - pad.r - 40, Math.max(pad.l, X(i) - 18)).toFixed(1)}" y="${H - 5}" fill="#5f5a82" font-size="10.5" font-family="JBM,monospace">${esc(tl(P[i][0], S.range))}</text>`; }
    let cand = '', vol = '';
    for (let i = 0; i < n; i++) {
      const [t, o, h, l, cl, v] = P[i], up = cl >= o, col = up ? '#6ef5a8' : '#ff5c6c', x = X(i);
      cand += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(h).toFixed(1)}" y2="${Y(l).toFixed(1)}" stroke="${col}" stroke-width="1"/>`;
      const y0 = Y(Math.max(o, cl)), y1 = Y(Math.min(o, cl));
      cand += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y1 - y0).toFixed(1)}" fill="${up ? col : col}" fill-opacity="${up ? 0.9 : 0.9}"/>`;
      if (v) { const hgt = Math.max(1, vh * v / vmax); vol += `<rect x="${(x - bw / 2).toFixed(1)}" y="${(vy0 - hgt).toFixed(1)}" width="${bw.toFixed(1)}" height="${hgt.toFixed(1)}" fill="${col}" fill-opacity=".28"/>`; }
    }
    const last = P[n - 1][4], ly = Y(last), lastUp = last >= (S.range === '1D' && c.prev ? c.prev : P[0][1]);
    const prevL = S.range === '1D' && c.prev ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(c.prev).toFixed(1)}" y2="${Y(c.prev).toFixed(1)}" stroke="#a49fc2" stroke-opacity=".4" stroke-dasharray="4 4"/><text x="${pad.l + 4}" y="${(Y(c.prev) - 4).toFixed(1)}" fill="#5f5a82" font-size="10" font-family="JBM,monospace">prev close ${px(c.prev)}</text>` : '';
    const lastTag = `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${lastUp ? '#6ef5a8' : '#ff5c6c'}" stroke-opacity=".5" stroke-dasharray="1 3"/><rect x="${W - pad.r + 2}" y="${(ly - 9).toFixed(1)}" width="${pad.r - 4}" height="18" fill="${lastUp ? '#6ef5a8' : '#ff5c6c'}"/><text x="${W - pad.r + 7}" y="${(ly + 4).toFixed(1)}" fill="#06050c" font-size="10.5" font-weight="700" font-family="JBM,monospace">${px(last)}</text>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}${prevL}${vol}${cand}${lastTag}<line id="cx" y1="${pad.t}" y2="${H - pad.b}" stroke="#a49fc2" stroke-opacity=".5" stroke-dasharray="3 3" visibility="hidden"/><line id="cy" x1="${pad.l}" x2="${W - pad.r}" stroke="#a49fc2" stroke-opacity=".5" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
    const svg = box.querySelector('svg'), cx = svg.querySelector('#cx'), cy = svg.querySelector('#cy');
    const oh = i => { const [t, o, h, l, cl, v] = P[i]; $('#ohlc').innerHTML = `${esc(tl(t, S.range))} O <b>${px(o)}</b> H <b>${px(h)}</b> L <b>${px(l)}</b> C <b class="${cl >= o ? 'up' : 'dn'}">${px(cl)}</b>${v ? ' V <b>' + int(v) + '</b>' : ''}`; };
    oh(n - 1);
    const move = e => { const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height; const i = Math.max(0, Math.min(n - 1, Math.floor((x - pad.l) / cw))); cx.setAttribute('x1', X(i)); cx.setAttribute('x2', X(i)); cx.setAttribute('visibility', 'visible'); cy.setAttribute('y1', y); cy.setAttribute('y2', y); cy.setAttribute('visibility', y < pad.t + ph ? 'visible' : 'hidden'); oh(i); };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { cx.setAttribute('visibility', 'hidden'); cy.setAttribute('visibility', 'hidden'); oh(n - 1); });
  }
  let rzT = 0; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(drawChart, 120); });

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
    else if (!WAL.W.addr) { t = '[ CONNECT WALLET ]'; on = true; }
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
    $('#wslot').innerHTML = w.addr ? `<span class="who"><span class="ad">${short(w.addr)}</span><button class="kb" id="dc">[ x ]</button></span>` : `<button class="kb hot" data-connect>[ connect ]</button>`;
    const dc = $('#dc'); if (dc) dc.onclick = () => { WAL.disconnect(); S.bal = null; renderAll(); };
    S.bal = null; if (w.addr) refreshBal(); renderAll();
  });
  async function refreshBal() {
    const a = WAL.W.addr; if (!a) return;
    try { const b = await api('wallet', { addr: a }); if (a !== WAL.W.addr) return; S.bal = b; S.balAt = Date.now(); S.balErr = null; } catch (e) { S.balErr = e.message; }
    renderAccount(); renderTicket(); if (S.view === 'portfolio') renderPortfolio();
  }
  function totals() {
    const B = S.bal, st = B.tokens.filter(t => ['stock', 'etf', 'metal'].includes(t.kind)), cash = B.tokens.filter(t => t.kind === 'cash'), oth = B.tokens.filter(t => t.kind === 'token' && t.value != null && t.value >= 0.01);
    const vS = st.reduce((a, t) => a + (t.value || 0), 0), vC = (B.solValue || 0) + cash.reduce((a, t) => a + (t.value || 0), 0), vO = oth.reduce((a, t) => a + (t.value || 0), 0);
    const day = st.reduce((a, t) => a + (t.value != null && t.ch24 != null ? t.value - t.value / (1 + t.ch24 / 100) : 0), 0) + (B.solValue && B.solCh24 != null ? B.solValue - B.solValue / (1 + B.solCh24 / 100) : 0);
    return { st, cash, oth, vS, vC, vO, tot: vS + vC + vO, day };
  }
  function renderAccount() {
    const a = $('#acc');
    if (!WAL.W.addr) { $('#accR').textContent = ''; a.innerHTML = `<div class="mute">no wallet connected.</div><div class="sub" style="font-size:11.5px">connect phantom, solflare or backpack. your keys never leave your wallet.</div><div><button class="kb hot" data-connect>[ connect wallet ]</button></div>`; return; }
    $('#accR').innerHTML = `<a class="mute" style="text-transform:none;letter-spacing:0" href="https://solscan.io/account/${esc(WAL.W.addr)}" target="_blank" rel="noopener">${short(WAL.W.addr)} ↗</a>`;
    if (!S.bal) { a.innerHTML = `<div class="mute">${S.balErr ? 'could not read the wallet: ' + esc(S.balErr) : 'reading your wallet<span class="spin"></span>'}</div>`; return; }
    const T = totals(), B = S.bal;
    const seg = (v, c) => T.tot > 0 && v > 0 ? `<i style="width:${(v / T.tot * 100).toFixed(2)}%;background:${c}"></i>` : '';
    a.innerHTML = `<div><div class="lbl">NET WORTH</div><div class="nw">${usd(T.tot)}</div><div class="${cls(T.day)}" style="font-size:11.5px">${T.day >= 0 ? '+' : '−'}${usd(Math.abs(T.day))} today</div></div>
      <div class="bar2">${seg(T.vS, '#ffb48f')}${seg(T.vC, '#a68cff')}${seg(T.vO, '#ff8fb1')}</div>
      <div>${[['SOL', B.solIcon, amt(B.sol, 4), B.solValue, B.solCh24]].concat(T.cash.map(t => ['USDC', t.icon, amt(t.amount, 2), t.value, null])).concat(T.st.map(t => [t.sym, t.icon, amt(t.amount), t.value, t.ch24])).map(([sy, ic, am, v, ch]) => `<div class="ln" data-sym="${esc(sy)}">${lg(sy, ic, 'm')}<div><b>${esc(sy)}</b><small>${am}</small></div><div class="r">${usd(v)}<small class="${cls(ch)}">${ch == null ? '' : pc(ch)}</small></div></div>`).join('')}</div>
      ${T.st.length ? '' : '<div class="mute" style="font-size:11.5px">no stocks yet. the city is waiting.</div>'}`;
  }
  $('#acc').addEventListener('click', e => { const r = e.target.closest('.ln[data-sym]'); if (r && S.by[r.dataset.sym]) pick(r.dataset.sym); });

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
      (L.map(s => `<div class="tr${s.thin ? ' thin' : ''}" data-sym="${esc(s.sym)}"><span>${lg(s.sym, s.icon)} <b>${esc(s.sym)}</b></span><span class="nmc">${esc(s.name)}</span><span class="mute">${esc(s.kind)}</span><span class="r">${s.thin ? 'thin' : px(s.usd)}</span><span class="r ${cls(s.ch24)}">${s.thin ? '—' : pc(s.ch24)}</span><span class="r">${big(s.liq)}</span><span class="r">${big(s.vol24)}</span><span class="r">${int(s.holders)}</span><span class="r">${big(s.mcap)}</span><span class="go2">trade →</span></div>`).join('') || '<div class="empty">no match.</div>');
  }
  $('#mkq').addEventListener('input', e => { S.mq = e.target.value; renderMarkets(); });
  $('#mkKind').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.mk = b.dataset.k; $$('#mkKind button').forEach(x => x.classList.toggle('on', x === b)); renderMarkets(); });
  $('#mkTbl').addEventListener('click', e => { const s = e.target.closest('[data-sort]'); if (s) { const k = s.dataset.sort; if (S.ms === k) S.md *= -1; else { S.ms = k; S.md = -1; } renderMarkets(); return; } const r = e.target.closest('.tr[data-sym]'); if (r) pick(r.dataset.sym); });

  // ---------------------------------------------------------------- portfolio
  function renderPortfolio() {
    const pf = $('#pf');
    if (!WAL.W.addr) { pf.innerHTML = `<h1>portfolio</h1><div class="lead">your empire, priced live from the chain.</div><div class="pn" style="padding:22px"><div class="mute">no wallet connected.</div><div style="margin-top:12px"><button class="kb hot" data-connect>[ connect wallet ]</button></div></div>`; return; }
    if (!S.bal) { pf.innerHTML = `<h1>portfolio</h1><div class="lead">${S.balErr ? 'could not read the wallet: ' + esc(S.balErr) : 'reading your wallet<span class="spin"></span>'}</div>`; return; }
    const T = totals(), B = S.bal;
    const seg = (v, c) => T.tot > 0 && v > 0 ? `<i style="width:${(v / T.tot * 100).toFixed(2)}%;background:${c}"></i>` : '';
    const row = t => `<div class="tr" data-sym="${esc(t.sym)}" style="grid-template-columns:minmax(150px,1.2fr) minmax(150px,1.6fr) 120px 110px 110px 92px 70px"><span>${lg(t.sym, t.icon)} <b>${esc(t.sym)}</b></span><span class="nmc">${esc(t.name)}</span><span class="r">${amt(t.amount)}</span><span class="r">${usd(t.price)}</span><span class="r"><b>${usd(t.value)}</b></span><span class="r ${cls(t.ch24)}">${pc(t.ch24)}</span><span class="go2">${S.by[t.sym] ? 'trade →' : ''}</span></div>`;
    const head = `<div class="tr th" style="grid-template-columns:minmax(150px,1.2fr) minmax(150px,1.6fr) 120px 110px 110px 92px 70px"><span>SYMBOL</span><span>NAME</span><span class="r">AMOUNT</span><span class="r">PRICE</span><span class="r">VALUE</span><span class="r">24H</span><span></span></div>`;
    pf.innerHTML = `<h1>portfolio</h1><div class="lead"><a class="sub" href="https://solscan.io/account/${esc(B.wallet)}" target="_blank" rel="noopener">${short(B.wallet)} ↗</a> · <button class="sub" id="pfr" style="text-decoration:underline">refresh</button></div>
      <div class="pf-top"><div class="pn"><div class="lbl">NET WORTH</div><div class="big">${usd(T.tot)}</div><div class="${cls(T.day)}">${T.day >= 0 ? '+' : '−'}${usd(Math.abs(T.day))} today</div><div class="bar2" style="margin-top:12px">${seg(T.vS, '#ffb48f')}${seg(T.vC, '#a68cff')}${seg(T.vO, '#ff8fb1')}</div><div class="legend"><span><i style="background:#ffb48f"></i>stocks ${usd(T.vS)}</span><span><i style="background:#a68cff"></i>cash ${usd(T.vC)}</span><span><i style="background:#ff8fb1"></i>other ${usd(T.vO)}</span></div></div>
      <div class="pn"><div class="lbl">CASH</div><div style="display:grid;gap:8px;margin-top:10px"><div>${lg('SOL', B.solIcon, 'm')} <b>${amt(B.sol, 4)} SOL</b> <span class="mute">${usd(B.solValue)}</span></div>${(T.cash.length ? T.cash : [{ amount: 0, value: 0, icon: usdcIcon() }]).map(t => `<div>${lg('USDC', t.icon, 'm')} <b>${amt(t.amount, 2)} USDC</b> <span class="mute">${usd(t.value)}</span></div>`).join('')}</div></div></div>
      <div class="lbl" style="margin:14px 0 6px">STOCKS · ${T.st.length}</div>
      <div class="scroll-x"><div class="tbl" style="min-width:760px">${T.st.length ? head + T.st.map(row).join('') : '<div class="empty">no stocks yet. the city is waiting. <a href="#markets" style="color:var(--peach)">browse markets →</a></div>'}</div></div>
      ${T.oth.length ? `<div class="lbl" style="margin:14px 0 6px">OTHER TOKENS · ${T.oth.length}</div><div class="scroll-x"><div class="tbl" style="min-width:760px">${head + T.oth.slice(0, 30).map(row).join('')}</div></div>` : ''}`;
    const r = $('#pfr'); if (r) r.onclick = () => { r.textContent = 'refreshing…'; refreshBal(); };
    pf.querySelectorAll('.tr[data-sym]').forEach(n => n.onclick = () => { if (S.by[n.dataset.sym]) pick(n.dataset.sym); });
  }

  // ---------------------------------------------------------------- command line
  const cmd = $('#cmd');
  let outT = 0;
  function cmdOut(t, k) { const o = $('#cmdOut'); o.textContent = t; o.className = 'out ' + (k || ''); clearTimeout(outT); outT = setTimeout(() => { o.textContent = ''; }, 9000); }
  const findSym = w => { if (!w || !S.P) return null; const u = w.toUpperCase().replace(/X$/, ''); if (S.by[u]) return u; if (S.by[w.toUpperCase()]) return w.toUpperCase(); const n = S.P.stocks.find(s => s.name.toLowerCase().startsWith(w.toLowerCase()) || s.tok.toUpperCase() === w.toUpperCase()); return n ? n.sym : null; };
  const HELP = 'buy <sym> <amt> [sol|usdc] · sell <sym> <amt|all|50%> · chart <sym> [1d|1w|1m|6m|1y] · <sym> · find <text> · markets · portfolio · connect · clear';
  function run(line) {
    const w = line.trim().split(/\s+/).filter(Boolean); if (!w.length) return;
    const c = w[0].toLowerCase();
    if (c === 'help' || c === '?') return cmdOut(HELP);
    if (c === 'clear') { $('#log').innerHTML = ''; return cmdOut(''); }
    if (c === 'connect') { openWallet(); return cmdOut('pick a wallet'); }
    if (c === 'disconnect') { WAL.disconnect(); return cmdOut('disconnected', 'ok'); }
    if (c === 'markets' || c === 'ls') { location.hash = '#markets'; return cmdOut('all stocks', 'ok'); }
    if (c === 'portfolio' || c === 'pf') { location.hash = '#portfolio'; return cmdOut('your portfolio', 'ok'); }
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
    if (e.key === '1' || e.key === '2' || e.key === '3') { location.hash = ['#trade', '#markets', '#portfolio'][+e.key - 1]; return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.view === 'trade' && S.P) { e.preventDefault(); const L = wlList(), i = L.findIndex(s => s.sym === S.sym); const n = L[Math.max(0, Math.min(L.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) pick(n.sym); }
  });

  // ---------------------------------------------------------------- router
  function show(v) {
    S.view = v;
    $$('.view').forEach(n => n.classList.toggle('on', n.id === 'v-' + v));
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.v === v));
    if (v === 'trade') { renderTicket(); requestAnimationFrame(drawChart); }
    if (v === 'markets') renderMarkets();
    if (v === 'portfolio') { renderPortfolio(); if (WAL.W.addr && Date.now() - S.balAt > 8000) refreshBal(); }
  }
  function route() {
    const [v, a] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
    if (v === 'markets') return show('markets');
    if (v === 'portfolio') return show('portfolio');
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
  setInterval(() => { if (!document.hidden && WAL.W.addr) refreshBal(); }, 30000);
  WAL.restore();
})();
