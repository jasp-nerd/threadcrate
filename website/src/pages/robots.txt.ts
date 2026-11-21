import type { APIRoute } from 'astro';

// Everything may be crawled.
export const GET: APIRoute = ({ site }) =>
  new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${new URL(`${import.meta.env.BASE_URL}sitemap.xml`, site)}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
