#!/usr/bin/env node
/**
 * Extraction de l'ensemble du contenu WordPress via l'API REST.
 * Écrit les données dans ../data/wp/ (posts, pages, media, categories, tags).
 *
 * Usage: node scripts/fetch-wp.mjs [https://ip-du-wp]
 * Env :
 *   WP_BASE (URL du WordPress, défaut https://109.234.164.18 — IP de l'hébergeur)
 *   WP_HOST (Host header + SNI, défaut fluiid.ch — le domaine pointe maintenant vers Pages)
 *
 * Le WP est joint par IP : certificat TLS non vérifié (source fixe et connue),
 * SNI et Host réglés sur le domaine réel pour que le vhost mutualisé réponde.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.WP_BASE || process.argv[2] || 'https://109.234.164.18').replace(/\/$/, '');
const HOST = process.env.WP_HOST || 'fluiid.ch';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'wp');
fs.mkdirSync(OUT, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// GET via https.request : contrôle du SNI (servername) et des headers — undici
// (fetch) est refusé par le serveur mutualisé o2switch (HTTP 503).
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method: 'GET',
        servername: HOST,
        rejectUnauthorized: false,
        headers: {
          Host: HOST,
          'User-Agent': UA,
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// 3 tentatives + backoff (le serveur mutualisé peut être lent)
async function fetchRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await httpsGet(url);
      if (res.status >= 200 && res.status < 300) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    console.warn(`  [retry ${i}/${attempts}] ${url.split('/wp-json')[1]} -> ${lastErr.message}`);
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
  throw lastErr;
}

async function getAll(endpoint, perPage = 100) {
  const items = [];
  let page = 1;
  for (;;) {
    const url = `${BASE}/wp-json/wp/v2/${endpoint}?per_page=${perPage}&page=${page}&_embed`;
    const res = await fetchRetry(url);
    if (res.status < 200 || res.status >= 300) {
      console.warn(`  [warn] ${endpoint} page ${page} -> HTTP ${res.status}`);
      break;
    }
    const batch = JSON.parse(res.body);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return items;
}

async function main() {
  console.log(`[fetch-wp] Extraction depuis ${BASE} (Host/SNI: ${HOST})`);
  for (const endpoint of ['posts', 'pages', 'media', 'categories', 'tags']) {
    const items = await getAll(endpoint);
    const file = path.join(OUT, `${endpoint}.json`);
    fs.writeFileSync(file, JSON.stringify(items, null, 1));
    console.log(`[fetch-wp] ${endpoint}: ${items.length} -> data/wp/${endpoint}.json`);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('[fetch-wp] Terminé.');
}

main().catch((e) => {
  console.error('[fetch-wp] Erreur:', e.message);
  process.exit(1);
});
