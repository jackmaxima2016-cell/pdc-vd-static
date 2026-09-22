#!/usr/bin/env node
/**
 * optimize-images.mjs — conversion WebP des images lourdes des sites migrés.
 *
 * Problème : les médias repris de WordPress sont des PNG/JPG surdimensionnés
 * (PNG 1024x585 de ~900 Ko pour un hero d'article, jusqu'à 2,2 Mo en pleine
 * taille). Sur mobile, un hero de 864 Ko met ~7,4 s à charger -> LCP catastrophique.
 *
 * Ce script :
 *   1. parcourt les HTML de dist/, relève les images réellement référencées
 *      (attributs src + srcset) ;
 *   2. convertit en WebP (mêmes dimensions, quality 80) celles qui dépassent
 *      `--threshold` Ko, en écrivant à la fois dans le miroir persistant
 *      (public/ ou src publicDir) ET dans dist/  -> idempotent, un re-build
 *      réutilise les WebP déjà générés ;
 *   3. réécrit chaque <img> en <picture><source type="image/webp"> + <img> PNG
 *      d'origine en repli (aucune régression pour les navigateurs sans WebP,
 *      et aucun risque de casse CSS : aucun sélecteur `> img` sur le site).
 *
 * Usage : node scripts/optimize-images.mjs [--dist dist] [--media public]
 *                                           [--quality 80] [--threshold 60] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/* sharp peut manquer (dépendance transitive, ou install CI différente) : dans ce cas
   on n'optimise rien mais le build ne doit JAMAIS échouer à cause de ce script. */
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.warn('optimize-images: sharp indisponible — étape ignorée (build non bloqué)');
  process.exit(0);
}

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? def : argv[i + 1];
};
const DRY = argv.includes('--dry');
const ROOT = process.cwd();
const DIST = path.resolve(ROOT, arg('dist', 'dist'));
const MEDIA = path.resolve(ROOT, arg('media', 'public'));
const QUALITY = Number(arg('quality', '80'));
const THRESHOLD = Number(arg('threshold', '60')) * 1024;
const IMG_EXT = /\.(png|jpe?g)$/i;
const LOCAL_PREFIX = '/wp-content/uploads/';
sharp.concurrency(1); // limite la mémoire de libvips (des runs ont été tués par l'OOM)

