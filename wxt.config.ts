import { defineConfig } from 'wxt';
import { HOST_PERMISSIONS } from './src/hosts';

// Permissions are a public contract: adding a host or a permission with an install
// warning later makes Chrome disable the extension for every user until they
// approve it again. Keep this list as small as the features need.
export default defineConfig({
  srcDir: 'src',
  imports: false,
  modules: ['@wxt-dev/module-svelte'],
  targetBrowsers: ['chrome', 'firefox'],
  // WXT defaults Firefox to MV2.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    // Store policies: a third party's trademark only as "… for Reddit", never first.
    // The name carries the search words (stores rank on it); Firefox allows 50 characters.
    name:
      browser === 'firefox'
        ? 'Threadcrate for Reddit – Comment & Thread Exporter'
        : 'Threadcrate for Reddit: Export Threads, Comments & Subreddits',
    short_name: 'Threadcrate',
    description:
      'Save Reddit threads, subreddits past the 1000-post limit, profiles and searches as CSV, JSON and Markdown. Free and open source.',
    icons: {
      16: '/icons/icon-16.png',
      32: '/icons/icon-32.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
    // downloads: save the ZIP. storage: remember the export choices, and hand jobs to the
    // export tab. notifications: say when an export running in a background tab is done.
    permissions: ['downloads', 'notifications', 'storage'],
    host_permissions: HOST_PERMISSIONS,
    // AbortSignal.any.
    minimum_chrome_version: '116',
    action: { default_title: 'Threadcrate: export this Reddit page' },
    homepage_url: 'https://github.com/jasp-nerd/threadcrate',
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+E' },
        description: 'Export this Reddit page',
      },
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Never change: Firefox ties storage and the AMO listing to this id.
          id: 'threadcrate@jasp-nerd',
          // data_collection_permissions needs 140.
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
  zip: {
    includeSources: [
      'src/**',
      'public/**',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.json',
      'wxt.config.ts',
      'LICENSE',
      'README.md',
    ],
  },
});
