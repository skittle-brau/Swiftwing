/**
 * Upload image optimisation (sharp / libvips).
 *
 * Every uploaded image is:
 *  - checked by content, not by the browser-supplied MIME type
 *  - auto-rotated from EXIF orientation (Outlook ignores the EXIF flag)
 *  - stripped of metadata (camera details, GPS location)
 *  - converted to sRGB
 *  - downscaled to at most `maxWidth` px wide (never upscaled)
 *  - re-compressed: JPEG via mozjpeg, PNG losslessly at maximum compression
 *
 * WebP is converted to JPEG (or PNG when it has transparency) because
 * Outlook desktop cannot display WebP. Animated GIFs keep their animation.
 */
import sharp from 'sharp';

export const DEFAULT_MAX_WIDTH = 1200;
export const DEFAULT_JPEG_QUALITY = 82;

const FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: '.jpg' },
  png: { mime: 'image/png', ext: '.png' },
  gif: { mime: 'image/gif', ext: '.gif' },
};

export class ImageError extends Error {
  constructor(message, status = 415) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {Buffer} input
 * @param {{maxWidth?: number, jpegQuality?: number}} [opts]
 * @returns {Promise<{buffer: Buffer, mime: string, ext: string, width: number, height: number,
 *   original: {format: string, width: number, height: number, bytes: number}, resized: boolean, converted: boolean}>}
 */
export async function optimizeImage(input, { maxWidth = DEFAULT_MAX_WIDTH, jpegQuality = DEFAULT_JPEG_QUALITY } = {}) {
  let meta;
  try {
    meta = await sharp(input, { animated: true }).metadata();
  } catch {
    throw new ImageError('The file is not a readable image.');
  }
  if (!['jpeg', 'png', 'gif', 'webp'].includes(meta.format)) {
    throw new ImageError(`Unsupported image format "${meta.format}". Use PNG, JPG, GIF or WebP.`);
  }

  const animated = (meta.pages || 1) > 1;
  // For animated images metadata.height is the whole frame strip; pageHeight is one frame.
  const frameHeight = animated ? meta.pageHeight || meta.height : meta.height;
  // EXIF orientations 5–8 swap width and height once rotated.
  const rotated = (meta.orientation || 1) >= 5;
  const srcWidth = rotated ? frameHeight : meta.width;
  const srcHeight = rotated ? meta.width : frameHeight;
  const original = { format: meta.format, width: srcWidth, height: srcHeight, bytes: input.length };

  const resized = srcWidth > maxWidth;
  const outFormat = meta.format === 'webp' ? (meta.hasAlpha ? 'png' : 'jpeg') : meta.format;
  const converted = outFormat !== meta.format;

  // GIFs: re-encoding can grow them, so only touch them when they need shrinking.
  if (meta.format === 'gif' && !resized) {
    return { buffer: input, ...FORMATS.gif, width: srcWidth, height: srcHeight, original, resized: false, converted: false };
  }

  let pipeline = sharp(input, { animated: animated && outFormat === 'gif', limitInputPixels: 100_000_000 });
  if (!animated) pipeline = pipeline.rotate();
  if (resized) pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  pipeline = pipeline.toColorspace('srgb');

  if (outFormat === 'jpeg') {
    pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: jpegQuality, mozjpeg: true, progressive: true });
  } else if (outFormat === 'png') {
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  } else {
    pipeline = pipeline.gif({ effort: 7 });
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const height = animated ? info.pageHeight || info.height : info.height;

  // An already well-compressed PNG may come out larger: keep the original bytes
  // when nothing else changed (PNG has no EXIF rotation to apply).
  if (outFormat === 'png' && !resized && !converted && data.length >= input.length) {
    return { buffer: input, ...FORMATS.png, width: srcWidth, height: srcHeight, original, resized: false, converted: false };
  }

  return { buffer: data, ...FORMATS[outFormat], width: info.width, height, original, resized, converted };
}
