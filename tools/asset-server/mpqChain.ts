// Read-only access to a WoW client's MPQ chain.
//
// StormLib (via the stormjs WASM build) applies patch archives in order, so opening the
// chain the way the real client does gives us the same view of every file - including
// files that only exist in a patch, and patched-over versions of files in the base
// archives.

import path from 'node:path';

export const LOCALES = ['enUS', 'enGB', 'deDE', 'esES', 'esMX', 'frFR', 'itIT', 'koKR', 'ptBR', 'ruRU', 'zhCN', 'zhTW'];

/**
 * The patch chain, in the order the client applies it. Later archives win.
 *
 * Ordering matters: `patch-3.MPQ` last is what makes this a 3.3.5a view of the data.
 */
export const chainFor = (locale: string): string[] => [
  'common.MPQ',
  'common-2.MPQ',
  'expansion.MPQ',
  'lichking.MPQ',
  `${locale}/locale-${locale}.MPQ`,
  `${locale}/speech-${locale}.MPQ`,
  `${locale}/expansion-locale-${locale}.MPQ`,
  `${locale}/lichking-locale-${locale}.MPQ`,
  `${locale}/expansion-speech-${locale}.MPQ`,
  `${locale}/lichking-speech-${locale}.MPQ`,
  `${locale}/patch-${locale}.MPQ`,
  `${locale}/patch-${locale}-2.MPQ`,
  `${locale}/patch-${locale}-3.MPQ`,
  'patch.MPQ',
  'patch-2.MPQ',
  'patch-3.MPQ',
];

/**
 * Normalises a URL path into the form StormLib expects.
 *
 * WoW paths are backslash-separated and case-insensitive; MPQ hashing uppercases before
 * hashing, so case needs no special handling here - only the separators do.
 */
export const toMpqPath = (urlPath: string): string =>
  decodeURIComponent(urlPath).replace(/^\/+/, '').replace(/\//g, '\\');

export type MpqChain = {
  has(mpqPath: string): boolean;
  read(mpqPath: string): Uint8Array | null;
  search(mask: string, limit: number): string[];
  close(): void;
  archives: string[];
};

export const openChain = async (clientDir: string, locale: string): Promise<MpqChain> => {
  // stormjs ships a 2020 Emscripten build. It loads fine on Node 24, but it is a CommonJS
  // interop import, so pull it in dynamically to keep the module graph honest.
  const { FS, MPQ } = await import('@wowserhq/stormjs');

  const dataDir = path.resolve(clientDir, 'Data');

  // Emscripten's virtual FS is the only way the WASM side can see real files.
  const MOUNT = '/wow';
  try {
    FS.mkdir(MOUNT);
  } catch {
    // Already mounted by an earlier call in the same process.
  }
  FS.mount(FS.filesystems.NODEFS, { root: dataDir }, MOUNT);

  const chain = chainFor(locale);
  const [base, ...patches] = chain;
  if (base === undefined) {
    throw new Error('empty MPQ chain');
  }

  const mpq = await MPQ.open(`${MOUNT}/${base}`, 'r');
  const applied: string[] = [base];
  for (const patch of patches) {
    try {
      mpq.patch(`${MOUNT}/${patch}`, '');
      applied.push(patch);
    } catch (error) {
      // A locale without speech archives, or a client missing an optional patch, should
      // degrade rather than refuse to start.
      console.warn(`  skipped ${patch}: ${(error as Error).message}`);
    }
  }

  return {
    archives: applied,

    has(mpqPath: string): boolean {
      try {
        return mpq.hasFile(mpqPath);
      } catch {
        return false;
      }
    },

    read(mpqPath: string): Uint8Array | null {
      let file;
      try {
        file = mpq.openFile(mpqPath);
      } catch {
        return null;
      }
      try {
        return new Uint8Array(file.read());
      } finally {
        file.close();
      }
    },

    search(mask: string, limit: number): string[] {
      const results: string[] = [];
      try {
        for (const found of mpq.search(mask)) {
          results.push(found.fileName);
          if (results.length >= limit) {
            break;
          }
        }
      } catch {
        // An archive with no (listfile) cannot be searched.
      }
      return results;
    },

    close(): void {
      mpq.close();
    },
  };
};
