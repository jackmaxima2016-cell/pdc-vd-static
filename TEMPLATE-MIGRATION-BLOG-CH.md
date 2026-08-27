# 🇨🇭 Modèle de migration BLOG .ch — WordPress → Astro statique

> Déclinaison **blog/magazine** du modèle `TEMPLATE-NOUVEAU-DOMAINE.md` (site média à publications
> sponsorisées). Pour migrer un **WordPress type blog** (articles, catégories, tags, éventuellement
> magazine/Newspaper) vers un site statique Astro + Cloudflare Pages, sur un domaine **.ch**.
> Durée estimée : **2-4 h** (hors téléchargement uploads et rédaction).

---

## 1. Vue d'ensemble

```
Domaine .ch ──CNAME──► <projet>.pages.dev (Cloudflare Pages)
                        │
        ┌───────────────┴──────────────────┐
        │ Build GitHub Actions (push main) │
        │   npm ci → build Astro →         │
        │   contrat SEO (bloquant) →       │
        │   wrangler pages deploy          │
        └───────────────┬──────────────────┘
                        │
        Données : data/wp/*.json + public/wp-content/uploads/
```

**Différences clés vs modèle média (fluiid) :**
- **Source = dump SQL** du WP (posts, pages, catégories, tags, options, menu) — pas le cache CDN
- **Filtrage anti-spam** : si le WP est (ou a été) piraté, le pirate injecte des milliers de posts
  volés/traduits (SEO spam) + redirections `base href` — **ne jamais migrer un dump tel quel**
- **Pagination & catégories** : `/page/2/`, `/category/x/` — ou tout en une page avec filtre JS
- **Aucun PHP nécessaire à la fin** : tout est généré au build

---

## 2. Prérequis (avant de commencer)

| # | Prérequis | Pourquoi |
|---|---|---|
| 1 | **Site WP débloqué** (PHP répond 200) | Sinon pas de dump SQL possible |
| 2 | **Accès FTP** au compte | Récupérer uploads + wp-config.php |
| 3 | Creds DB dans `wp-config.php` (DB_NAME, DB_USER, DB_PASSWORD, prefix, charset) | Connexion MySQL / dump |
| 4 | `zz_dump.php` déposé à la racine du site | Dump SQL via HTTP (URL secrète, supprimé après) |
| 5 | Récupération des uploads (ou accès direct) | Images des articles |

> **Si le site est en 500 (quarantaine/WAF)** : le dump SQL est IMPOSSIBLE tant que PHP ne répond
> pas. Le cache CDN ne suffit PAS (seules quelques pages + sitemaps survivent, les articles
> passent en 500). → **Débloquer d'abord** (ticket support hébergeur), sinon aucune migration propre.

---

## 3. Étape 1 — Dump de la base (une fois PHP OK)

1. Déposer `zz_dump.php` (générateur de dump SQL avec secret, chmod 600) à la racine du site
2. `GET https://domaine.ch/zz_dump.php?key=<SECRET>` → télécharger le `.sql` (compressé si possible)
3. **Supprimer immédiatement `zz_dump.php` du serveur**
4. Inspecter le dump :
   - `wp_options` → `siteurl`, `home`, `blogname`, `blogdescription`, `permalink_structure`
   - `wp_posts` → `post_type` in ('post','page'), `post_status` = publish, `post_date`, `post_name`, `post_content`
   - `wp_term_taxonomy` + `wp_terms` → catégories/tags
   - Éventuelles tables WooCommerce → décision boutique (statique = pas de panier)

> ⚠️ Prefix possible non standard (ex. worldnet.fr : `wpgk_`). Adapter les noms de tables.

---

## 4. Étape 2 — FILTRAGE ANTI-SPAM (si le WP a été piraté)

Le pirate injecte du contenu volé pour du SEO black-hat. **Ne JAMAIS migrer tout le dump tel quel.**

### Signatures de spam à détecter
| Indice | Exemple |
|---|---|
| Titres hors-sujet auto-traduits | COVID/NHS UK, « coque iPhone Princess Bride », finance, crypto |
| `<base href>` vers un domaine tiers | `https://www.e.leclerc/` |
| CSS/JS de domaines inconnus | `static.okok966.cyou/template-3.css` |
| Pages multilingues génériques | `/en/`, `/de/`, `/it/` « <nom>-est-un-magazine-en-ligne… » |
| Rafts de posts identiques par date | 100+ posts créés le même jour |
| Contenu sans rapport avec la marque | dropshipping, santé volée |

