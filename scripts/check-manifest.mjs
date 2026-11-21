// Fails when a build could disable the extension for existing users, or quietly
// change what the stores were told.
//
// Chrome disables an extension on update when the update adds a permission that
// shows an install warning, until each user re-approves it. So:
//  1. Required host access (host_permissions and content-script matches) never
//     grows beyond what 0.1.0, the first store release, asks for.
//  2. A required API permission that 0.1.0 didn't have must be on NO_WARNING.
//  3. Everything permission-related, plus Firefox's gecko id and data-collection
//     declaration, must equal scripts/manifest.snapshot.json, so even an allowed
//     change is a deliberate, reviewed edit of that file (and of the store
//     listings in docs/store/ and PRIVACY.md).
//
// The Edge package is the Chrome build (see release.yml), so chrome-mv3 covers both.
//
// Usage: node scripts/check-manifest.mjs [--update]   (after `pnpm build && pnpm build:firefox`)
import { readFileSync, writeFileSync } from 'node:fs';

const TARGETS = ['chrome-mv3', 'firefox-mv3'];
const SNAPSHOT = 'scripts/manifest.snapshot.json';

// Permissions Chrome grants without an install warning, checked against
// https://developer.chrome.com/docs/extensions/reference/permissions-list
// Add an entry only after checking that page.
const NO_WARNING = new Set(['alarms', 'offscreen', 'unlimitedStorage']);

// What 0.1.0 asks for. Required access beyond this would disable the extension
// for existing users on update.
const baseline = {
  permissions: ['downloads', 'notifications', 'storage'],
  host_permissions: ['https://www.reddit.com/*', 'https://*.redd.it/*', 'https://i.imgur.com/*'],
  content_script_matches: [
    'https://www.reddit.com/*',
    'https://old.reddit.com/*',
    'https://new.reddit.com/*',
    'https://sh.reddit.com/*',
  ],
};
const sorted = (list = []) => [...new Set(list)].sort();

function summarize(manifest) {
  const gecko = manifest.browser_specific_settings?.gecko;
  return {
    manifest_version: manifest.manifest_version,
    permissions: sorted(manifest.permissions),
    host_permissions: sorted(manifest.host_permissions),
    optional_permissions: sorted(manifest.optional_permissions),
    optional_host_permissions: sorted(manifest.optional_host_permissions),
    content_script_matches: sorted((manifest.content_scripts ?? []).flatMap((c) => c.matches)),
    gecko_id: gecko?.id ?? null,
    // AMO policy: this must say what the add-on really transmits.
    data_collection: gecko?.data_collection_permissions ?? null,
  };
}

const actual = Object.fromEntries(
  TARGETS.map((t) => [
    t,
    summarize(JSON.parse(readFileSync(`.output/${t}/manifest.json`, 'utf8'))),
  ]),
);

const errors = [];
for (const [target, m] of Object.entries(actual)) {
  if (m.manifest_version !== 3)
    errors.push(`${target}: manifest_version is ${m.manifest_version}, not 3`);
  for (const host of [...m.host_permissions, ...m.content_script_matches]) {
    if (
      !baseline.host_permissions.includes(host) &&
      !baseline.content_script_matches.includes(host)
    ) {
      errors.push(
        `${target}: required host access "${host}" is new; make it optional_host_permissions`,
      );
    }
  }
  for (const perm of m.permissions) {
    if (!baseline.permissions.includes(perm) && !NO_WARNING.has(perm)) {
      errors.push(`${target}: required permission "${perm}" is new and not on NO_WARNING`);
    }
  }
}

if (process.argv.includes('--update')) {
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  // Formatted like the rest of the repo, so Prettier's check in `pnpm lint` passes.
  const prettier = await import('prettier');
  const config = (await prettier.resolveConfig(SNAPSHOT)) ?? {};
  writeFileSync(
    SNAPSHOT,
    await prettier.format(JSON.stringify(actual), { ...config, parser: 'json' }),
  );
  console.log(`Wrote ${SNAPSHOT}`);
  process.exit(0);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
for (const target of TARGETS) {
  const expected = JSON.stringify(snapshot[target], null, 2);
  const got = JSON.stringify(actual[target], null, 2);
  if (expected !== got)
    errors.push(`${target}: differs from ${SNAPSHOT}\nexpected ${expected}\nactual   ${got}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Manifest permissions OK for ${TARGETS.join(', ')}`);
