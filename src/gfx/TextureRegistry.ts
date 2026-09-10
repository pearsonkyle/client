import { HashMap, HashStrategy } from '../utils';

import Texture from './Texture';

class TextureRegistry extends HashMap<string, Texture> {
  constructor() {
    super(HashStrategy.UPPERCASE);
  }

  lookup(path: string) {
    // The UI's XML omits the extension about as often as it includes it, and TGA paths
    // in 3.3.5 data are really BLP files.
    const normalized = `${path.replace(/\.(blp|tga)$/i, '')}.blp`;
    let texture = this.get(normalized);
    if (!texture) {
      texture = new Texture(normalized);
      this.set(normalized, texture);
    }
    return texture;
  }
}

export default TextureRegistry;