if (!fs.existsSync(DIST)) {
  console.error(`dist introuvable : ${DIST}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 1. collecte
function* walkHtml(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkHtml(p);
    else if (e.name.endsWith('.html')) yield p;
  }
}

/* Une image est "locale" si le chemin existe réellement dans dist/ : couvre
   /wp-content/uploads/ (migration WP) comme /images/ (sites sur mesure). */
const existsInDist = (pathname) => {
  const p = path.join(DIST, pathname);
  return pathname.startsWith('/') && !p.includes('..') && fs.existsSync(p) && fs.statSync(p).isFile();
};

const IMG_RE = /<img\b[^>]*>/gi;
const URL_ATTR_RE = /(src|srcset)="([^"]*)"/gi;

const referenced = new Set();
const htmlFiles = [];
for (const file of walkHtml(DIST)) {
  htmlFiles.push(file);
  const html = fs.readFileSync(file, 'utf8');
  for (const tag of html.match(IMG_RE) || []) {
    for (const m of tag.matchAll(URL_ATTR_RE)) {
      for (const part of m[2].split(',')) {
        let u = part.trim().split(/\s+/)[0];
        if (!u) continue;
        if (u.startsWith('http')) {
          try {
            u = new URL(u).pathname;
          } catch {
            continue;
          }
        }
        if (IMG_EXT.test(u) && existsInDist(u)) referenced.add(u);
      }
    }
  }
}

// ------------------------------------------------------- 2. conversion WebP
const toConvert = [];
for (const rel of referenced) {
  const inDist = path.join(DIST, rel);
  if (!fs.existsSync(inDist)) continue;
  const size = fs.statSync(inDist).size;
  if (size <= THRESHOLD) continue;
  const webpRel = rel.replace(IMG_EXT, '.webp');
  const inMedia = path.join(MEDIA, webpRel);
  const inDistWebp = path.join(DIST, webpRel);
  if (fs.existsSync(inMedia) && fs.existsSync(inDistWebp)) continue;
  toConvert.push({ rel, webpRel, size });
}
toConvert.sort((a, b) => b.size - a.size);

const totalMo = (toConvert.reduce((s, x) => s + x.size, 0) / 2 ** 20).toFixed(0);
console.log(
  `${htmlFiles.length} HTML, ${referenced.size} images référencées, ` +
    `${toConvert.length} à convertir (${totalMo} Mo) — quality ${QUALITY}` +
    (DRY ? ' [DRY RUN]' : ''),
);
if (DRY) {
  for (const c of toConvert.slice(0, 10))
    console.log(`  ${(c.size / 1024).toFixed(0)} Ko  ${c.rel}`);
  process.exit(0);
}

let done = 0;
let failed = 0;
let savedBytes = 0;
const t0 = Date.now();
const CONCURRENCY = Math.max(1, Number(arg('concurrency', String(Math.max(2, Math.min(4, os.cpus().length - 2))))));
let cursor = 0;
async function worker() {
  while (cursor < toConvert.length) {
    const job = toConvert[cursor++];
    try {
      const buf = await sharp(path.join(DIST, job.rel), { failOn: 'none' })
        .webp({ quality: QUALITY, effort: 4 })
        .toBuffer();
      for (const dest of [path.join(MEDIA, job.webpRel), path.join(DIST, job.webpRel)]) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
      }
      savedBytes += job.size - buf.length;
    } catch (e) {
      failed++;
      console.error(`  ! échec ${job.rel} : ${e.message}`);
    }
    done++;
    if (done % 200 === 0 || done === toConvert.length) {
      const el = (Date.now() - t0) / 1000;
      console.log(
        `  ${done}/${toConvert.length} — ${(savedBytes / 2 ** 20).toFixed(0)} Mo économisés ` +
          `— ${el.toFixed(0)} s (${(done / el).toFixed(1)} img/s)` +
          (failed ? ` — ${failed} échecs` : ''),
      );
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// -------------------------------------------------------- 3. réécriture HTML
const webpCache = new Map();
const hasWebp = (rel) => {
  if (!webpCache.has(rel)) {
    const w = rel.replace(IMG_EXT, '.webp');
    webpCache.set(rel, fs.existsSync(path.join(DIST, w)) ? w : null);
  }
  return webpCache.get(rel);
};
const toLocal = (u) => {
  if (u.startsWith('http')) {
    try {
      const url = new URL(u);
      return existsInDist(url.pathname) || hasWebp(url.pathname)
        ? { origin: url.origin, pathname: url.pathname }
        : null;
    } catch {
      return null;
    }
  }
  return u.startsWith('/') ? { origin: '', pathname: u } : null;
};

/* Un <img> déjà optimisé est précédé de <picture><source type="image/webp" …>,
   on le capture pour rester idempotent (relance du script sur dist/ sans re-build). */
const PIC_RE = /(<picture><source type="image\/webp"[^>]*>)?<img\b[^>]*>/gi;

function optimizeTag(tag) {
  /* On dérive les candidates WebP depuis la balise d'origine, mais on laisse le
     <img> intact (PNG/JPG) : il sert de repli aux navigateurs sans WebP. */
  let webpSrc = null;
  const srcM = tag.match(/\ssrc="([^"]*)"/i);
  if (srcM) {
    const loc = toLocal(srcM[1]);
    if (loc) {
      const w = hasWebp(loc.pathname);
      if (w) webpSrc = loc.origin + w;
    }
  }
  let webpSrcset = null;
  const setM = tag.match(/\ssrcset="([^"]*)"/i);
  if (setM) {
    const parts = setM[1]
      .split(',')
      .map((p) => {
        const [u, ...d] = p.trim().split(/\s+/);
        const loc = toLocal(u);
        if (!loc) return null;
        const w = hasWebp(loc.pathname);
        if (!w) return null;
        return [`${loc.origin}${w}`, ...d].join(' ');
      })
      .filter(Boolean);
    if (parts.length) webpSrcset = parts.join(', ');
  }
  if (!webpSrcset && !webpSrc) return tag;
  let set = webpSrcset;
  if (!set) {
    const wm = tag.match(/\swidth="(\d+)"/i);
    set = wm ? `${webpSrc} ${wm[1]}w` : webpSrc;
  }
  return `<picture><source type="image/webp" srcset="${set}">${tag}</picture>`;
}

let rewritten = 0;
let filesTouched = 0;
let preloads = 0;
/* Les pages embarquent un <link rel="preload" as="image" href="…hero.png"> : sans
   réécriture, le navigateur télécharge le PNG lourd EN PLUS du WebP (mesuré :
   864 Ko + 88 Ko). On bascule le preload sur le WebP. */
const PRELOAD_RE = /<link\b[^>]*rel="preload"[^>]*as="image"[^>]*>/gi;

function optimizePreload(tag) {
  if (tag.includes('.webp')) return tag;
  let changed = false;
  const swap = (u) => {
    const loc = toLocal(u.trim().split(/\s+/)[0]);
    if (!loc) return u;
    const w = hasWebp(loc.pathname);
    if (!w) return u;
    changed = true;
    return u.replace(loc.pathname, w);
  };
  let out = tag.replace(/(\shref=")([^"]*)(")/i, (m, a, v, c) => a + swap(v) + c);
  out = out.replace(/(\simagesrcset=")([^"]*)(")/i, (_m, a, v, c) =>
    a + v.split(',').map((p) => swap(p.trim())).join(', ') + c,
  );
  if (!changed) return tag;
  if (!/\stype=/i.test(out)) out = out.replace(/^<link/i, '<link type="image/webp"');
  preloads++;
  return out;
}

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const out = html.replace(PIC_RE, (whole, existingPic) => {
    if (existingPic) return whole;
    const optimized = optimizeTag(whole);
    if (optimized === whole) return whole;
    rewritten++;
    return optimized;
  }).replace(PRELOAD_RE, optimizePreload);
  if (out !== html) {
    fs.writeFileSync(file, out);
    filesTouched++;
  }
}

console.log(
  `\n${done} images converties en ${((Date.now() - t0) / 1000).toFixed(0)} s — ` +
    `${(savedBytes / 2 ** 20).toFixed(0)} Mo en moins.\n` +
    `${rewritten} balises <img> optimisées, ${preloads} preloads basculés en WebP, ` +
    `dans ${filesTouched} pages HTML.`,
);
