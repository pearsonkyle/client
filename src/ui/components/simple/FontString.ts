import Device from '../../../gfx/Device';
import GfxTexture from '../../../gfx/Texture';
import RenderBatch from '../../rendering/RenderBatch';
import Screen from '../../../gfx/Screen';
import Shader from '../../../gfx/Shader';
import UIContext from '../../UIContext';
import WebGL2Device from '../../../gfx/apis/webgl2/WebGL2Device';
import XMLNode from '../../XMLNode';
import { BlendMode } from '../../../gfx/types';
import { FontColor, parseFontAttributes } from '../../FontRegistry';
import { Status, maxAspectCompensation, DDCtoNDCWidth, NDCtoDDCWidth } from '../../../utils';
import { Vector2, Vector3 } from '../../../math';
import { familyForNow } from '../../text/fonts';
import { rasterizeText, stripEscapes, TextStyle } from '../../text/rasterize';

import Region from './Region';
import TextureImageMode from './TextureImageMode';
import Texture, { TextureCoords, TexturePosition } from './Texture';

import * as scriptFunctions from './FontString.script';

const DEFAULT_FONT = 'Fonts\\FRIZQT__.TTF';
const DEFAULT_HEIGHT = 12;
const DEFAULT_COLOR: FontColor = { r: 1, g: 0.82, b: 0, a: 1 };

/** UI pixels to the layout engine's internal units, matching SetWidth/SetHeight. */
const uiPixelsToUnits = (pixels: number): number => NDCtoDDCWidth(pixels / maxAspectCompensation);
const unitsToUiPixels = (units: number): number => maxAspectCompensation * DDCtoNDCWidth(units);

// TODO: Multi inherit from both Region and Fontable
class FontString extends Region {
  static get scriptFunctions() {
    return {
      ...super.scriptFunctions,
      ...scriptFunctions,
    };
  }

  text = '';
  fontPath = DEFAULT_FONT;
  fontHeight = DEFAULT_HEIGHT;
  color: FontColor = { ...DEFAULT_COLOR };
  shadowColor: FontColor | null = null;
  shadowOffset = { x: 0, y: 0 };
  outline = false;
  justifyH = 'CENTER';
  justifyV = 'MIDDLE';

  /** Rasterised text, uploaded by the renderer like any other texture. */
  readonly texture = new GfxTexture(null);
  blendMode = BlendMode.Alpha;
  shader: Shader;
  position: TexturePosition = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  textureCoords: TextureCoords = [
    new Vector2([0, 0]),
    new Vector2([0, 1]),
    new Vector2([1, 0]),
    new Vector2([1, 1]),
  ];

  private rasterizedFor: string | null = null;
  private textWidth = 0;
  private textHeight = 0;

  constructor(...args: ConstructorParameters<typeof Region>) {
    super(...args);

    this.shader = (Device.instance as WebGL2Device).shaders.pixelShaderFor(TextureImageMode.UI);
  }

  private applyFont(definition: ReturnType<typeof parseFontAttributes>): void {
    if (definition.font !== undefined) {
      this.fontPath = definition.font;
    }
    if (definition.height !== undefined) {
      this.fontHeight = definition.height;
    }
    if (definition.color !== undefined) {
      this.color = definition.color;
    }
    if (definition.shadowColor !== undefined) {
      this.shadowColor = definition.shadowColor;
    }
    if (definition.shadowOffset !== undefined) {
      this.shadowOffset = definition.shadowOffset;
    }
    if (definition.outline !== undefined) {
      this.outline = definition.outline;
    }
    if (definition.justifyH !== undefined) {
      this.justifyH = definition.justifyH;
    }
    if (definition.justifyV !== undefined) {
      this.justifyV = definition.justifyV;
    }
  }

  loadXML(node: XMLNode, status: Status) {
    const inherits = node.attributes.get('inherits');

    // `inherits` on a FontString names either a virtual FontString template or a
    // named Font object; the two live in different registries.
    if (inherits !== undefined) {
      const template = UIContext.instance.templates.get(inherits);
      if (template) {
        if (template.locked) {
          status.warning(`recursively inherited node: ${inherits}`);
        } else {
          template.lock();
          this.loadXML(template.node, status);
          template.release();
        }
      } else if (UIContext.instance.fonts.has(inherits)) {
        this.applyFont(UIContext.instance.fonts.resolve(inherits));
      } else {
        status.warning(`could not find inherited node: ${inherits}`);
      }
    }

    super.loadXML(node, status);

    // Attributes on the FontString itself override anything inherited.
    this.applyFont(parseFontAttributes(node));

    const text = node.attributes.get('text');
    if (text !== undefined) {
      // The attribute is usually a GlueStrings key rather than literal text.
      this.setText(UIContext.instance.scripting.globalString(text) ?? text);
    }
  }

  postLoadXML(_node: XMLNode) {
    this.markDirty();
  }

