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
const CITY = require('./city.json');
const CITY_BY_ID = Object.fromEntries(CITY.map(c => [c.id, c]));
const SITE = (process.env.SITE_URL || 'https://markets-city.vercel.app').replace(/\/$/, '');

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

// ---------------------------------------------------------------- the city registry (Postgres): who founded which item, and its coin
let pg = null, pgReady = null;
function db() {
  if (pg) return pg;
  if (process.env.MK_PGLITE) { const { PGlite } = require(process.env.MK_PGLITE); const lite = new PGlite(); pg = (s, ...v) => lite.sql(s, ...v).then(r => r.rows); return pg; }
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL; if (!url) return null;
  const { neon } = require('@neondatabase/serverless'); pg = neon(url); return pg;
}
async function ensure() {
  const q = db(); if (!q) return null;
  if (!pgReady) pgReady = q`create table if not exists mk_city (item text primary key, status text not null, founder text not null, mint text not null, sig text, uri text, expires timestamptz, t timestamptz default now())`.then(() => q).catch(e => { pgReady = null; throw e; });
  return pgReady;
}
const flushCity = () => { for (const k of ['city:reg', 'city:list', 'prices']) cache.delete(k); };
async function registry() {
  return memo('city:reg', 8000, async () => {
    const q = await ensure(); if (!q) return { on: false, rows: [] };
    return { on: true, rows: await q`select item, status, founder, mint, sig, uri, expires, t from mk_city` };
  });
}
async function mintExists(mint) { try { const r = await rpc('getAccountInfo', [mint, { encoding: 'base64', commitment: 'confirmed' }]); return !!(r && r.value); } catch { return false; } }
const isOpenRow = r => !r || (r.status === 'pending' && new Date(r.expires) < new Date());
async function cityList() {
  return memo('city:list', 10000, async () => {
    const R = await registry().catch(() => ({ on: false, rows: [] }));
    // a founder who signed but never came back: if the coin exists on-chain, it is live
    for (const r of R.rows) if (r.status === 'pending' && new Date(r.expires) < new Date() && await mintExists(r.mint)) {
      try { const q = await ensure(); await q`update mk_city set status = 'live' where item = ${r.item} and mint = ${r.mint}`; r.status = 'live'; } catch { }
    }
    const by = Object.fromEntries(R.rows.map(r => [r.item, r]));
    const live = R.rows.filter(r => r.status === 'live').map(r => r.mint);
    const info = live.length ? await jupTokens(live) : {};
    const items = CITY.map(c => {
      const r = by[c.id], status = !r ? 'open' : r.status === 'live' ? 'live' : isOpenRow(r) ? 'open' : 'pending';
      const t = (status === 'live' && info[r.mint]) || {}, st = t.stats24h || {};
      return { id: c.id, name: c.name, sym: c.sym, cat: c.cat, icon: c.icon, line: c.line, status,
        mint: status === 'open' ? null : r.mint, founder: status === 'open' ? null : r.founder, sig: status === 'live' ? r.sig || null : null, since: status === 'live' ? r.t : null,
        logo: t.icon || null, usd: t.usdPrice != null ? t.usdPrice : null, mcap: t.mcap != null ? t.mcap : (t.fdv != null ? t.fdv : null), liq: t.liquidity != null ? t.liquidity : null,
        ch24: st.priceChange != null ? st.priceChange : null, holders: t.holderCount != null ? t.holderCount : null,
        vol24: (st.buyVolume != null || st.sellVolume != null) ? (st.buyVolume || 0) + (st.sellVolume || 0) : null };
    });
    return { registry: R.on, items, t: Date.now() };
  });
}
async function cityLive() { const c = await cityList().catch(() => ({ items: [] })); return c.items.filter(i => i.status === 'live' && i.mint); }

