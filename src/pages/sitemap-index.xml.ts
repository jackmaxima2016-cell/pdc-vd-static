// Index de sitemap (référencé par <head> et robots.txt) — pointe vers sitemap.xml
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = String(site ?? 'https://pdc-vd.ch').replace(/\/$/, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemap.xml</loc></sitemap>
</sitemapindex>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
