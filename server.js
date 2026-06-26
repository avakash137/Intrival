const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Load .env manually (no dotenv package needed) ──────────────────────────
function loadEnv() {
  try {
    const lines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n');
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (key) process.env[key] = val;
    });
  } catch (e) {
    // .env not found — env vars may be set externally (production)
  }
}
loadEnv();

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWELVE_DATA_KEY   = process.env.TWELVE_DATA_KEY;

if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'PASTE_YOUR_KEY_HERE' || ANTHROPIC_API_KEY === 'sk-ant-your-key-here') {
  console.error('\n❌  Missing API key. Open .env and set ANTHROPIC_API_KEY=sk-ant-...\n');
  process.exit(1);
}

// ── MIME types for static file serving ────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ── POST /api/claude → proxy to Anthropic ─────────────────────────────
  if (req.method === 'POST' && req.url === '/api/claude') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }

      const payload = JSON.stringify({
        model: parsed.model || 'claude-sonnet-4-6',
        max_tokens: parsed.max_tokens || 1000,
        messages: parsed.messages,
        ...(parsed.system ? { system: parsed.system } : {}),
      });

      const opts = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const apiReq = https.request(opts, apiRes => {
        let data = '';
        apiRes.on('data', chunk => (data += chunk));
        apiRes.on('end', () => {
          res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });
      apiReq.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      apiReq.write(payload);
      apiReq.end();
    });
    return;
  }

  // ── GET /api/quote/:symbol → Twelve Data proxy ───────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/quote/')) {
    const rawSym = decodeURIComponent(req.url.replace('/api/quote/', '').split('?')[0]).toUpperCase();

    if (!TWELVE_DATA_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'TWELVE_DATA_KEY not configured' }));
    }

    // Twelve Data uses SYMBOL:EXCHANGE notation for NSE stocks (e.g. RELIANCE:NSE)
    // If user typed a Yahoo-style symbol like RELIANCE.NS, normalise it
    const tdSymbol = rawSym.replace(/\.NS$/i, ':NSE').replace(/\.BO$/i, ':BSE');

    function tdFetch(sym) {
      return new Promise((resolve) => {
        const opts = {
          hostname: 'api.twelvedata.com',
          path: `/quote?symbol=${encodeURIComponent(sym)}&apikey=${TWELVE_DATA_KEY}`,
          method: 'GET',
          headers: { 'User-Agent': 'Intrival/1.0', 'Accept': 'application/json' },
        };
        const req2 = https.request(opts, r => {
          let d = '';
          r.on('data', c => (d += c));
          r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
        });
        req2.on('error', () => resolve(null));
        req2.end();
      });
    }

    function fmtMcap(val, cur) {
      if (!val) return null;
      const n = parseFloat(val);
      if (isNaN(n)) return null;
      if (cur === 'INR') {
        if (n >= 1e12) return `₹${(n / 1e12).toFixed(2)}L Cr`;
        if (n >= 1e9)  return `₹${(n / 1e9).toFixed(2)}K Cr`;
        return `₹${(n / 1e7).toFixed(2)} Cr`;
      }
      if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
      return `$${(n / 1e6).toFixed(2)}M`;
    }

    function fmtVol(val) {
      if (!val) return null;
      const n = parseFloat(val);
      if (isNaN(n)) return null;
      if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
      return String(n);
    }

    (async () => {
      let data = await tdFetch(tdSymbol);

      // If not found and no exchange suffix, also try without suffix (pure US symbol)
      if (data?.status === 'error' && tdSymbol.includes(':')) {
        const baseSym = tdSymbol.split(':')[0];
        data = await tdFetch(baseSym);
      }

      if (!data || data.status === 'error' || !data.close) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Symbol not found: ${rawSym}`, detail: data?.message || '' }));
      }

      const cur      = data.currency || 'USD';
      const exchange = data.exchange  || '';
      const indianEx = ['NSE', 'BSE', 'NSI', 'BOM'];
      const market   = indianEx.some(e => exchange.toUpperCase().includes(e)) || cur === 'INR' ? 'IN' : 'US';

      const price     = parseFloat(data.close)          || 0;
      const change    = parseFloat(data.change)         || 0;
      const chgPct    = parseFloat(data.percent_change) || 0;
      const high52    = parseFloat(data.fifty_two_week?.high)  || null;
      const low52     = parseFloat(data.fifty_two_week?.low)   || null;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        symbol:        rawSym,
        resolvedSymbol: data.symbol || rawSym,
        name:          data.name   || rawSym,
        currency:      cur,
        market,
        exchange,
        price:         Math.round(price   * 100) / 100,
        change:        Math.round(change  * 100) / 100,
        changePercent: Math.round(chgPct  * 100) / 100,
        marketCap:     null,       // not in Twelve Data free quote endpoint
        peRatio:       null,       // not in Twelve Data free quote endpoint
        weekHigh52:    high52,
        weekLow52:     low52,
        volume:        fmtVol(data.volume),
        description:   null,
      }));
    })();
    return;
  }

  // ── GET /api/search?q=query → Yahoo Finance symbol search ─────────────
  if (req.method === 'GET' && req.url.startsWith('/api/search')) {
    const qs = new URLSearchParams(req.url.split('?')[1] || '');
    const q  = qs.get('q') || '';
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'q param required' }));
    }
    const sOpts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    };
    const sReq = https.request(sOpts, sRes => {
      let d = '';
      sRes.on('data', c => (d += c));
      sRes.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const hits = (parsed.quotes || [])
            .filter(q => q.quoteType === 'EQUITY' && !q.symbol.endsWith('.NS') && !q.symbol.endsWith('.BO'))
            .slice(0, 6)
            .map(q => ({ symbol: q.symbol, name: q.longname || q.shortname || q.symbol, exchange: q.exchange }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(hits));
        } catch {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error' }));
        }
      });
    });
    sReq.on('error', err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    sReq.end();
    return;
  }

  // ── Serve static files from ./public ──────────────────────────────────
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback → always serve index.html
      fs.readFile(path.join(__dirname, 'public', 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n✅  Intrival is running!`);
  console.log(`   Open → http://localhost:${PORT}\n`);
  console.log(`   Press Ctrl+C to stop.\n`);
});
