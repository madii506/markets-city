// markets API. Live prices, Jupiter quotes and swap transactions, wallet balances, tx status, charts.
// No keys, no custody: every transaction it builds is signed in the user's own wallet.
const CFG = require('./markets.json');

const JUP = 'https://lite-api.jup.ag';
const SOL = CFG.sol, USDC = CFG.usdc;
const STOCKS = CFG.stocks;
const BY_MINT = Object.fromEntries(STOCKS.map(s => [s.mint, s]));
const BY_SYM = Object.fromEntries(STOCKS.map(s => [s.sym, s]));
const THIN = 5000;                                   // below this much on-chain liquidity a price is not trustworthy
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const RPCS = [process.env.RPC_URL, 'https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'].filter(Boolean);
const LOGO = s => `https://xstocks-metadata.backed.fi/logos/tokens/${s.tok}.png`;
const SOL_ICON = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png';
const USDC_ICON = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const out = (res, code, body, cache) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache || 'no-store'); res.end(JSON.stringify(body)); };
const body = req => new Promise(ok => { if (req.body) return ok(typeof req.body === 'string' ? safeJSON(req.body) : req.body); let d = ''; req.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); }); req.on('end', () => ok(safeJSON(d))); });
const safeJSON = s => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { const e = new Error(m); e.user = true; throw e; };

async function getJ(url, init, ms = 9000) {
  for (let k = 0; k < 2; k++) {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } }, init || {}));
    if (r.status === 429 && !k) { await sleep(1200); continue; }
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { }
    if (!r.ok) { const m = j && (j.error || j.message || (j.errorCode && String(j.errorCode))); const e = new Error(m || url.split('/')[2] + ' ' + r.status); e.status = r.status; e.body = j; throw e; }
    return j;
  }
}

const cache = new Map(), flying = new Map();
async function memo(k, ttl, fn) {
  const c = cache.get(k); if (c && Date.now() - c.t < ttl) return c.v;
  if (flying.has(k)) return flying.get(k);
  const p = (async () => { try { const v = await fn(); cache.set(k, { t: Date.now(), v }); return v; } catch (e) { if (c) return c.v; throw e; } finally { flying.delete(k); } })();
  flying.set(k, p); return p;
}

async function rpc(method, params) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10000) });
      if (r.status === 429 || r.status === 401 || r.status === 403 || r.status >= 500) { last = new Error('Solana RPC ' + r.status); continue; }
      const j = await r.json();
      if (j.error) { last = new Error(j.error.message || 'Solana RPC error'); if (/busy|rate|limit|timeout|unavailable/i.test(last.message)) continue; throw last; }
      return j.result;
    } catch (e) { last = e; }
  }
  throw last || new Error('Solana is busy, try again');
}

// ---------------------------------------------------------------- token data (Jupiter)
async function jupTokens(mints) {
  const o = {}, L = [...new Set(mints)].filter(Boolean);
  await Promise.all(Array.from({ length: Math.ceil(L.length / 90) }, (_, i) => L.slice(i * 90, i * 90 + 90)).map(async chunk => {
    try { const j = await getJ(`${JUP}/tokens/v2/search?query=${chunk.join(',')}`); for (const t of j || []) o[t.id] = t; } catch { }
  }));
  return o;
}

async function prices() {
  return memo('prices', 15000, async () => {
    const info = await jupTokens([SOL, USDC, ...STOCKS.map(s => s.mint)]);
    if (!Object.keys(info).length) throw new Error('price feed offline');
    const stocks = STOCKS.map(s => {
      const t = info[s.mint] || {}, liq = t.liquidity != null ? t.liquidity : null, thin = !(liq >= THIN), st = t.stats24h || {};
      return { sym: s.sym, name: s.name, tok: s.tok, mint: s.mint, kind: s.kind, icon: t.icon || LOGO(s), decimals: t.decimals != null ? t.decimals : 8,
        usd: thin ? null : (t.usdPrice != null ? t.usdPrice : null), ch24: thin ? null : (st.priceChange != null ? st.priceChange : null),
        rawUsd: t.usdPrice != null ? t.usdPrice : null, mcap: t.mcap != null ? t.mcap : (t.fdv != null ? t.fdv : null), liq, holders: t.holderCount != null ? t.holderCount : null,
        vol24: (st.buyVolume != null || st.sellVolume != null) ? (st.buyVolume || 0) + (st.sellVolume || 0) : null, thin };
    });
    const sol = info[SOL] || {}, usdc = info[USDC] || {};
    return { t: Date.now(), sol: { usd: sol.usdPrice != null ? sol.usdPrice : null, ch24: sol.stats24h ? sol.stats24h.priceChange : null, icon: sol.icon || SOL_ICON }, usdc: { usd: usdc.usdPrice != null ? usdc.usdPrice : 1, icon: usdc.icon || USDC_ICON }, stocks };
  });
}

