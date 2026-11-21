import { defineConfig, passthroughImageService } from 'astro/config';

// One canonical origin with trailing slashes; SITE_URL and BASE_PATH let the same build
// run on another address (a preview, a fork) without changing the code.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://threadcrate.jaspnerd.dev',
  base: process.env.BASE_PATH ?? '/',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // Images are encoded ahead of time (scripts/encode-shots.sh), so no image library is needed.
  image: { service: passthroughImageService() },
  vite: {
    // The site reads the extension's logo, theme, fonts, Kip and documents from the repo root.
    server: { fs: { allow: ['..'] } },
  },
});
