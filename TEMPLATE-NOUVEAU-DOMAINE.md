# 🇨🇭 Modèle de site Fluiid — déploiement sur un nouveau domaine .ch

> Ce dépôt est le **modèle de référence** pour déployer un site de publications sponsorisées
> (média + formulaire de commande multistep + paiement Stripe) sur n'importe quel domaine `.ch`.
> Durée estimée du déploiement complet : **~45-60 min** (hors contenu éditorial).

---

## 1. Vue d'ensemble de l'architecture

```
Domaine .ch ──CNAME──► fluiid.pages.dev (Cloudflare Pages, projet « fluiid »)
                             │
        ┌────────────────────┼─────────────────────────┐
        │ build GitHub Actions (push main)             │
        │   npm ci → fetch-wp (optionnel) → build      │
        │   → contrat SEO (bloquant) → wrangler deploy │
        └────────────────────┼─────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │ Secrets Pages (Encrypted)   │
              │ TURNSTILE_SECRET            │
              │ STRIPE_SECRET_KEY (live)    │
              │ PUBLIC_GA4_ID (variable)    │
              └─────────────────────────────┘
```

**Composants** : Astro (statique) + Cloudflare Pages + Pages Functions (`functions/api/` :
checkout Stripe, confirm email, contact) + Turnstile (anti-robot) + GA4 (mesure d'audience,
Consent Mode v2) + contrat SEO bloquant dans la CI.

---

## 2. Ce qui est déjà générique (rien à toucher)

- ✅ Design complet (1200 px, bandeau sticky, menu clic-only, burger, footer 4 colonnes)
- ✅ Formulaire multistep : 4 étapes cliquables, champs conditionnels, 2 blocs « offre de
  lancement », 3 comptes à rebours synchronisés (15 min/visiteur, localStorage)
- ✅ Stripe Checkout : prix recalculés côté serveur (promo −40 %), redirection, page merci
- ✅ Turnstile, honeypot, validation serveur
- ✅ Pages légales standards (mentions, confidentialité, CGV, plan du site) — **textes
  génériques utilisables tels quels**, seul le nom de l'éditeur est à adapter
- ✅ GA4 : activé via variable `PUBLIC_GA4_ID` (bannière de consentement Accepter/Refuser,
  conforme LPD suisse)
- ✅ SEO : canonical, titles, sitemap dynamique, robots.txt, contrat bloquant dans la CI
- ✅ Anti-spam : aucun email affiché publiquement

---

## 3. Checklist de personnalisation par domaine

### 3.1 Code à modifier (6 fichiers)

| Fichier | À changer | Exemple |
|---|---|---|
| `astro.config.mjs` | `site` | `https://mondomaine.ch` |
| `functions/api/checkout.js` | `FORM_MAILTO` (email récepteur), `SITE`, libellé produit | `contact@mondomaine.ch`, `Pack X — mondomaine.ch` |
| `functions/api/confirm.js` | `FORM_MAILTO` | idem |
| `src/components/ContactForm.astro` | `TURNSTILE_SITE_KEY` (publique), `_subject` | `0x4AAAA…` |
| `src/layouts/Base.astro` | nom/logo (« Fluiid »), tagline, footer, clés localStorage | « MonMédia », `mm_consent_v1` |
| `src/pages/contact/index.astro` | `TITLE`/`DESC`/`CANONICAL` (page formulaire incluse dans le modèle) | `https://mondomaine.ch/contact/` |
| Pages légales (`mentions-legales`, `confidentialite`, `cgv`, `plan-du-site`) | `CANONICAL` + nom de l'éditeur dans `DESC`/texte | `https://mondomaine.ch/cgv/` |

> Les fallbacks `https://fluiid.ch` dans `index.astro`, `[slug].astro`, `page/[page].astro`,
> `404.astro`, `seo.mjs` sont **inertes** (Astro.site est défini par `astro.config.mjs`) mais
> à nettoyer pour éviter toute fuite.