// claim an open item: reserve it, put its image + metadata on pump.fun's IPFS, and have PumpPortal build the create
// transaction for the founder's wallet. The founder's browser holds the new mint key and signs; nothing is custodied here.
async function claim(b) {
  const it = CITY_BY_ID[String(b.item || '')]; if (!it) fail('unknown item');
  const user = String(b.user || ''), mint = String(b.mint || '');
  if (!B58.test(user)) fail('connect a wallet first');
  if (!B58.test(mint)) fail('bad mint address');
  const buy = Math.round(Math.max(0, Math.min(10, +b.buy || 0)) * 1e4) / 1e4;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || '')); if (!m) fail('missing the coin image');
  const png = Buffer.from(m[1], 'base64'); if (png.length < 200 || png.length > 1.5e6) fail('bad coin image');
  const q = await ensure(); if (!q) fail('the city registry is not connected yet');
  const [old] = await q`select item, status, mint, expires from mk_city where item = ${it.id}`;
  if (old && old.status === 'live') fail(`${it.name} already has a founder`);
  if (old && old.status === 'pending' && new Date(old.expires) < new Date() && await mintExists(old.mint)) { await q`update mk_city set status = 'live' where item = ${it.id}`; flushCity(); fail(`${it.name} already has a founder`); }
  const got = await q`insert into mk_city (item, status, founder, mint, expires) values (${it.id}, 'pending', ${user}, ${mint}, now() + interval '4 minutes')
    on conflict (item) do update set status = 'pending', founder = excluded.founder, mint = excluded.mint, expires = excluded.expires, sig = null, uri = null
    where mk_city.status = 'pending' and mk_city.expires < now() returning item`;
  if (!got.length) fail('someone is founding it right now, try again in a few minutes');
  flushCity();
  try {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), it.id + '.png');
    fd.append('name', it.name); fd.append('symbol', it.sym);
    fd.append('description', `${it.line} A markets city asset. ${SITE}/app#city/${it.id}`);
    fd.append('twitter', String(b.x || '')); fd.append('telegram', ''); fd.append('website', `${SITE}/app#city/${it.id}`); fd.append('showName', 'true');
    const ip = await fetch('https://pump.fun/api/ipfs', { method: 'POST', body: fd, signal: AbortSignal.timeout(25000) });
    const ij = await ip.json().catch(() => null);
    if (!ip.ok || !ij || !ij.metadataUri) throw new Error(`pump.fun did not take the image (${ip.status})`);
    const r = await fetch('https://pumpportal.fun/api/trade-local', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({ publicKey: user, action: 'create', tokenMetadata: { name: it.name, symbol: it.sym, uri: ij.metadataUri }, mint, denominatedInSol: 'true', amount: buy, slippage: 10, priorityFee: 0.0005, pool: 'pump' }) });
    if (r.status !== 200) { const t = await r.text().catch(() => ''); throw new Error('could not build the launch: ' + (t || r.status).toString().slice(0, 140)); }
    const tx = Buffer.from(await r.arrayBuffer()).toString('base64');
    await q`update mk_city set uri = ${ij.metadataUri} where item = ${it.id} and mint = ${mint}`;
    return { tx, uri: ij.metadataUri, item: it.id };
  } catch (e) {
    try { await q`delete from mk_city where item = ${it.id} and mint = ${mint} and status = 'pending'`; } catch { }
    flushCity(); fail(String(e.message || e));
  }
}
// the founder sent the launch: check it on-chain (confirmed, successful, signed by the founder and the new mint) and open the doors
async function confirmClaim(b) {
  const it = CITY_BY_ID[String(b.item || '')]; if (!it) fail('unknown item');
  const sig = String(b.sig || ''); if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) fail('bad signature');
  const q = await ensure(); if (!q) fail('the city registry is not connected yet');
  const [row] = await q`select item, status, founder, mint from mk_city where item = ${it.id}`;
  if (!row) fail('no claim for that item');
  if (row.status === 'live') return { ok: true, item: it.id, mint: row.mint, founder: row.founder };
  let tx = null;
  for (let k = 0; k < 8 && !tx; k++) { tx = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => null); if (!tx) await sleep(1500); }
  if (!tx) fail('that transaction is not confirmed yet, try again in a moment');
  if (tx.meta && tx.meta.err) fail('the launch failed on-chain, nothing was created');
  const msg = tx.transaction && tx.transaction.message, keys = (msg && msg.accountKeys) || [], n = (msg && msg.header && msg.header.numRequiredSignatures) || 0;
  const signers = keys.slice(0, n).map(k => typeof k === 'string' ? k : k.pubkey);
  if (!signers.includes(row.founder) || !signers.includes(row.mint)) fail('that transaction is not this launch');
  await q`update mk_city set status = 'live', sig = ${sig}, t = now() where item = ${it.id} and mint = ${row.mint}`;
  flushCity();
  return { ok: true, item: it.id, mint: row.mint, founder: row.founder };
}

