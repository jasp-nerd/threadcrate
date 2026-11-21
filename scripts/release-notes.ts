// Prints the CHANGELOG.md section for one version, for the GitHub release and the AMO notes.
// Usage: node scripts/release-notes.ts 0.2.0 > notes.md (Node 24 runs TypeScript directly)
//        node scripts/release-notes.ts 0.2.0 --amo > amo.json   (FIREFOX_AMO_METADATA_FILE for wxt submit)
// Fails when the section is missing or still says "unreleased", so no release ships without notes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The text under "## <version> (...)" up to the next "## ", without the heading. */
export function notesFor(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`);
  if (start === -1) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  if (/unreleased/i.test(lines[start] ?? ''))
    throw new Error(`CHANGELOG.md still calls ${version} unreleased`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

const REPO = 'https://github.com/jasp-nerd/threadcrate';

/**
 * Store pages, filled in once each listing exists (docs/releasing.md, first launch).
 * A store left empty is left out of the release notes.
 */
const STORES: { name: string; url: string; note: string }[] = [
  // { name: 'Chrome Web Store', url: 'https://chromewebstore.google.com/detail/<item id>', note: 'also Brave, Opera and other Chromium browsers' },
  // { name: 'Edge Add-ons', url: 'https://microsoftedge.microsoft.com/addons/detail/<crx id>', note: '' },
  // { name: 'Firefox Add-ons', url: 'https://addons.mozilla.org/firefox/addon/threadcrate/', note: '' },
];

/** The top of a GitHub release: where to install it, and which file is which. */
export function installFor(version: string): string {
  const file = (browser: string) =>
    `[threadcrate-${browser}.zip](${REPO}/releases/download/v${version}/threadcrate-${browser}.zip)`;
  const stores = STORES.map((s) => `[${s.name}](${s.url})${s.note ? ` (${s.note})` : ''}`);
  return [
    ...(stores.length
      ? [
          `**Install from a store** to get updates by themselves: ${stores.join(', ')}. A store can take a few days to show a new version.`,
          '',
        ]
      : []),
    '| File | For |',
    '| --- | --- |',
    `| ${file('chrome')} | Chrome, Brave, Opera and other Chromium browsers |`,
    `| ${file('edge')} | Edge (the same build as Chrome) |`,
    `| ${file('firefox')} | Firefox 140 or later |`,
    `| ${file('sources')} | The source code, as the stores' reviewers build it (SOURCE_CODE_REVIEW.md) |`,
    '| SHA256SUMS.txt | Checksums of the zips |',
    '',
    "To load a zip by hand: unzip it, then use Load unpacked on chrome://extensions or edge://extensions (turn on Developer mode first). A copy loaded by hand doesn't update itself, and its settings don't carry over to the store version. Firefox only keeps an unsigned zip until it restarts (about:debugging), so use Firefox Add-ons there.",
  ].join('\n');
}

/** Per-version metadata for AMO: the release notes, and the notes to reviewers. */
export function amoVersionMetadata(notes: string, reviewerNotes: string): object {
  // AMO shows release notes as plain text with a little HTML, so drop Markdown emphasis and code marks.
  const plain = notes.replace(/\*\*|`/g, '');
  return { version: { release_notes: { 'en-US': plain }, approval_notes: reviewerNotes.trim() } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) throw new Error('Usage: node scripts/release-notes.ts <version> [--amo]');
  const notes = notesFor(readFileSync('CHANGELOG.md', 'utf8'), version);
  if (process.argv.includes('--amo')) {
    const reviewer = readFileSync('docs/store/reviewer-notes.txt', 'utf8');
    process.stdout.write(JSON.stringify(amoVersionMetadata(notes, reviewer), null, 2) + '\n');
  } else {
    process.stdout.write(`${installFor(version)}\n\n## What's new\n\n${notes}\n`);
  }
}
