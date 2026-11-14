# markets

The city's stock market. Trade tokenized stocks on Solana from your own wallet.

- `index.html` the home: a 3D bay city at dusk (`assets/js/city3d.js`, three.js vendored in `assets/vendor/three`)
- `app.html` the terminal: overview, trade, stocks, city, perps, portfolio, docs (`assets/js/term.js`)
- `api/m.js` one function for everything live: prices, quotes and swaps (Jupiter), stock charts, perps (Jupiter Perps), balances, tx status and the city registry
- `assets/js/config.js` launch settings (CA, X link)
- `404.html` the street that isn't on the map

Environment: `DATABASE_URL` (Neon Postgres) holds the city registry, who founded which item and its coin. Everything else runs without keys.

Non-custodial: every transaction is signed in the user's wallet. No keys on the server.
