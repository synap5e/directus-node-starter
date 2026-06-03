'use strict';

// Tiny Node backend for the starter:
//   1. serves the static frontend out of ./public
//   2. proxies /cms/* to Directus (same-origin API + assets, no CORS)
//   3. exposes /healthz for container/orchestrator health checks
//   4. injects runtime config (/app-config.js) so the frontend knows where the
//      public Directus admin lives for "edit this item" deep-links
//
// This is intentionally minimal. It is the seam where you'd grow a real backend
// (auth, entitlements, signed media) for gated-content setups — see README.

const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = parseInt(process.env.PORT || '8080', 10);
// Internal address of Directus on the container network.
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'http://directus:8055';
// Public URL of Directus (for admin deep-links shown in the browser). Empty
// string => frontend falls back to the same-origin /cms proxy.
const DIRECTUS_PUBLIC_URL = process.env.DIRECTUS_PUBLIC_URL || '';

const app = express();
app.disable('x-powered-by');

// Liveness/readiness probe.
app.get('/healthz', (_req, res) => res.json({ ok: true, directus: DIRECTUS_URL }));

// Runtime config consumed by index.html.
app.get('/app-config.js', (_req, res) => {
  res.type('application/javascript').send(
    'window.APP_CONFIG=' +
      JSON.stringify({ cmsBase: '/cms', cmsAdminUrl: DIRECTUS_PUBLIC_URL }) +
      ';'
  );
});

// Proxy the CMS API + assets. /cms/items/Artworks -> {DIRECTUS_URL}/items/Artworks
app.use(
  '/cms',
  createProxyMiddleware({
    target: DIRECTUS_URL,
    changeOrigin: true,
    ws: true,
    pathRewrite: { '^/cms': '' },
    xfwd: true,
    logLevel: 'warn',
    onError(err, _req, res) {
      if (res && !res.headersSent) {
        res.status(502).json({ error: 'cms_unreachable', detail: err.message });
      }
    },
  })
);

// Static frontend (index.html + /static/*).
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// SPA-ish fallback: anything else serves index.html.
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`web listening on :${PORT} -> proxying /cms to ${DIRECTUS_URL}`);
});
