// Sitemap complet — mêmes URLs que le site WordPress (146) : home, pagination, pages, articles
import type { APIRoute } from 'astro';
import { getPosts, getPages, PAGE_SIZE } from '../lib/wp.mjs';

export const GET: APIRoute = ({ site }) => {
  const base = String(site ?? 'https://pdc-vd.ch').replace(/\/$/, '');
  const posts = getPosts();
  const pages = getPages();
  const total = Math.ceil(posts.length / PAGE_SIZE);

  const urls = ['', '/contact/', '/plan-du-site/', '/mentions-legales/', '/confidentialite/', '/cgv/'];
  for (let i = 2; i <= total; i++) urls.push(`/page/${i}/`);
  for (const p of pages) urls.push(`/${p.slug}/`);
  for (const p of posts) urls.push(`/${p.slug}/`);

  const bySlug = new Map(posts.map((p) => [p.slug, p.date?.slice(0, 10)]));
  const lastmod = posts[0]?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const modOf = (u) => bySlug.get(u.replace(/^\//, '').replace(/\/$/, '')) ?? lastmod;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u}</loc><lastmod>${modOf(u)}</lastmod></url>`).join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