async function prices() {
  return memo('prices', 15000, async () => {
    const [info, live] = await Promise.all([jupTokens([SOL, USDC, '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', ...STOCKS.map(s => s.mint)]), cityLive().catch(() => [])]);
    if (!Object.keys(info).length) throw new Error('price feed offline');
    const stocks = STOCKS.map(s => {
      const t = info[s.mint] || {}, liq = t.liquidity != null ? t.liquidity : null, thin = !(liq >= THIN), st = t.stats24h || {};
      return { sym: s.sym, name: s.name, tok: s.tok, mint: s.mint, kind: s.kind, icon: t.icon || LOGO(s), decimals: t.decimals != null ? t.decimals : 8,
        usd: thin ? null : (t.usdPrice != null ? t.usdPrice : null), ch24: thin ? null : (st.priceChange != null ? st.priceChange : null),
        rawUsd: t.usdPrice != null ? t.usdPrice : null, mcap: t.mcap != null ? t.mcap : (t.fdv != null ? t.fdv : null), liq, holders: t.holderCount != null ? t.holderCount : null,
        vol24: (st.buyVolume != null || st.sellVolume != null) ? (st.buyVolume || 0) + (st.sellVolume || 0) : null, thin };
    });
    const sol = info[SOL] || {}, usdc = info[USDC] || {};
    const city = live.map(i => ({ sym: i.sym, name: i.name, id: i.id, cat: i.cat, art: i.icon, mint: i.mint, kind: 'city', icon: i.logo, decimals: 6, usd: i.usd, rawUsd: i.usd, ch24: i.ch24, mcap: i.mcap, liq: i.liq, holders: i.holders, vol24: i.vol24, founder: i.founder, thin: false }));
    return { t: Date.now(), sol: { usd: sol.usdPrice != null ? sol.usdPrice : null, ch24: sol.stats24h ? sol.stats24h.priceChange : null, icon: sol.icon || SOL_ICON }, usdc: { usd: usdc.usdPrice != null ? usdc.usdPrice : 1, icon: usdc.icon || USDC_ICON }, perpIcons: { SOL: sol.icon || SOL_ICON, BTC: (info['3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'] || {}).icon || null, ETH: (info['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'] || {}).icon || null }, stocks, city };
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

// only cash <-> a listed stock or a live city coin, or SOL <-> USDC
async function mintOf(x) {
  x = String(x || '');
  if (x === 'SOL') return SOL; if (x === 'USDC') return USDC;
  if (BY_SYM[x]) return BY_SYM[x].mint;
  if (BY_MINT[x] || x === SOL || x === USDC) return x;
  const c = (await cityLive()).find(i => i.sym === x || i.mint === x);
  if (c) return c.mint;
  fail('that market is not listed here');
}
const CASH = new Set([SOL, USDC]);

async function quote(q) {
  const [inM, outM] = await Promise.all([mintOf(q.get('in')), mintOf(q.get('out'))]);
  if (inM === outM) fail('pick two different assets');
  if (!(CASH.has(inM) || CASH.has(outM))) fail('trade against SOL or USDC');
  const amt = String(q.get('amt') || '');
  if (!/^\d{1,20}$/.test(amt) || BigInt(amt) <= 0n) fail('enter an amount above zero');
  const slip = Math.min(500, Math.max(10, parseInt(q.get('slip') || '100', 10) || 100));
  let j;
  try { j = await getJ(`${JUP}/swap/v1/quote?inputMint=${inM}&outputMint=${outM}&amount=${amt}&slippageBps=${slip}&restrictIntermediateTokens=true`); }
  catch (e) { const m = String(e.message || ''); if (/NO_ROUTE|COULD_NOT_FIND|No routes/i.test(m)) fail('no route for that trade right now, try a smaller amount'); if (/too small|AMOUNT/i.test(m)) fail('that amount is too small to route'); throw e; }
  if (!j || !j.outAmount) fail('no route for that trade right now');
  const meta = async m => { try { return await mintMeta(m); } catch { const s = BY_MINT[m]; return { decimals: s ? 8 : 6, mult: 1 }; } };
  const [mi, mo] = await Promise.all([meta(inM), meta(outM)]);
  const P = await prices().catch(() => null);
  const usdOf = (m, ui) => { if (!P) return null; if (m === SOL) return P.sol.usd != null ? P.sol.usd * ui : null; if (m === USDC) return ui; const s = P.stocks.find(x => x.mint === m) || (P.city || []).find(x => x.mint === m); return s && s.rawUsd != null ? s.rawUsd * ui : null; };
  const inUi = toUi(j.inAmount, mi), outUi = toUi(j.outAmount, mo), minUi = toUi(j.otherAmountThreshold, mo);
  return { quote: j, inUi, outUi, minUi, inUsd: usdOf(inM, inUi), outUsd: usdOf(outM, outUi), impact: +j.priceImpactPct || 0,
    route: (j.routePlan || []).map(r => r.swapInfo && r.swapInfo.label).filter(Boolean), slip };
}

async function swap(b) {
  const user = String(b.user || '');
  if (!B58.test(user)) fail('connect a wallet first');
  const q = b.quote;
  if (!q || !q.inputMint || !q.outputMint || !q.outAmount) fail('get a fresh quote first');
  await mintOf(q.inputMint); await mintOf(q.outputMint);
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
  const CM = Object.fromEntries(((P && P.city) || []).map(c => [c.mint, c]));
  const others = Object.keys(held).filter(m => !BY_MINT[m] && m !== USDC).slice(0, 80);
  const info = others.length ? await jupTokens(others) : {};
  const solUsd = P && P.sol.usd;
  const tokens = Object.entries(held).map(([m, h]) => {
    const cc = CM[m], st = BY_MINT[m], live = P && st ? P.stocks.find(x => x.mint === m) : (cc || null), t = info[m] || {};
    const price = m === USDC ? (P ? P.usdc.usd : 1) : live ? live.rawUsd : (t.usdPrice != null ? t.usdPrice : null);
    return { mint: m, sym: m === USDC ? 'USDC' : st ? st.sym : cc ? cc.sym : (t.symbol || m.slice(0, 4)), name: m === USDC ? 'USD Coin' : st ? st.name : cc ? cc.name : (t.name || ''),
      icon: m === USDC ? ((P && P.usdc.icon) || USDC_ICON) : st ? ((live && live.icon) || LOGO(st)) : (t.icon || (cc && cc.icon) || null),
      amount: h.ui, raw: h.raw.toString(), decimals: h.decimals, price, value: price != null ? price * h.ui : null,
      ch24: live ? live.ch24 : (t.stats24h ? t.stats24h.priceChange : null), kind: m === USDC ? 'cash' : st ? st.kind : cc ? 'city' : 'token', city: cc ? cc.id : null, thin: live ? !!live.thin : false, verified: !!t.isVerified };
  }).sort((x, y) => (y.value || 0) - (x.value || 0));
  const sol = bal / 1e9, solValue = solUsd != null ? sol * solUsd : null;
  const total = (solValue || 0) + tokens.reduce((a, t) => a + (t.value || 0), 0);
  return { wallet: addr, sol, lamports: bal, solUsd, solValue, solCh24: P && P.sol.ch24, solIcon: (P && P.sol.icon) || SOL_ICON, tokens, total, t: Date.now() };
}

// ---------------------------------------------------------------- charts: the real share on its exchange, else the token's own pool
const RANGES = { '1D': ['1d', '5m', 60e3], '1W': ['5d', '30m', 300e3], '1M': ['1mo', '60m', 900e3], '6M': ['6mo', '1d', 3600e3], '1Y': ['1y', '1d', 3600e3] };
async function chart(sym, r) {
  if (/^(SOL|BTC|ETH)-PERP$/.test(sym)) { const m = PERP_MKTS[sym.split('-')[0]]; return yahooChart(sym, m.y, r, `${m.y} · spot`); }
  const s = BY_SYM[sym];
  if (!s) { const c = (await cityLive()).find(i => i.sym === sym); if (!c) fail('unknown market'); return poolChart({ sym, mint: c.mint, tok: c.sym }, r); }
  return yahooChart(sym, s.tok.replace(/x$/, '').replace('.', '-'), r, null, s);
}
async function yahooChart(sym, ysym, r, label, s) {
  const R = RANGES[r] || RANGES['1D'];
  return memo(`chart:${sym}:${r}`, R[2], async () => {
    try {
      const j = await getJ(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?range=${R[0]}&interval=${R[1]}&includePrePost=false`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', accept: 'application/json' } });
      const res = j && j.chart && j.chart.result && j.chart.result[0]; if (!res) throw new Error('no chart');
      const ts = res.timestamp || [], qq = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
      const O = qq.open || [], Hh = qq.high || [], Lw = qq.low || [], C = qq.close || [], V = qq.volume || [];
      const pts = []; for (let k = 0; k < ts.length; k++) if (C[k] != null) pts.push([ts[k] * 1000, r4(O[k] != null ? O[k] : C[k]), r4(Hh[k] != null ? Hh[k] : C[k]), r4(Lw[k] != null ? Lw[k] : C[k]), r4(C[k]), Math.round(V[k] || 0)]);
      if (pts.length < 2) throw new Error('no chart');
      const m = res.meta || {};
      return { sym, src: s ? 'share' : 'spot', label: label || `${ysym} · ${m.fullExchangeName || m.exchangeName || 'US market'}`, exch: m.fullExchangeName || m.exchangeName || null, pts, prev: m.chartPreviousClose != null ? m.chartPreviousClose : (m.previousClose != null ? m.previousClose : pts[0][4]), last: m.regularMarketPrice != null ? m.regularMarketPrice : pts[pts.length - 1][4], state: m.currentTradingPeriod ? marketState(m.currentTradingPeriod) : null };
    } catch (e) { if (!s) fail('no chart right now'); return poolChart(s, r); }
  });
}
// candles from the token's own deepest on-chain pool
async function poolChart(s, r) {
  return memo(`pchart:${s.mint}:${r}`, 60e3, async () => {
    const p = await poolOf(s);
    const tf = { '1D': ['minute', 15, 96], '1W': ['hour', 1, 168], '1M': ['hour', 4, 180], '6M': ['day', 1, 180], '1Y': ['day', 1, 365] }[r] || ['minute', 15, 96];
    const o = await getJ(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${p.address}/ohlcv/${tf[0]}?aggregate=${tf[1]}&limit=${tf[2]}&currency=usd&token=${s.mint}`);
    const L = ((o && o.data && o.data.attributes && o.data.attributes.ohlcv_list) || []).map(c => [c[0] * 1000, r8(c[1]), r8(c[2]), r8(c[3]), r8(c[4]), Math.round(c[5] || 0)]).reverse();
    if (L.length < 2) fail('no chart for this market yet');
    return { sym: s.sym, src: 'pool', label: `${s.tok} · on-chain pool`, exch: null, pts: L, prev: L[0][4], last: L[L.length - 1][4], state: null };
  });
}
const r8 = x => x == null ? null : +(+x).toPrecision(8);
const r4 = x => x == null ? null : Math.round(x * 10000) / 10000;
function marketState(p) { const now = Date.now() / 1000, reg = p.regular; if (reg && now >= reg.start && now < reg.end) return 'open'; if (p.pre && now >= p.pre.start && now < p.pre.end) return 'pre'; if (p.post && now >= p.post.start && now < p.post.end) return 'after'; return 'closed'; }

// the deepest on-chain pool for a stock, and its latest real trades (time & sales)
async function poolOf(s) {
  return memo('pool:' + s.mint, 3600e3, async () => {
    const j = await getJ(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${s.mint}/pools?page=1`);
    const d = ((j && j.data) || []).slice().sort((a, b) => (+b.attributes.reserve_in_usd || 0) - (+a.attributes.reserve_in_usd || 0));
    if (!d[0]) fail('no pool for this stock yet');
    const a = d[0].attributes, dex = d[0].relationships && d[0].relationships.dex && d[0].relationships.dex.data && d[0].relationships.dex.data.id;
    return { address: a.address, name: a.name, dex: dex || null, reserve: +a.reserve_in_usd || null };
  });
}
async function trades(sym) {
  let s = BY_SYM[sym];
  if (!s) { const c = (await cityLive()).find(i => i.sym === sym); if (!c) fail('unknown market'); s = { sym, mint: c.mint, tok: c.sym }; }
  return memo('trades:' + sym, 15000, async () => {
    const p = await poolOf(s);
    const j = await getJ(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${p.address}/trades`);
    const L = ((j && j.data) || []).slice(0, 50).map(t => {
      const a = t.attributes, buy = a.to_token_address === s.mint;
      return { t: Date.parse(a.block_timestamp), side: buy ? 'buy' : 'sell', amt: +(buy ? a.to_token_amount : a.from_token_amount) || 0, usd: +a.volume_in_usd || 0, px: +(buy ? a.price_to_in_usd : a.price_from_in_usd) || null, tx: a.tx_hash, who: a.tx_from_address || null };
    }).filter(x => x.amt > 0);
    return { sym, pool: p, trades: L, t: Date.now() };
  });
}


// ---------------------------------------------------------------- perps: Jupiter Perps (SOL, BTC, ETH). Their API builds the
// transaction, the user's wallet signs it, and their execute endpoint lands it with the keeper. Prices in micro-USD unless noted.
const PERPS = 'https://perps-api.jup.ag/v2';
const PERP_MKTS = { SOL: { mint: SOL, y: 'SOL-USD', name: 'Solana' }, BTC: { mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', y: 'BTC-USD', name: 'Bitcoin' }, ETH: { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', y: 'ETH-USD', name: 'Ethereum' } };
const PERP_IN = { SOL: 9, USDC: 6, BTC: 8, ETH: 8 };
const PH = { 'content-type': 'application/json', accept: 'application/json', 'x-client-platform': 'markets' };
const micro = x => x == null || x === '' ? null : Number(x) / 1e6;
const toChain = (ui, dec) => { const str = String(ui); if (!/^\d*\.?\d+$/.test(str)) fail('enter an amount above zero'); const [i, f = ''] = str.split('.'); const r = BigInt((i || '0') + (f + '0'.repeat(dec)).slice(0, dec)); if (r <= 0n) fail('enter an amount above zero'); return r.toString(); };
async function perpCall(path, init) {
  try { return await getJ(`${PERPS}/${path}`, Object.assign({ headers: PH }, init || {}), 20000); }
  catch (e) { const b = e.body || {}; fail(String(b.message || b.error || b.detail || e.message || 'the perps desk did not answer').slice(0, 200)); }
}
async function perpMarkets() {
  return memo('perps:mkts', 10000, async () => {
    const L = await Promise.all(Object.entries(PERP_MKTS).map(async ([asset, m]) => {
      try { const r = await getJ(`${PERPS}/market-stats?mint=${m.mint}`, { headers: PH }); return { asset, name: m.name, mint: m.mint, price: +r.price || null, ch24: r.priceChange24H != null ? +r.priceChange24H : null, hi: +r.priceHigh24H || null, lo: +r.priceLow24H || null, vol: +r.volume || null }; }
      catch { return { asset, name: m.name, mint: m.mint, price: null, ch24: null, hi: null, lo: null, vol: null }; }
    }));
    if (!L.some(x => x.price)) throw new Error('the perps desk is not answering');
    return { markets: L, t: Date.now() };
  });
}
async function perpPositions(addr) {
  addr = String(addr || ''); if (!B58.test(addr)) fail('bad wallet address');
  const j = await perpCall(`positions?walletAddress=${addr}`);
  const pos = ((j && j.dataList) || []).map(p => ({ key: p.positionPubkey, asset: p.asset, side: p.side, lev: +p.leverage || null, size: micro(p.sizeUsd), coll: micro(p.collateralUsd), value: micro(p.valueUsd),
    entry: micro(p.entryPriceUsd), mark: micro(p.markPriceUsd), liq: micro(p.liquidationPriceUsd), pnl: micro(p.pnlAfterFeesUsd), pnlPct: p.pnlAfterFeesPct != null ? +p.pnlAfterFeesPct : null,
    fees: micro(p.totalFeesUsd), collToken: p.collateralToken || null, opened: p.createdTime || null,
    tpsl: (p.tpslRequests || []).map(t => ({ key: t.positionRequestPubkey, type: t.requestType, price: micro(t.triggerPriceUsd) })) }));
  return { positions: pos, t: Date.now() };
}
async function perpOpen(b) {
  const asset = String(b.asset || '').toUpperCase(); if (!PERP_MKTS[asset]) fail('pick SOL, BTC or ETH');
  const side = b.side === 'short' ? 'short' : b.side === 'long' ? 'long' : fail('pick long or short');
  const input = String(b.input || 'USDC').toUpperCase(); if (!PERP_IN[input]) fail('pay with SOL or USDC');
  const user = String(b.user || ''); if (!B58.test(user)) fail('connect a wallet first');
  const lev = +b.leverage; if (!(lev >= 1.1 && lev <= 100)) fail('leverage goes from 1.1x to 100x');
  const slip = Math.min(500, Math.max(30, parseInt(b.slip || '200', 10) || 200));
  const req = { asset, inputToken: input, inputTokenAmount: toChain(b.amount, PERP_IN[input]), side, maxSlippageBps: String(slip), leverage: String(Math.round(lev * 100) / 100), walletAddress: user };
  const tpsl = [];
  if (+b.tp > 0) tpsl.push({ receiveToken: input, triggerPrice: toChain(b.tp, 6), requestType: 'tp' });
  if (+b.sl > 0) tpsl.push({ receiveToken: input, triggerPrice: toChain(b.sl, 6), requestType: 'sl' });
  if (tpsl.length) req.tpsl = tpsl;
  const j = await perpCall('positions/increase', { method: 'POST', body: JSON.stringify(req) });
  if (!j || !j.serializedTxBase64) fail('the perps desk did not build the order');
  const q = j.quote || {};
  return { position: j.positionPubkey, tx: j.serializedTxBase64, quote: { entry: micro(q.averagePriceUsd), size: micro(q.positionSizeUsd != null ? q.positionSizeUsd : q.sizeUsdDelta), sizeDelta: micro(q.sizeUsdDelta), coll: micro(q.positionCollateralUsd != null ? q.positionCollateralUsd : q.collateralUsdDelta), lev: +q.leverage || null, liq: micro(q.liquidationPriceUsd), fee: micro(q.openFeeUsd), impactFee: micro(q.priceImpactFeeUsd), borrow: micro(q.outstandingBorrowFeeUsd) }, tpsl: (j.tpsl || []).map(t => ({ type: t.requestType, pnl: micro(t.pnlUsd) })) };
}
async function perpClose(b) {
  const key = String(b.position || ''); if (!B58.test(key)) fail('bad position');
  const receive = String(b.receive || 'USDC').toUpperCase(); if (!PERP_IN[receive]) fail('receive USDC or the market token');
  const slip = Math.min(500, Math.max(30, parseInt(b.slip || '200', 10) || 200));
  const req = { positionPubkey: key, receiveToken: receive, maxSlippageBps: String(slip) };
  if (+b.size > 0) req.sizeUsdDelta = toChain(b.size, 6); else req.entirePosition = true;
  const j = await perpCall('positions/decrease', { method: 'POST', body: JSON.stringify(req) });
  if (!j || !j.serializedTxBase64) fail('the perps desk did not build the close');
  const q = j.quote || {};
  return { tx: j.serializedTxBase64, quote: { pnl: micro(q.pnlAfterFeesUsd), pnlPct: q.pnlAfterFeesPercent != null ? +q.pnlAfterFeesPercent : null, fee: micro(q.totalFeeUsd != null ? q.totalFeeUsd : q.closeFeeUsd), receiveUsd: micro(q.transferAmountUsd), size: micro(q.sizeUsdDelta) } };
}
const PERP_ACTIONS = new Set(['increase-position', 'decrease-position', 'create-tpsl', 'update-tpsl', 'cancel-tpsl']);
async function perpExec(b) {
  const action = String(b.action || ''); if (!PERP_ACTIONS.has(action)) fail('unknown action');
  const tx = String(b.tx || ''); if (!/^[A-Za-z0-9+/=]{100,4000}$/.test(tx)) fail('nothing to send');
  const j = await perpCall('transaction/execute', { method: 'POST', body: JSON.stringify({ action, serializedTxBase64: tx }) });
  if (!j || !j.txid) fail('the order was not executed');
  return { sig: j.txid };
}

// one-day sparklines for a handful of stocks at once (homepage cards)
async function sparks(list) {
  const syms = String(list || '').split(',').filter(x => BY_SYM[x]).slice(0, 16);
  const o = {};
  await Promise.all(syms.map(async s => { try { const c = await chart(s, '1D'); o[s] = c.pts.filter((_, k, a) => k % Math.max(1, Math.floor(a.length / 48)) === 0).map(p => p[4]); } catch { } }));
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
    if (a === 'trades') return out(res, 200, await trades(q.get('sym')), 'public, s-maxage=10, stale-while-revalidate=30');
    if (a === 'list') return out(res, 200, { stocks: STOCKS }, 'public, s-maxage=3600');
    if (a === 'perps') return out(res, 200, await perpMarkets(), 'public, s-maxage=8, stale-while-revalidate=20');
    if (a === 'ppos') return out(res, 200, await perpPositions(q.get('addr')));
    if (a === 'popen' && req.method === 'POST') return out(res, 200, await perpOpen(await body(req)));
    if (a === 'pclose' && req.method === 'POST') return out(res, 200, await perpClose(await body(req)));
    if (a === 'pexec' && req.method === 'POST') return out(res, 200, await perpExec(await body(req)));
    if (a === 'city') return out(res, 200, await cityList(), 'public, s-maxage=8, stale-while-revalidate=30');
    if (a === 'claim' && req.method === 'POST') return out(res, 200, await claim(await body(req)));
    if (a === 'confirm' && req.method === 'POST') return out(res, 200, await confirmClaim(await body(req)));
    return out(res, 404, { error: 'unknown action' });
  } catch (e) {
    return out(res, e.user ? 400 : 502, { error: String((e && e.message) || e).slice(0, 220) });
  }
};