// decimals + Token-2022 scaled-UI multiplier (xStocks use it for dividends and splits)
async function mintMeta(mint) {
  if (mint === SOL) return { decimals: 9, mult: 1 };
  if (mint === USDC) return { decimals: 6, mult: 1 };
  return memo('mint:' + mint, 600000, async () => {
    const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const info = r && r.value && r.value.data && r.value.data.parsed && r.value.data.parsed.info;
    if (!info) fail('unknown token');
    let mult = 1;
    const ext = (info.extensions || []).find(e => e.extension === 'scaledUiAmountConfig');
    if (ext && ext.state) { const st = ext.state, now = Date.now() / 1000; const m = +(st.newMultiplier && now >= +(st.newMultiplierEffectiveTimestamp || 0) ? st.newMultiplier : st.multiplier); if (m > 0) mult = m; }
    return { decimals: info.decimals, mult };
  });
}
const toUi = (raw, m) => Number(BigInt(raw)) / 10 ** m.decimals * m.mult;

// only cash <-> listed stock, or SOL <-> USDC
function mintOf(x) {
  x = String(x || '');
  if (x === 'SOL') return SOL; if (x === 'USDC') return USDC;
  if (BY_SYM[x]) return BY_SYM[x].mint;
  if (BY_MINT[x] || x === SOL || x === USDC) return x;
  fail('that market is not listed here');
}
const CASH = new Set([SOL, USDC]);

async function quote(q) {
  const inM = mintOf(q.get('in')), outM = mintOf(q.get('out'));
  if (inM === outM) fail('pick two different assets');
  if (!(CASH.has(inM) || CASH.has(outM))) fail('trade stocks against SOL or USDC');
  const amt = String(q.get('amt') || '');
  if (!/^\d{1,20}$/.test(amt) || BigInt(amt) <= 0n) fail('enter an amount above zero');
  const slip = Math.min(500, Math.max(10, parseInt(q.get('slip') || '100', 10) || 100));
  let j;
  try { j = await getJ(`${JUP}/swap/v1/quote?inputMint=${inM}&outputMint=${outM}&amount=${amt}&slippageBps=${slip}&restrictIntermediateTokens=true`); }
  catch (e) { const m = String(e.message || ''); if (/NO_ROUTE|COULD_NOT_FIND|No routes/i.test(m)) fail('no route for that trade right now, try a smaller amount'); if (/too small|AMOUNT/i.test(m)) fail('that amount is too small to route'); throw e; }
  if (!j || !j.outAmount) fail('no route for that trade right now');
  const meta = async m => { try { return await mintMeta(m); } catch { const s = BY_MINT[m]; return { decimals: s ? 8 : 9, mult: 1 }; } };
  const [mi, mo] = await Promise.all([meta(inM), meta(outM)]);
  const P = await prices().catch(() => null);
  const usdOf = (m, ui) => { if (!P) return null; if (m === SOL) return P.sol.usd != null ? P.sol.usd * ui : null; if (m === USDC) return ui; const s = P.stocks.find(x => x.mint === m); return s && s.rawUsd != null ? s.rawUsd * ui : null; };
  const inUi = toUi(j.inAmount, mi), outUi = toUi(j.outAmount, mo), minUi = toUi(j.otherAmountThreshold, mo);
  return { quote: j, inUi, outUi, minUi, inUsd: usdOf(inM, inUi), outUsd: usdOf(outM, outUi), impact: +j.priceImpactPct || 0,
    route: (j.routePlan || []).map(r => r.swapInfo && r.swapInfo.label).filter(Boolean), slip };
}

