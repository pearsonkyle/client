import { Blp, BLP_IMAGE_FORMAT } from '@wowserhq/format';

import fetch from '../utils/fetch';

/**
 * A texture loaded from the game's own data.
 *
 * WoW ships textures as BLP, which no browser understands, so they are decoded here into
 * raw RGBA. BLP's ABGR8888 is byte-order RGBA on a little-endian machine, which is
 * exactly what `texImage2D` wants, so no channel shuffling is needed.
 *
 * Loading is asynchronous while rendering is not, so `isLoaded` starts false and the
 * texture simply renders as nothing until the bytes arrive.
 */
class Texture {
  readonly path: string;
  isLoaded = false;
  image: ImageData;
  error: Error | null = null;

  constructor(path: string | null = null) {
    this.path = path ?? '';
    // A 1x1 transparent placeholder keeps the renderer's `image.width` access safe
    // before the real data lands.
    this.image = new ImageData(1, 1);

    if (path !== null) {
      void this.load();
    }
  }

  /**
   * Supplies pixels directly, for textures that are generated rather than loaded -
   * rasterised text, mainly.
   *
   * The renderer keys its GPU upload on image identity, so replacing this triggers
   * exactly one re-upload.
   */
  setImage(image: ImageData): void {
    this.image = image;
    this.isLoaded = true;
  }

  get width(): number {
    return this.image.width;
  }

  get height(): number {
    return this.image.height;
  }

  private async load(): Promise<void> {
    try {
      const buffer = await fetch(this.path, 'arrayBuffer');
      const blp = new Blp().load(buffer);
      const decoded = blp.getImage(0, BLP_IMAGE_FORMAT.IMAGE_ABGR8888);

      // Copy rather than wrap: ImageData requires a plain ArrayBuffer-backed clamped
      // array, and decoded.data may be a view into a larger buffer.
      const pixels = new Uint8ClampedArray(decoded.data.length);
      pixels.set(decoded.data);

      this.image = new ImageData(pixels, decoded.width, decoded.height);
      this.isLoaded = true;
    } catch (error) {
      this.error = error as Error;
      console.warn(`texture: could not load ${this.path}: ${(error as Error).message}`);
    }
  }
}

export default Texture;
