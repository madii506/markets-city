/* markets: wallet. Phantom, Solflare, Backpack. Keys never leave the wallet; we only ask it to sign. */
(function () {
  const WALLETS = [
    { name: 'Phantom', get: () => window.phantom && window.phantom.solana && window.phantom.solana.isPhantom && window.phantom.solana, color: '#ab9ff2', dl: 'https://phantom.com/download', ul: u => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
    { name: 'Solflare', get: () => window.solflare && window.solflare.isSolflare && window.solflare, color: '#fc7227', dl: 'https://solflare.com/download', ul: u => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
    { name: 'Backpack', get: () => window.backpack && window.backpack.isBackpack !== false && window.backpack, color: '#e33e3f', dl: 'https://backpack.app/download', ul: null },
  ];
  const KEY = 'markets.wallet';
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { } } };
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const subs = new Set();
  const W = { addr: null, name: null, p: null };
  const emit = () => subs.forEach(f => { try { f(W); } catch (e) { console.error(e); } });

  function bind(p, name) {
    if (!p || p.__mk) return; p.__mk = 1;
    const onAcc = pk => { if (W.p !== p) return; if (pk) { W.addr = pk.toString(); emit(); } else disconnect(true); };
    try { p.on && p.on('accountChanged', onAcc); } catch { }
    try { p.on && p.on('disconnect', () => { if (W.p === p) disconnect(true); }); } catch { }
  }
  async function connect(name, silent) {
    const w = WALLETS.find(x => x.name === name); if (!w) throw new Error('unknown wallet');
    const p = w.get();
    if (!p) {
      if (silent) return null;
      if (mobile && w.ul) { location.href = w.ul(location.href); return null; }
      window.open(w.dl, '_blank', 'noopener'); return null;
    }
    const r = silent ? await p.connect({ onlyIfTrusted: true }) : await p.connect();
    const pk = (r && r.publicKey) || p.publicKey;
    if (!pk) throw new Error('the wallet did not share an address');
    bind(p, name);
    W.addr = pk.toString(); W.name = name; W.p = p;
    store.set(KEY, name); emit();
    return W.addr;
  }
  async function disconnect(quiet) {
    const p = W.p; W.addr = null; W.name = null; W.p = null; store.set(KEY, null); emit();
    if (p && !quiet) { try { await p.disconnect(); } catch { } }
  }
  async function restore() {
    const last = store.get(KEY); if (!last) return;
    // wallets inject a moment after load
    for (let k = 0; k < 6; k++) { const w = WALLETS.find(x => x.name === last); if (w && w.get()) break; await new Promise(r => setTimeout(r, 250)); }
    try { await connect(last, true); } catch { }
  }

  // web3.js is only needed to hand a transaction to the wallet, so it loads on the first trade
  let web3P = null;
  function web3() { if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3); if (web3P) return web3P; web3P = new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/assets/js/web3.min.js'; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3P = null; no(new Error('could not load the signer, check your connection')); }; document.head.appendChild(s); }); return web3P; }
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };

  const B58A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(u8) { const d = []; let s = ''; for (const byte of u8) { let c = byte; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } } for (const byte of u8) { if (byte) break; s += '1'; } for (let j = d.length - 1; j >= 0; j--) s += B58A[d[j]]; return s; }

  // returns the signature; the wallet sends it when it can, otherwise it signs and we relay through our RPC
  async function signAndSend(txB64, relay) {
    if (!W.p) throw new Error('connect a wallet first');
    const S = await web3();
    const tx = S.VersionedTransaction.deserialize(b64(txB64));
    const p = W.p;
    try {
      if (p.signAndSendTransaction) {
        const r = await p.signAndSendTransaction(tx, { skipPreflight: false, maxRetries: 3 });
        const sig = r && (r.signature != null ? r.signature : r);
        if (!sig) throw new Error('the wallet did not return a signature');
        return typeof sig === 'string' ? sig : b58(sig);
      }
      const signed = await p.signTransaction(tx);
      return relay(toB64(signed.serialize()));
    } catch (e) {
      if (isReject(e)) throw new Error('you cancelled in your wallet');
      throw new Error(friendly(e));
    }
  }
  const friendly = e => { const m = String((e && (e.message || e.toString())) || 'the wallet could not send it'); if (/insufficient|0x1\b|lamports/i.test(m)) return 'not enough SOL for this trade and its fees'; if (/blockhash|expired/i.test(m)) return 'the quote expired, try again'; if (/slippage|0x1771|6001/i.test(m)) return 'the price moved past your slippage, try again'; return m.slice(0, 160); };
  const isReject = e => e && (e.code === 4001 || /reject|cancel|denied|declined/i.test(e.message || ''));

  window.MarketsWallet = { WALLETS, W, connect, disconnect, restore, signAndSend, isReject, on: f => { subs.add(f); return () => subs.delete(f); }, installed: () => WALLETS.filter(w => w.get()), mobile };
})();