### 3.2 Contenu éditorial

- `data/wp/*.json` : posts/pages/catégories (146 entrées pour fluiid.ch) → à remplacer
- `public/wp-content/uploads/` : images → à remplacer
- Deux chemins :
  - **A. Site existant WP** : reconfigurer `scripts/fetch-wp.mjs` (`WP_BASE`, `WP_HOST` dans
    le workflow) puis `npm run fetch:wp` → la CI le fait à chaque build (non-bloquant)
  - **B. Contenu neuf** : générer les JSON avec le même format (`wp.mjs` s'en charge)

### 3.3 Secrets & variables (jamais dans le code)

**Cloudflare Pages (projet `fluiid`) — Settings → Variables :**
- `TURNSTILE_SECRET` (Encrypted) — nouvelle paire Turnstile par domaine
- `STRIPE_SECRET_KEY` (Encrypted) — clé live Stripe (compte du domaine)
- `PUBLIC_GA4_ID` — ID de mesure GA4 du domaine

**GitHub (repo du domaine) — Settings → Secrets :**
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (mêmes que fluiid.ch)
- `GA4_ID` (duplique `PUBLIC_GA4_ID` pour le build GitHub Actions)
- `TURNSTILE_SECRET`, `STRIPE_SECRET_KEY` (si le workflow les passe en env aux Functions —
  sinon les définir uniquement côté Pages)

**Commande type pour re-poser un secret Pages :**
```bash
export CLOUDFLARE_ACCOUNT_ID=<account_id>
printf '%s' "$VALEUR" | npx wrangler pages secret put NOM --project-name fluiid
```

### 3.4 Configuration externe par domaine

| Service | Action |
|---|---|
| **Cloudflare** | Zone DNS du domaine ; CNAME `@` → `fluiid.pages.dev` (proxy orange) ; projet Pages existant ou nouveau |
| **Stripe** | Compte/mode live ; Webhook éventuel ; test 4242 avant mise en service |
| **Turnstile** | Nouvelle paire site key + secret (liée au domaine) |
| **GA4** | Nouvelle propriété par domaine, ID dans `PUBLIC_GA4_ID`/`GA4_ID` |
| **Email récepteur** | Boîte du domaine (ex. o2switch) + activer le relais (FormSubmit) pour `FORM_MAILTO` |
| **Search Console** | Soumettre le sitemap (`/sitemap-index.xml`) après déploiement |

---

## 4. Procédure de déploiement (résumé)

1. `git clone` du dépôt modèle → nouveau repo GitHub (branche `main`)
2. Appliquer la checklist §3 (rechercher/remplacer `fluiid`/`Fluiid`/`fluiid.ch`)
3. `npm ci && npm run build` local → vérifier `python3 scripts/seo_contract.py`
4. Créer/configurer le projet Pages + secrets (§3.3)
5. Configurer les secrets GitHub + workflow (déjà en place dans le modèle)
6. `git push` → CI : build → contrat SEO → deploy
7. DNS : CNAME vers `fluiid.pages.dev` + HTTPS
8. Vérifications prod : Playwright (menu, formulaire, countdowns, pages 200),
   test de commande Stripe 4242, GA4 Temps réel, Search Console

---

## 5. Garde-fous (vérifiés sur fluiid.ch)

- **Contrat SEO bloquant** dans la CI : toute régression de title/H1/canonical/URL bloque le déploiement
- **Pages légales indexables**, `/contact/merci/` en `noindex` (hors sitemap)
- **Aucun secret dans le dépôt** (`.gitignore` + secrets injectés au build/runtime)
- **Aucun email public** (anti-spam) — réception technique uniquement côté serveur
- **Consentement GA4** obligatoire avant tracking (LPD suisse) — bannière intégrée
- Comptes à rebours promo par visiteur (localStorage) — pas de fuite entre visiteurs
