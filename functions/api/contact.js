// Pages Function — POST /api/contact
// 1. Vérifie le token Cloudflare Turnstile (secret en variable d'env Pages)
// 2. Relaie les données vers FormSubmit → optitechgeneve@gmail.com
// Zéro secret dans le dépôt : TURNSTILE_SECRET est injecté par Cloudflare Pages.

const FORM_MAILTO = 'optitechgeneve@gmail.com';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const fd = await request.formData();

    // Honeypot : un robot remplit le champ caché
    if (fd.get('_honey')) {
      return json({ success: 'false', message: 'Soumission rejetée.' }, 400);
    }

    // Turnstile : token obligatoire
    const token = fd.get('cf-turnstile-response') || '';
    if (!env.TURNSTILE_SECRET) {
      return json({ success: 'false', message: 'Anti-robot non configuré.' }, 500);
    }
    if (!token) {
      return json({ success: 'false', message: 'Veuillez compléter la vérification anti-robot.' }, 400);
    }
    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
    }).then((r) => r.json());

    if (!verify.success) {
      return json({ success: 'false', message: 'Vérification anti-robot échouée, réessayez.' }, 400);
    }

    // Relais vers FormSubmit (relais email vers la boîte du site)
    const res = await fetch(`https://formsubmit.co/ajax/${FORM_MAILTO}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    return json(
      { success: data.success === 'true' ? 'true' : 'false', message: data.message || 'Erreur du relais email.' },
      res.ok ? 200 : 502
    );
  } catch (err) {
    return json({ success: 'false', message: 'Erreur interne, réessayez dans un instant.' }, 500);
  }
}