  setText(text: string): void {
    const next = text ?? '';
    if (next !== this.text) {
      this.text = next;
      this.markDirty();
    }
  }

  setFont(path: string, height: number, flags: string): void {
    this.fontPath = path;
    this.fontHeight = height;
    this.outline = flags.toUpperCase().includes('OUTLINE');
    this.markDirty();
  }

  /** Adopts a named font object, e.g. GameFontNormal. */
  applyFontObject(name: string): void {
    if (UIContext.instance.fonts.has(name)) {
      this.applyFont(UIContext.instance.fonts.resolve(name));
      this.markDirty();
    }
  }

  setTextColor(r: number, g: number, b: number, a = 1): void {
    this.color = { r, g, b, a };
    this.markDirty();
  }

  private markDirty(): void {
    this.rasterizedFor = null;
  }

  // The layout engine cannot place a region with no size, and a FontString's size comes
  // from its text - so report the rasterised extents, exactly as Texture reports its
  // image's. Without this getRect() never becomes valid and nothing draws.
  get width(): number {
    const layoutWidth = super.width;
    if (layoutWidth !== 0.0) {
      return layoutWidth;
    }
    return this.rasterize() ? uiPixelsToUnits(this.textWidth) : 0.0;
  }

  set width(width: number) {
    super.width = width;
  }

  get height(): number {
    const layoutHeight = super.height;
    if (layoutHeight !== 0.0) {
      return layoutHeight;
    }
    return this.rasterize() ? uiPixelsToUnits(this.textHeight) : 0.0;
  }

  set height(height: number) {
    super.height = height;
  }

  /** Text size in UI pixels, for GetStringWidth and for layout. */
  get stringWidth(): number {
    this.rasterize();
    return this.textWidth;
  }

  get stringHeight(): number {
    this.rasterize();
    return this.textHeight;
  }

  private style(): TextStyle {
    // Rasterise at the viewport's real pixel density so text is not blurry on a large
    // window; the UI is authored against a 1024-wide reference.
    const canvas = Screen.instance?.canvas;
    const scale = Math.min(4, Math.max(1, (canvas?.width ?? 1024) / 1024));

    return {
      family: familyForNow(this.fontPath),
      height: this.fontHeight,
      color: this.color,
      outline: this.outline,
      shadow:
        this.shadowColor && (this.shadowOffset.x !== 0 || this.shadowOffset.y !== 0)
          ? { ...this.shadowColor, x: this.shadowOffset.x, y: this.shadowOffset.y }
          : null,
      scale,
    };
  }

  private rasterize(): boolean {
    const stripped = stripEscapes(this.text);
    const style = this.style();
    // The resolved family is part of the key, so a string first drawn with the fallback
    // face re-rasterises by itself once the game's TTF finishes downloading - no
    // per-FontString subscription to leak.
    const key = `${stripped}|${style.family}|${this.fontHeight}|${this.outline}|${
      this.color.r},${this.color.g},${this.color.b},${this.color.a}`;

    if (this.rasterizedFor === key) {
      return this.texture.isLoaded;
    }

    const rasterized = rasterizeText(stripped, style);
    this.rasterizedFor = key;

    if (!rasterized) {
      this.textWidth = 0;
      this.textHeight = 0;
      this.texture.isLoaded = false;
      return false;
    }

    this.texture.setImage(rasterized.image);
    this.textWidth = rasterized.width;
    this.textHeight = rasterized.height;
    return true;
  }

  draw(batch: RenderBatch) {
    if (this.text.length === 0 || !this.rasterize()) {
      return;
    }

    const rect = this.getRect();
    if (!rect) {
      return;
    }

    const width = uiPixelsToUnits(this.textWidth);
    const height = uiPixelsToUnits(this.textHeight);

    // Justify within the region the layout engine gave us, rather than filling it: a
    // stretched glyph bitmap looks worse than a correctly placed one.
    const slack = (rect.maxX - rect.minX) - width;
    let minX = rect.minX;
    if (this.justifyH === 'CENTER') {
      minX += slack / 2;
    } else if (this.justifyH === 'RIGHT') {
      minX += slack;
    }

    const verticalSlack = (rect.maxY - rect.minY) - height;
    let minY = rect.minY;
    if (this.justifyV === 'MIDDLE') {
      minY += verticalSlack / 2;
    } else if (this.justifyV === 'TOP') {
      minY += verticalSlack;
    }

    const maxX = minX + width;
    const maxY = minY + height;

    this.position[0].setElements(minX, maxY, this.layoutDepth);
    this.position[1].setElements(minX, minY, this.layoutDepth);
    this.position[2].setElements(maxX, maxY, this.layoutDepth);
    this.position[3].setElements(maxX, minY, this.layoutDepth);

    batch.queue(
      this.texture,
      this.blendMode,
      this.position,
      this.textureCoords,
      this.colors,
      Texture.indices,
      this.shader,
    );
  }
}

export { unitsToUiPixels };
export default FontString;
