#!/usr/bin/env node
// Idempotent Directus seed for the articles demo. Creates the `Articles`
// collection, grants the Public policy read access (published only), and inserts
// a few sample articles. Safe to re-run.
//
// Usage:
//   DIRECTUS_URL=http://localhost:8097 \
//   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=... \
//   node scripts/seed-directus.mjs
//
// Requires Node 20+ (global fetch). No npm dependencies.

const DIRECTUS_URL = (process.env.DIRECTUS_URL || 'http://localhost:8097').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COLLECTION = process.env.CMS_COLLECTION || 'Articles';

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is required');
  process.exit(1);
}

let token = '';
async function api(method, path, body) {
  const res = await fetch(DIRECTUS_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

async function login() {
  const r = await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (!r.ok) throw new Error('login failed: ' + JSON.stringify(r.json));
  token = r.json.data.access_token;
  console.log('• logged in');
}

async function ensureCollection() {
  const existing = await api('GET', '/collections/' + COLLECTION);
  if (existing.ok) { console.log(`• collection ${COLLECTION} already exists`); return; }

  const payload = {
    collection: COLLECTION,
    meta: { icon: 'article', note: 'Demo articles', sort_field: 'sort', display_template: '{{title}}' },
    schema: {},
    fields: [
      { field: 'id', type: 'integer', meta: { hidden: true, interface: 'input', readonly: true },
        schema: { is_primary_key: true, has_auto_increment: true } },
      { field: 'status', type: 'string', meta: {
          interface: 'select-dropdown', width: 'half', display: 'labels', display_options: { showAsDot: true },
          options: { choices: [
            { text: 'Published', value: 'published' },
            { text: 'Draft', value: 'draft' },
            { text: 'Archived', value: 'archived' },
          ] } },
        schema: { default_value: 'published' } },
      { field: 'sort', type: 'integer', meta: { interface: 'input', hidden: true, width: 'half' }, schema: {} },
      { field: 'title', type: 'string', meta: { interface: 'input', required: true, width: 'full' },
        schema: { is_nullable: false } },
      { field: 'slug', type: 'string', meta: { interface: 'input', width: 'half', options: { slug: true } }, schema: {} },
      { field: 'author', type: 'string', meta: { interface: 'input', width: 'half' }, schema: {} },
      { field: 'published_date', type: 'timestamp', meta: { interface: 'datetime', width: 'half' }, schema: {} },
      { field: 'summary', type: 'text', meta: { interface: 'input-multiline', width: 'full' }, schema: {} },
      { field: 'body', type: 'text', meta: { interface: 'input-rich-text-html', width: 'full' }, schema: {} },
    ],
  };
  const r = await api('POST', '/collections', payload);
  if (!r.ok) throw new Error('create collection failed: ' + JSON.stringify(r.json));
  console.log(`• created collection ${COLLECTION}`);
}

async function findPublicPolicy() {
  // The built-in Public policy is identified by the name "$t:public_label".
  // (In Directus 11 the policy<->role link lives in directus_access, not on the
  // policy itself, so we match on name rather than a role field.)
  const r = await api('GET', '/policies?limit=-1&fields=id,name');
  if (!r.ok) throw new Error('list policies failed: ' + JSON.stringify(r.json));
  const policies = r.json.data || [];
  const pub = policies.find(p => p.name === '$t:public_label');
  if (!pub) throw new Error('could not find Public policy among: ' +
    policies.map(p => p.name).join(', '));
  return pub.id;
}

async function ensurePublicRead(policyId) {
  const existing = await api('GET',
    `/permissions?filter[policy][_eq]=${policyId}&filter[collection][_eq]=${COLLECTION}&filter[action][_eq]=read`);
  if (existing.ok && (existing.json.data || []).length > 0) {
    console.log('• public read permission already exists'); return;
  }
  const r = await api('POST', '/permissions', {
    policy: policyId,
    collection: COLLECTION,
    action: 'read',
    fields: ['*'],
    permissions: { _and: [{ status: { _eq: 'published' } }] },
  });
  if (!r.ok) throw new Error('create permission failed: ' + JSON.stringify(r.json));
  console.log('• granted Public read (published only)');
}

const SAMPLE_ARTICLES = [
  {
    title: 'Welcome to the Starter Times',
    author: 'Editorial Team', published_date: '2026-05-20T09:00:00Z',
    summary: 'A guided tour of this demo: a custom frontend, a Node backend, and Directus doing the heavy lifting.',
    body: '<p>This site is a working example of a small full-stack setup. The page you are reading is static HTML served by a <strong>Node/Express backend</strong>. The articles themselves live in <strong>Directus</strong>, a headless CMS.</p><h2>How it fits together</h2><p>The browser asks the Node backend for <code>/cms/items/Articles</code>. The backend proxies that to Directus on the internal network and returns the JSON. No CORS, one origin, one place to add backend logic later.</p><blockquote>Swap this content in the CMS admin and it shows up here instantly.</blockquote>',
  },
  {
    title: 'Why a Headless CMS?',
    author: 'A. Maintainer', published_date: '2026-05-18T14:30:00Z',
    summary: 'Separating content from presentation lets non-developers edit, while you keep full control of the frontend.',
    body: '<p>A headless CMS gives content editors a friendly admin UI and gives developers a clean API. You are not boxed into someone else theme system.</p><h2>The trade</h2><p>You write the frontend (more work up front) but you own every pixel and every byte on the wire. For content-driven sites that need a distinct look, that is usually the right call.</p>',
  },
  {
    title: 'Deploying Anywhere',
    author: 'Ops Desk', published_date: '2026-05-15T08:15:00Z',
    summary: 'The same stack ships to a plain Docker host today and a different provider tomorrow by changing one variable.',
    body: '<p>Deployment is provider-swappable. A single dispatcher picks a backend script based on one environment variable.</p><h2>Today: Docker over SSH</h2><p>CI builds an image, pushes it to a registry, then ssh-es into the host and runs <code>docker compose up</code>.</p><h2>Tomorrow: somewhere else</h2><p>Point the variable at a different provider script and the same pipeline targets it. No rewrite.</p>',
  },
  {
    title: 'Editing Content',
    author: 'Editorial Team', published_date: '2026-05-10T11:00:00Z',
    summary: 'Open the CMS, change a field, hit save. The change is live on the next page load. No deploy required.',
    body: '<p>Content and code have different lifecycles. Code changes go through CI. Content changes go through the CMS and are live immediately.</p><p>Try it: open an article in the admin, edit the body, and reload this page. The "Edit in CMS" link in the reader view takes you straight there.</p>',
  },
  {
    title: 'Performance Notes',
    author: 'A. Maintainer', published_date: '2026-05-05T16:45:00Z',
    summary: 'Static frontend, a thin proxy, and on-the-fly image transforms keep things fast without a build step.',
    body: '<p>The frontend is plain HTML and a sprinkle of Alpine.js. There is no bundler and no build step. The backend is a thin proxy.</p><h2>Scaling up</h2><p>When SQLite and local files are not enough, switch Directus to Postgres and S3 with a couple of environment variables. The frontend contract does not change.</p>',
  },
  {
    title: 'Make It Yours',
    author: 'Editorial Team', published_date: '2026-05-01T10:00:00Z',
    summary: 'Rename the collection, add fields, restyle the cards. This is a starting point, not a finished product.',
    body: '<p>Everything here is meant to be edited. Add a <code>category</code> field and filter by it. Add a cover image relation and render it on the cards. Change the palette in <code>style.css</code>.</p><p>The point of a starter is that the boring plumbing — proxy, CI, deploy — is already done, so you can spend your time on the parts that matter.</p>',
  },
];

async function seedArticles() {
  const count = await api('GET', `/items/${COLLECTION}?aggregate[count]=id`);
  const n = count.ok ? Number(count.json?.data?.[0]?.count ?? 0) : 0;
  if (n > 0) { console.log(`• ${COLLECTION} already has ${n} item(s), skipping sample insert`); return; }

  const rows = SAMPLE_ARTICLES.map((a, i) => ({
    ...a, status: 'published', sort: i + 1,
    slug: a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  }));
  const r = await api('POST', '/items/' + COLLECTION, rows);
  if (!r.ok) throw new Error('insert articles failed: ' + JSON.stringify(r.json));
  console.log(`• inserted ${rows.length} sample articles`);
}

(async () => {
  console.log(`Seeding ${COLLECTION} at ${DIRECTUS_URL}`);
  await login();
  await ensureCollection();
  const policyId = await findPublicPolicy();
  await ensurePublicRead(policyId);
  await seedArticles();
  console.log('Done.');
})().catch(err => { console.error('SEED FAILED:', err.message); process.exit(1); });
