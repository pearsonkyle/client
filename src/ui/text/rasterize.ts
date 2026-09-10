// Rasterises a string into pixels for the UI to draw as a textured quad.
//
// The frame engine has no glyph pipeline, and building one (atlas, kerning, shaping)
// is a large job. The browser already has a good one behind canvas 2D, so text is
// drawn there and uploaded as a texture. Each FontString keeps its own bitmap and only
// re-rasterises when its text, font or colour changes.

export type TextStyle = {
  family: string;
  /** Font height in UI pixels, as the XML declares it. */
  height: number;
  color: { r: number; g: number; b: number; a: number };
  outline: boolean;
  shadow: { r: number; g: number; b: number; a: number; x: number; y: number } | null;
  /** Extra device pixels per UI pixel, so text stays sharp on larger viewports. */
  scale: number;
};

export type RasterizedText = {
  image: ImageData;
  /** Size of the text in UI pixels - what layout needs, independent of `scale`. */
  width: number;
  height: number;
};

let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;

const contextFor = (width: number, height: number): CanvasRenderingContext2D => {
  if (!canvas) {
    canvas = document.createElement('canvas');
    context = canvas.getContext('2d', { willReadFrequently: true });
  }
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return context!;
};

const css = ({ r, g, b, a }: { r: number; g: number; b: number; a: number }): string =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;

const fontString = (style: TextStyle): string =>
  `${style.height * style.scale}px "${style.family}", system-ui, sans-serif`;

/** Measures a string without rasterising it, in UI pixels. */
export const measureText = (text: string, style: TextStyle): { width: number; height: number } => {
  const ctx = contextFor(1, 1);
  ctx.font = fontString(style);
  const metrics = ctx.measureText(text);
  return {
    width: metrics.width / style.scale,
    // Line height a little above the em box, matching how the game spaces text.
    height: style.height * 1.25,
  };
};

export const rasterizeText = (text: string, style: TextStyle): RasterizedText | null => {
  if (text.length === 0) {
    return null;
  }

  const { scale } = style;
  const probe = contextFor(1, 1);
  probe.font = fontString(style);
  const metrics = probe.measureText(text);

  // Ascent and descent vary per font and per string; ask rather than assume, so
  // descenders and accents are not clipped.
  const ascent = metrics.actualBoundingBoxAscent || style.height * scale * 0.8;
  const descent = metrics.actualBoundingBoxDescent || style.height * scale * 0.25;

  const padding = Math.ceil(2 * scale + (style.outline ? 2 * scale : 0));
  const width = Math.ceil(metrics.width) + padding * 2;
  const height = Math.ceil(ascent + descent) + padding * 2;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const ctx = contextFor(width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.font = fontString(style);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const x = padding;
  const y = padding + ascent;

  if (style.shadow) {
    ctx.fillStyle = css(style.shadow);
    ctx.fillText(text, x + style.shadow.x * scale, y - style.shadow.y * scale);
  }

  if (style.outline) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = 2 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }

  ctx.fillStyle = css(style.color);
  ctx.fillText(text, x, y);

  return {
    image: ctx.getImageData(0, 0, width, height),
    width: width / scale,
    height: height / scale,
  };
};

/**
 * Strips WoW's inline colour escapes (|cAARRGGBB ... |r) and other pipe codes.
 *
 * Per-run colouring would need one quad per run; until then, showing the text without
 * the markup beats showing the markup.
 */
export const stripEscapes = (text: string): string =>
  text
    .replace(/\|c[0-9a-fA-F]{8}/g, '')
    .replace(/\|r/g, '')
    .replace(/\|T.-?\|t/g, '')
    .replace(/\|H.-?\|h/g, '')
    .replace(/\|h/g, '')
    .replace(/\|n/g, '\n');
