// Named font objects declared by <Font> elements in the UI's XML.
//
// GlueFonts.xml and FrameXML's Fonts.xml define these once (GameFontNormal,
// GlueFontHighlight, ...) and every FontString inherits from one rather than repeating
// the face, height and colour. Resolution follows the `inherits` chain, so a font that
// only overrides its colour still picks up its parent's face and height.

import XMLNode from './XMLNode';

export type FontColor = { r: number; g: number; b: number; a: number };

export type FontDefinition = {
  name: string;
  /** Game path to the TTF, e.g. `Fonts\FRIZQT__.TTF`. */
  font?: string;
  /** Height in UI pixels. */
  height?: number;
  color?: FontColor;
  shadowColor?: FontColor;
  shadowOffset?: { x: number; y: number };
  outline?: boolean;
  monochrome?: boolean;
  justifyH?: string;
  justifyV?: string;
};

const parseColor = (node: XMLNode): FontColor => ({
  r: Number(node.attributes.get('r') ?? 1),
  g: Number(node.attributes.get('g') ?? 1),
  b: Number(node.attributes.get('b') ?? 1),
  a: Number(node.attributes.get('a') ?? 1),
});

/** Reads the font attributes a <Font> or <FontString> node may carry. */
export const parseFontAttributes = (node: XMLNode): FontDefinition => {
  const definition: FontDefinition = { name: node.attributes.get('name') ?? '' };

  const font = node.attributes.get('font');
  if (font !== undefined) {
    definition.font = font;
  }

  const justifyH = node.attributes.get('justifyH');
  if (justifyH !== undefined) {
    definition.justifyH = justifyH.toUpperCase();
  }

  const justifyV = node.attributes.get('justifyV');
  if (justifyV !== undefined) {
    definition.justifyV = justifyV.toUpperCase();
  }

  const outline = node.attributes.get('outline');
  if (outline !== undefined) {
    definition.outline = outline.toUpperCase() !== 'NONE';
  }

  const monochrome = node.attributes.get('monochrome');
  if (monochrome !== undefined) {
    definition.monochrome = monochrome === 'true';
  }

  for (const child of node.children) {
    switch (child.name.toLowerCase()) {
      case 'fontheight': {
        for (const dimension of child.children) {
          const value = dimension.attributes.get('val');
          if (value !== undefined) {
            definition.height = Number(value);
          }
        }
        break;
      }
      case 'color':
        definition.color = parseColor(child);
        break;
      case 'shadowcolor':
        definition.shadowColor = parseColor(child);
        break;
      case 'shadowoffset': {
        for (const dimension of child.children) {
          definition.shadowOffset = {
            x: Number(dimension.attributes.get('x') ?? 0),
            y: Number(dimension.attributes.get('y') ?? 0),
          };
        }
        break;
      }
      default:
        break;
    }
  }

  return definition;
};

class FontRegistry {
  private readonly fonts = new Map<string, FontDefinition>();
  private readonly parents = new Map<string, string>();

  register(node: XMLNode): void {
    const name = node.attributes.get('name');
    if (name === undefined) {
      return;
    }

    this.fonts.set(name.toUpperCase(), parseFontAttributes(node));

    const inherits = node.attributes.get('inherits');
    if (inherits !== undefined) {
      this.parents.set(name.toUpperCase(), inherits.toUpperCase());
    }
  }

  /** Resolves a font name through its inheritance chain into one flat definition. */
  resolve(name: string | undefined): FontDefinition {
    const resolved: FontDefinition = { name: name ?? '' };
    if (name === undefined) {
      return resolved;
    }

    // Walk parents first so the most-derived definition wins, and guard against a
    // cycle in hand-written XML.
    const chain: FontDefinition[] = [];
    const seen = new Set<string>();
    let current: string | undefined = name.toUpperCase();

    while (current !== undefined && !seen.has(current)) {
      seen.add(current);
      const definition = this.fonts.get(current);
      if (definition) {
        chain.unshift(definition);
      }
      current = this.parents.get(current);
    }

    return chain.reduce<FontDefinition>((merged, definition) => ({ ...merged, ...definition }), resolved);
  }

  has(name: string): boolean {
    return this.fonts.has(name.toUpperCase());
  }
}

export default FontRegistry;