async function swap(b) {
  const user = String(b.user || '');
  if (!B58.test(user)) fail('connect a wallet first');
  const q = b.quote;
  if (!q || !q.inputMint || !q.outputMint || !q.outAmount) fail('get a fresh quote first');
  mintOf(q.inputMint); mintOf(q.outputMint);
  let j;
  try {
    j = await getJ(`${JUP}/swap/v1/swap`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ quoteResponse: q, userPublicKey: user, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1500000, priorityLevel: 'high' } } }) }, 15000);
  } catch (e) { fail(/expired|stale/i.test(e.message) ? 'that quote expired, get a fresh one' : 'could not build the swap: ' + e.message); }
  if (!j || !j.swapTransaction) fail('could not build the swap');
  return { tx: j.swapTransaction, lastValidBlockHeight: j.lastValidBlockHeight || null };
}

async function send(b) {
  const tx = String(b.tx || '');
  if (!/^[A-Za-z0-9+/=]{100,3000}$/.test(tx)) fail('nothing to send');
  const sig = await rpc('sendTransaction', [tx, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
  return { sig };
}

async function status(sig) {
  sig = String(sig || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) fail('bad signature');
  const r = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: true }]);
  const s = r && r.value && r.value[0];
  return { sig, status: !s ? 'pending' : s.err ? 'failed' : (s.confirmationStatus || 'processed'), err: s && s.err ? s.err : null };
}

