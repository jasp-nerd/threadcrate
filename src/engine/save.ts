import { downloadZip } from 'client-zip';
import { browser } from 'wxt/browser';
import type { PackageFile } from '../export/package';

/** A path inside the ZIP that can't climb out of the folder it's unpacked into. */
function zipPath(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment === '' || segment === '.' || segment === '..' ? '_' : segment))
    .join('/');
}

/** Packs the files into a ZIP and hands it to the browser's downloads. Returns the download id. */
export async function saveZip(files: PackageFile[], name: string, when: Date): Promise<number> {
  const blob = await downloadZip(
    files.map((f) => ({
      name: zipPath(f.path),
      input: f.data,
      lastModified: f.lastModified ?? when,
    })),
  ).blob();
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/zip' }));

  // The browser reads the blob while downloading; free it once that's over. The
  // listener goes up first: a small download can finish before download() returns.
  let id: number | null = null;
  const finished = new Set<number>();
  const release = () => {
    URL.revokeObjectURL(url);
    browser.downloads.onChanged.removeListener(onChanged);
  };
  const onChanged = (delta: { id: number; state?: { current?: string } }) => {
    if (!delta.state?.current || delta.state.current === 'in_progress') return;
    if (id === null) finished.add(delta.id);
    else if (delta.id === id) release();
  };
  browser.downloads.onChanged.addListener(onChanged);
  try {
    id = await browser.downloads.download({
      url,
      filename: `${name}.zip`,
      conflictAction: 'uniquify',
    });
    if (finished.has(id)) release();
    return id;
  } catch (error) {
    release();
    throw error;
  }
}
