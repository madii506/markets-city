# Bukz

The city runs on bukz. Trade real stocks, perps and fresh pump.fun coins, and own the city one coin at a time, from your own wallet on Solana.

- `index.html` the home: a purple 3D bay city with falling coins (`assets/js/city3d.js`, three.js vendored in `assets/vendor/three`)
- `app.html` the terminal: overview, trade, stocks, city, perps, trenches, portfolio, docs (`assets/js/term.js`)
- `api/m.js` one function for everything live: prices, quotes and swaps (Jupiter), stock charts, perps (Jupiter Perps), the pump.fun trenches feed, balances, tx status, the city registry and its photos
- `assets/js/config.js` launch settings ($BUKZ CA, X link)
- `404.html` the street that isn't on the map

Environment: `DATABASE_URL` (Neon Postgres) holds the city registry and the city photos. The photos are made once by FLUX through Vercel's AI Gateway. Everything else runs without keys.

Non-custodial: every transaction is signed in the user's wallet. No keys on the server.
