// Loads the game's own TrueType fonts into the browser.
//
// WoW ships FRIZQT__.TTF and friends inside the MPQs; the asset server hands them over
// unchanged, and the FontFace API lets the canvas rasteriser use them directly. That
// keeps the UI's typography authentic instead of substituting a system font.

import { assetUrl } from '../../config';

const FALLBACK = 'system-ui, sans-serif';

const loaded = new Map<string, Promise<string>>();

/** Turns a game font path into a CSS font-family name. */
const familyFor = (path: string): string =>
  `wow-${path.replace(/\\/g, '/').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

/**
 * Registers a game font, returning the family name to use in a canvas `font` string.
 *
 * Resolves to the fallback stack if the font cannot be loaded, so text still renders.
 */
export const loadGameFont = (path: string): Promise<string> => {
  const existing = loaded.get(path);
  if (existing) {
    return existing;
  }

  const family = familyFor(path);
  const pending = (async () => {
    try {
      const face = new FontFace(family, `url("${assetUrl(path)}")`);
      await face.load();
      document.fonts.add(face);
      return family;
    } catch (error) {
      console.warn(`fonts: could not load ${path}: ${(error as Error).message}`);
      return FALLBACK;
    }
  })();

  loaded.set(path, pending);
  return pending;
};

/**
 * The family for a font path if it is already loaded, otherwise the fallback - and
 * kicks off the load so the next frame can use the real thing.
 *
 * Rasterising happens synchronously during layout, so it cannot wait on a font load.
 */
const ready = new Map<string, string>();

export const familyForNow = (path: string): string => {
  const family = ready.get(path);
  if (family !== undefined) {
    return family;
  }
  void loadGameFont(path).then((resolved) => ready.set(path, resolved));
  return FALLBACK;
};
