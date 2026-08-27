# PDC VD — site statique Astro

Migration blog WordPress → Astro statique + Cloudflare Pages.

- Site cible : https://pdc-vd.ch
- Build : `npm ci && npm run build`
- Préversion noindex : `NOINDEX=1 npm run build`
- Contrat SEO : `python3 scripts/seo_contract.py data/audit_pdc-vd.json dist --posts data/wp/posts.json`
- Données : `data/wp/*.json` (export API REST WP), médias dans `public/wp-content/uploads/`
