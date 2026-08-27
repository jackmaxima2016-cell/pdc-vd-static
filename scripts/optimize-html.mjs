// Post-build : enrichit les <img> du HTML généré
//  - width/height réels (anti-CLS) pour les images qui n'en ont pas
//  - loading="lazy" + decoding="async" (sauf l'image hero fetchpriority=high)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) files.push(p);
  }
})(DIST);

let imgs = 0, sized = 0, lazy = 0;
for (const f of files) {
  let html = fs.readFileSync(f, 'utf-8');
  const before = html;
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    imgs++;
    let t = tag;
    // lazy : pas sur l'image hero (fetchpriority) ni celles déjà lazy
    if (!/fetchpriority=/i.test(t) && !/loading=/i.test(t)) {
      t = t.replace(/^<img/i, '<img loading="lazy" decoding="async"');
      lazy++;
    } else if (!/decoding=/i.test(t)) {
      t = t.replace(/^<img/i, '<img decoding="async"');
    }
    // width/height réels si absents et fichier local
    if (!/width=/i.test(t) && !/height=/i.test(t)) {
      const m = t.match(/src=["']([^"']+)/);
      if (m && m[1].startsWith('/')) {
        const fp = path.join(DIST, m[1].replace(/^\//, ''));
        if (fs.existsSync(fp)) {
          try {
            const dim = imageSize(fp);
            if (dim.width && dim.height) {
              t = t.replace(/^<img/i, `<img width="${dim.width}" height="${dim.height}"`);
              sized++;
            }
          } catch { /* format non lisible : on laisse tel quel */ }
        }
      }
    }
    return t;
  });
  if (html !== before) fs.writeFileSync(f, html);
}
console.log(`optimize-html: ${imgs} <img> | width/height ajoutés: ${sized} | lazy ajoutés: ${lazy}`);
