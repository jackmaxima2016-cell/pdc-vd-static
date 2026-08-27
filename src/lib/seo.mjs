// Référence SEO réelle : l'audit WP (source de vérité = ce que Google voit actuellement)
// Mapping URL -> { title, meta_description }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'data', 'audit_pdc-vd.json',
);

let _map = null;

export function getSeoMap() {
  if (_map) return _map;
  _map = new Map();
  try {
    const audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));
    for (const page of audit.pages) {
      _map.set(page.url, {
        title: page.title,
        description: page.meta_description || '',
      });
    }
  } catch {
    // Pas d'audit disponible : le build continue avec les titres par défaut
  }
  return _map;
}

// Retourne { title, description } pour une URL absolue du site
export function getSeoForUrl(url) {
  const map = getSeoMap();
  return map.get(url) ?? null;
}