// ---------------------------------------------------------------- wallet: everything you hold, priced
async function wallet(addr) {
  addr = String(addr || '');
  if (!B58.test(addr)) fail('bad wallet address');
  const [bal, a1, a2] = await Promise.all([
    rpc('getBalance', [addr, { commitment: 'confirmed' }]),
    rpc('getTokenAccountsByOwner', [addr, { programId: TOKEN }, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    rpc('getTokenAccountsByOwner', [addr, { programId: TOKEN22 }, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
  ]);
  const held = {};
  for (const x of [...((a1 && a1.value) || []), ...((a2 && a2.value) || [])]) {
    const i = x.account.data.parsed.info, ta = i.tokenAmount, raw = BigInt(ta.amount);
    if (raw <= 0n) continue;
    const h = held[i.mint] || (held[i.mint] = { raw: 0n, ui: 0, decimals: ta.decimals });
    h.raw += raw; h.ui += +(ta.uiAmountString != null ? ta.uiAmountString : ta.uiAmount) || 0;
  }
  const P = await prices().catch(() => null);
  const others = Object.keys(held).filter(m => !BY_MINT[m] && m !== USDC).slice(0, 80);
  const info = others.length ? await jupTokens(others) : {};
  const solUsd = P && P.sol.usd;
  const tokens = Object.entries(held).map(([m, h]) => {
    const st = BY_MINT[m], live = P && st ? P.stocks.find(x => x.mint === m) : null, t = info[m] || {};
    const price = m === USDC ? (P ? P.usdc.usd : 1) : live ? live.rawUsd : (t.usdPrice != null ? t.usdPrice : null);
    return { mint: m, sym: m === USDC ? 'USDC' : st ? st.sym : (t.symbol || m.slice(0, 4)), name: m === USDC ? 'USD Coin' : st ? st.name : (t.name || ''),
      icon: m === USDC ? ((P && P.usdc.icon) || USDC_ICON) : st ? ((live && live.icon) || LOGO(st)) : (t.icon || null),
      amount: h.ui, raw: h.raw.toString(), decimals: h.decimals, price, value: price != null ? price * h.ui : null,
      ch24: live ? live.ch24 : (t.stats24h ? t.stats24h.priceChange : null), kind: m === USDC ? 'cash' : st ? st.kind : 'token', thin: live ? live.thin : false, verified: !!t.isVerified };
  }).sort((x, y) => (y.value || 0) - (x.value || 0));
  const sol = bal / 1e9, solValue = solUsd != null ? sol * solUsd : null;
  const total = (solValue || 0) + tokens.reduce((a, t) => a + (t.value || 0), 0);
  return { wallet: addr, sol, lamports: bal, solUsd, solValue, solCh24: P && P.sol.ch24, solIcon: (P && P.sol.icon) || SOL_ICON, tokens, total, t: Date.now() };
}

// ---------------------------------------------------------------- charts: the real share on its exchange, else the token's own pool
const RANGES = { '1D': ['1d', '5m', 60e3], '1W': ['5d', '30m', 300e3], '1M': ['1mo', '60m', 900e3], '6M': ['6mo', '1d', 3600e3], '1Y': ['1y', '1d', 3600e3] };
async function chart(sym, r) {
  const s = BY_SYM[sym]; if (!s) fail('unknown stock');
  const R = RANGES[r] || RANGES['1D'];
  const ysym = s.tok.replace(/x$/, '').replace('.', '-');
  return memo(`chart:${sym}:${r}`, R[2], async () => {
    try {
      const j = await getJ(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?range=${R[0]}&interval=${R[1]}&includePrePost=false`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', accept: 'application/json' } });
      const res = j && j.chart && j.chart.result && j.chart.result[0]; if (!res) throw new Error('no chart');
      const ts = res.timestamp || [], cl = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
      const pts = []; for (let k = 0; k < ts.length; k++) if (cl[k] != null) pts.push([ts[k] * 1000, +cl[k].toFixed(4)]);
      if (pts.length < 2) throw new Error('no chart');
      const m = res.meta || {};
      return { sym, src: 'share', label: `${ysym} · ${m.fullExchangeName || m.exchangeName || 'US market'}`, pts, prev: m.chartPreviousClose != null ? m.chartPreviousClose : (m.previousClose != null ? m.previousClose : pts[0][1]), last: m.regularMarketPrice != null ? m.regularMarketPrice : pts[pts.length - 1][1], state: m.currentTradingPeriod ? marketState(m.currentTradingPeriod) : null };
    } catch (e) {
      const pools = await getJ(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${s.mint}/pools?page=1`);
      const pool = pools && pools.data && pools.data[0] && pools.data[0].attributes && pools.data[0].attributes.address; if (!pool) fail('no chart for this stock yet');
      const tf = { '1D': ['minute', 15, 96], '1W': ['hour', 1, 168], '1M': ['hour', 4, 180], '6M': ['day', 1, 180], '1Y': ['day', 1, 365] }[r] || ['minute', 15, 96];
      const o = await getJ(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${tf[0]}?aggregate=${tf[1]}&limit=${tf[2]}&currency=usd&token=${s.mint}`);
      const L = ((o && o.data && o.data.attributes && o.data.attributes.ohlcv_list) || []).map(c => [c[0] * 1000, +c[4]]).reverse();
      if (L.length < 2) fail('no chart for this stock yet');
      return { sym, src: 'pool', label: `${s.tok} · on-chain pool`, pts: L, prev: L[0][1], last: L[L.length - 1][1], state: null };
    }
  });
}
function marketState(p) { const now = Date.now() / 1000, reg = p.regular; if (reg && now >= reg.start && now < reg.end) return 'open'; if (p.pre && now >= p.pre.start && now < p.pre.end) return 'pre'; if (p.post && now >= p.post.start && now < p.post.end) return 'after'; return 'closed'; }

// one-day sparklines for a handful of stocks at once (homepage cards)
async function sparks(list) {
  const syms = String(list || '').split(',').filter(x => BY_SYM[x]).slice(0, 16);
  const o = {};
  await Promise.all(syms.map(async s => { try { const c = await chart(s, '1D'); o[s] = c.pts.filter((_, k, a) => k % Math.max(1, Math.floor(a.length / 48)) === 0).map(p => p[1]); } catch { } }));
  return { sparks: o };
}

module.exports = async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  const q = new URL(req.url, 'http://x').searchParams, a = q.get('a');
  try {
    if (a === 'prices') return out(res, 200, await prices(), 'public, s-maxage=15, stale-while-revalidate=45');
    if (a === 'quote') return out(res, 200, await quote(q));
    if (a === 'swap' && req.method === 'POST') return out(res, 200, await swap(await body(req)));
    if (a === 'send' && req.method === 'POST') return out(res, 200, await send(await body(req)));
    if (a === 'status') return out(res, 200, await status(q.get('sig')));
    if (a === 'wallet') return out(res, 200, await wallet(q.get('addr')));
    if (a === 'chart') return out(res, 200, await chart(q.get('sym'), q.get('r')), 'public, s-maxage=60, stale-while-revalidate=300');
    if (a === 'sparks') return out(res, 200, await sparks(q.get('syms')), 'public, s-maxage=300, stale-while-revalidate=900');
    if (a === 'list') return out(res, 200, { stocks: STOCKS }, 'public, s-maxage=3600');
    return out(res, 404, { error: 'unknown action' });
  } catch (e) {
    return out(res, e.user ? 400 : 502, { error: String((e && e.message) || e).slice(0, 220) });
  }
};
