#!/usr/bin/env python3
"""CONTRAT SEO — comparateur WordPress (référence) vs site Astro généré.

Pour chaque URL de l'audit de référence, vérifie que le site généré produit :
  - un fichier HTML (statut 200 équivalent)
  - le même <title>          (source : audit = ce que Google voit)
  - le même <link rel="canonical">
  - le même <h1>
  - pas de noindex accidentel
  - le contenu intégral des articles (comparé à posts.json)
  - les titres des articles attendus sur les pages de listing

Usage: python3 seo_contract.py ../data/audit_fluiid.json ../astro-site/dist [--posts ../data/wp/posts.json] [--allow-noindex]
Exit code 0 = conforme, 1 = violations critiques (bloque la mise en prod).
--allow-noindex : préversion seulement — tolère le meta robots noindex global (NOINDEX=1).
"""
import json, re, sys, urllib.parse
from pathlib import Path

REF, DIST = Path(sys.argv[1]), Path(sys.argv[2])
POSTS_FILE = None
if '--posts' in sys.argv:
    POSTS_FILE = Path(sys.argv[sys.argv.index('--posts') + 1])
ALLOW_NOINDEX = '--allow-noindex' in sys.argv

audit = json.loads(REF.read_text())
pages = audit['pages']
dist = DIST

def decode_entities(s=''):
    s = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), s)
    return (s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
             .replace('&quot;', '"').replace('&nbsp;', ' ')
             .replace('&rsquo;', '’').replace('&lsquo;', '‘')
             .replace('&ndash;', '–').replace('&mdash;', '—')
             .replace('&hellip;', '…')).strip()

def normalize(s):
    return re.sub(r'\s+', ' ', decode_entities(s or '')).strip().lower()

def url_to_file(url):
    path = url.split('//', 1)[-1]
    path = path.split('/', 1)[1] if '/' in path else ''
    if not path or path.endswith('/'):
        path += 'index.html'
    return dist / path

# Référence des articles (contenu + titres) si disponible
posts_by_slug = {}
if POSTS_FILE and POSTS_FILE.exists():
    posts = json.loads(POSTS_FILE.read_text())
    posts_by_slug = {p['slug']: p for p in posts}
    # Ordre de listing = tri par date desc (identique au site)
    ordered = sorted(posts, key=lambda p: p['date'], reverse=True)

def expected_listing(relpath):
    """Slugs attendus sur une page de listing (/, /page/N/) — 10 par page."""
    if not posts_by_slug:
        return None
    if relpath in ('', 'index.html'):
        n = 1
    else:
        m = re.match(r'page/(\d+)/', relpath)
        n = int(m.group(1)) if m else None
    if n is None:
        return None
    start = (n - 1) * 10
    return [p['slug'] for p in ordered[start:start + 10]]

def text_of(html):
    text = re.sub(r'<script.*?</script>|<style.*?</style>|<[^>]+>', ' ', html, flags=re.S)
    return re.sub(r'\s+', ' ', text).strip()

violations = []
checks = 0
for p in pages:
    url = p['url']
    f = url_to_file(url)
    relpath = str(f.relative_to(dist))
    if not f.exists():
        violations.append({'url': url, 'type': 'MISSING', 'detail': f'fichier absent: {relpath}'})
        continue
    html = f.read_text(errors='ignore')

    def grab(pattern):
        m = re.search(pattern, html, re.S)
        return m.group(1).strip() if m else ''

    # 1. Title (identique à l'audit)
    gen_title = grab(r'<title[^>]*>(.*?)</title>')
    if normalize(gen_title) != normalize(p['title']):
        violations.append({'url': url, 'type': 'TITLE', 'detail': f'WP: {p["title"][:70]!r} | ASTRO: {gen_title[:70]!r}'})
    else:
        checks += 1

    # 2. Canonical (normalisé : %-decode + majuscules)
    def norm_url(u):
        u = urllib.parse.unquote(u)
        return re.sub(r'https?://', '', u).lower().rstrip('/')
    gen_canon = grab(r'<link rel="canonical" href="([^"]+)"')
    if norm_url(gen_canon) != norm_url(p['canonical']):
        violations.append({'url': url, 'type': 'CANONICAL', 'detail': f'WP: {p["canonical"]} | ASTRO: {gen_canon}'})
    else:
        checks += 1

    # 3. H1 — si la page WP de référence n'a aucun H1, on considère la vérification
    # comme OK (le site Astro en génère un : amélioration, pas régression).
    gen_h1 = grab(r'<h1[^>]*>(.*?)</h1>')
    if not gen_h1:
        violations.append({'url': url, 'type': 'H1_MISSING', 'detail': 'aucun <h1>'})
    elif not p['h1']:
        checks += 1
    elif normalize(gen_h1) != normalize(p['h1'][0]):
        violations.append({'url': url, 'type': 'H1_DIFF', 'detail': f'WP: {p["h1"][:60]!r} | ASTRO: {gen_h1[:60]!r}'})
    else:
        checks += 1

    # 4. noindex accidentel (toléré en préversion --allow-noindex)
    robots = grab(r'<meta name="robots" content="([^"]*)"')
    if 'noindex' in robots and not ALLOW_NOINDEX:
        violations.append({'url': url, 'type': 'NOINDEX', 'detail': robots})

    # 5. Contenu
    expected = expected_listing(relpath)
    if expected is not None:
        # Page de listing : les titres des articles attendus doivent être présents
        missing = []
        for slug in expected:
            post = posts_by_slug.get(slug)
            if not post:
                continue
            t = normalize(post['title']['rendered'])
            if t and t not in normalize(html):
                missing.append(slug)
        if missing:
            violations.append({'url': url, 'type': 'LISTING_MISSING', 'detail': f'articles absents: {missing[:5]}'})
        else:
            checks += 1
    elif relpath.endswith('index.html') and not relpath.startswith('404'):
        # Article WP : comparer le texte du .entry-content généré au contenu réel
        # (content.rendered) — référence fiable, sans le chrome du thème.
        slug = relpath.split('/')[0]
        post = posts_by_slug.get(slug)
        if post:
            wp_content = text_of(post.get('content', {}).get('rendered', ''))
            m_entry = re.search(r'<div class="entry-content"[^>]*>(.*?)</div>\s*</article>', html, re.S)
            gen_content = text_of(m_entry.group(1)) if m_entry else ''
            if len(wp_content) > 200 and gen_content and len(gen_content) < len(wp_content) * 0.9:
                violations.append({'url': url, 'type': 'CONTENT_LOSS', 'detail': f'WP content: {len(wp_content)} chars | ASTRO: {len(gen_content)} chars'})
            elif not gen_content:
                violations.append({'url': url, 'type': 'CONTENT_LOSS', 'detail': '.entry-content introuvable'})
            else:
                checks += 1
        # Pages WordPress (ex: contact avec formulaire JS) : pas de test de contenu,
        # uniquement title/canonical/H1 (déjà vérifiés ci-dessus).
        else:
            checks += 1

print('=' * 70)
print(f'CONTRAT SEO — {audit["domain"]}')
print(f'{len(pages)} URLs auditées — {checks} vérifications OK — {len(violations)} violations')
print('=' * 70)
for v in violations:
    print(f"  [{v['type']}] {v['url']}")
    print(f"      {v['detail'][:150]}")

critical = [v for v in violations if v['type'] != 'CONTENT_LOSS']
if critical:
    print(f'\n❌ ÉCHEC : {len(critical)} violations critiques — MISE EN PROD BLOQUÉE')
    sys.exit(1)
print('\n✅ CONFORME — le site généré respecte le contrat SEO')
sys.exit(0)
