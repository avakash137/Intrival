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

  // ── GET /api/quote/:symbol → Yahoo Finance proxy ──────────────────────
  if (req.method === 'GET' && req.url.startsWith('/api/quote/')) {
    const rawSym = decodeURIComponent(req.url.replace('/api/quote/', '').split('?')[0]).toUpperCase();

    function yhFetch(symbol) {
      return new Promise((resolve) => {
        const yOpts = {
          hostname: 'query1.finance.yahoo.com',
          path: `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price%2CsummaryDetail`,
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        };
        const yReq = https.request(yOpts, yRes => {
          let d = '';
          yRes.on('data', c => (d += c));
          yRes.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
        });
        yReq.on('error', () => resolve(null));
        yReq.end();
      });
    }

    function fmtMcap(val, cur) {
      if (!val) return null;
      if (cur === 'INR') {
        if (val >= 1e12) return `₹${(val / 1e12).toFixed(2)}L Cr`;
        if (val >= 1e9)  return `₹${(val / 1e9).toFixed(2)}K Cr`;
        return `₹${(val / 1e7).toFixed(2)} Cr`;
      }
      if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
      if (val >= 1e9)  return `$${(val / 1e9).toFixed(2)}B`;
      return `$${(val / 1e6).toFixed(2)}M`;
    }

    function fmtVol(val) {
      if (!val) return null;
      if (val >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
      if (val >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
      if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
      return String(val);
    }

    (async () => {
      // Try symbol as-is; if no result try appending .NS (Indian market)
      let result = await yhFetch(rawSym);
      let usedSym = rawSym;
      if (!result?.quoteSummary?.result?.[0] && !rawSym.includes('.')) {
        result = await yhFetch(rawSym + '.NS');
        if (result?.quoteSummary?.result?.[0]) usedSym = rawSym + '.NS';
      }

      const summary = result?.quoteSummary?.result?.[0];
      if (!summary) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Symbol not found: ${rawSym}` }));
      }

      const p  = summary.price         || {};
      const sd = summary.summaryDetail || {};
      const cur = p.currency || 'USD';
      const indianExchanges = ['NSI', 'BSE', 'NSE', 'BOM'];
      const market = indianExchanges.includes(p.exchange) || cur === 'INR' ? 'IN' : 'US';
      const chgPct = (p.regularMarketChangePercent?.raw || 0) * 100;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        symbol:        rawSym,
        resolvedSymbol: usedSym,
        name:          p.longName || p.shortName || rawSym,
        currency:      cur,
        market,
        exchange:      p.exchange || '',
        price:         p.regularMarketPrice?.raw        ?? 0,
        change:        p.regularMarketChange?.raw       ?? 0,
        changePercent: Math.round(chgPct * 100) / 100,
        marketCap:     fmtMcap(p.marketCap?.raw, cur),
        peRatio:       sd.trailingPE?.raw ? Math.round(sd.trailingPE.raw * 10) / 10 : null,
        weekHigh52:    sd.fiftyTwoWeekHigh?.raw  || null,
        weekLow52:     sd.fiftyTwoWeekLow?.raw   || null,
        volume:        fmtVol(p.regularMarketVolume?.raw),
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
            .filter(q => q.quoteType === 'EQUITY')
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