### Filtrage
1. **Date** : conserver les posts antérieurs à la date d'infection (ex. avant 14/08/2026) SAUF contenu vérifié
2. **Rapport à la marque** : titre/URL doit correspondre au domaine et à son secteur
3. **Vérif manuelle** : échantillonner les posts conservés (catégories, dates, cohérence)
4. **Résultat attendu** : souvent 95-99 % du dump est du spam — valider le contenu légitime avec le propriétaire

---

## 5. Étape 3 — Génération des données Astro

Format identique au modèle (`data/wp/*.json`) :
- `data/wp/posts.json` — articles filtrés : `slug`, `title`, `date`, `excerpt`, `content` (Markdown/HTML), `categories[]`, `featured_image`
- `data/wp/pages.json` — pages statiques (accueil, contact, merci, légales)
- `data/wp/categories.json` — catégories conservées
- `public/wp-content/uploads/` — images téléchargées (uploads/)

> **WooCommerce** : si la boutique est abandonnée → ne PAS migrer les produits ; garder
> éventuellement une page « Boutique » redirigeant vers un canal de vente existant (ou la retirer).
> Le formulaire de contact/commande du modèle média peut remplacer le panier.

---

## 6. Étape 4 — Adaptation du site Astro (depuis le modèle média)

| Fichier | Adaptation BLOG |
|---|---|
| `astro.config.mjs` | `site: 'https://domaine.ch'`, pagination si besoin |
| `src/pages/index.astro` | Liste d'articles (derniers posts + pagination ou « voir plus ») |
| `src/pages/[slug].astro` | **Template article** : titre, date, catégories, image vedette, contenu, précédent/suivant |
| `src/pages/page/[page].astro` | Pagination des archives |
| `src/pages/category/[slug].astro` | Pages catégories (si conservées) |
| `src/layouts/Base.astro` | Nom du site, tagline, footer, couleurs de marque, clés localStorage |
| `src/lib/seo.mjs` | Canonicals, robots (interdire `/category/` si non migré), sitemap |
| `functions/api/contact.js` | Formulaire de contact (Turnstile + relais email) |
| Pages légales ×4 | Nom éditeur + canonical |

> Sitemap : générer `sitemap-index.xml` avec uniquement les URLs migrées (post-filter).

---

## 7. Secrets & déploiement (identique au modèle)

- **Cloudflare Pages** : `TURNSTILE_SECRET` (Encrypted), `STRIPE_SECRET_KEY` (si paiement conservé), `PUBLIC_GA4_ID`
- **GitHub Actions** : `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GA4_ID`
- **DNS** : CNAME `@` → `<projet>.pages.dev` (proxy orange)
- **CI** : `npm ci` → `npm run build` → contrat SEO (bloquant) → `wrangler pages deploy`
- **Externe** : Turnstile (paire par domaine), GA4 (propriété par domaine), Search Console (sitemap)

---

## 8. Vérifications post-migration

- [ ] Toutes les pages migrées : 200 (accueil, articles, pages, légales)
- [ ] Aucune URL spam dans le sitemap (comparer avec la liste filtrée)
- [ ] `grep -rn "e.leclerc\|okok966\|base href" dist/` → vide (aucune trace de spam)
- [ ] Images : pas de lien mort vers l'ancien WP (tout en local)
- [ ] Ancien WP : à supprimer/neutraliser côté serveur (fichiers PHP + DB) après bascule DNS
- [ ] Contrat SEO : `python3 scripts/seo_contract.py data/audit_<domaine>.json dist --posts data/wp/posts.json` → « ✅ CONFORME »
- [ ] GA4 Temps réel + Search Console (sitemap soumis)
- [ ] robots.txt final : pas de `/category/` si non migré

---

## 9. Garde-fous (ajoutés vs modèle média)

1. **Ne jamais migrer un dump sans filtre anti-spam** — le pirate peut avoir injecté 99 % du contenu
2. **Vérifier les `base href` / domaines tiers** dans le contenu migré (redirections silencieuses)
3. **Supprimer `zz_dump.php` après usage** — c'est une porte ouverte
4. **Ne pas exposer les creds DB** (dump jamais commité ; `.gitignore`)
5. **Le contenu légitime d'un WP piraté peut être quasi nul** — valider avec le propriétaire avant de migrer (souvent seul l'accueil + 2-3 pages sont authentiques)
6. **Cache CDN ≠ source de vérité** : ne migrer QUE depuis le dump SQL
