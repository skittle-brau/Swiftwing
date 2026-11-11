/**
 * Video blocks: turn a YouTube or Vimeo link into a thumbnail image with a
 * play button drawn into it. Email clients can't play video or reliably
 * overlay one image on another, so the button is part of the picture and the
 * whole image links to the video.
 *
 * Only fixed YouTube/Vimeo hosts are ever fetched (no user-controlled URLs),
 * over HTTPS, with a timeout and a size cap.
 */
import sharp from 'sharp';

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_FETCH_HOSTS = new Set(['www.youtube.com', 'i.ytimg.com', 'vimeo.com', 'i.vimeocdn.com']);

export class VideoError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * @returns {{provider: 'youtube'|'vimeo', id: string, url: string} | null}
 */
export function parseVideoUrl(input) {
  let u;
  try {
    const raw = String(input ?? '').trim();
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id = null;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) id = parts[1];
    if (!id || !YT_ID.test(id)) return null;
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    const time = t && /^\d+s?$/.test(t) ? `&t=${parseInt(t, 10)}` : '';
    const url = parts[0] === 'shorts' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}${time}`;
    return { provider: 'youtube', id, url };
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // vimeo.com/123, vimeo.com/123/abcdef (unlisted), player.vimeo.com/video/123?h=abcdef,
    // vimeo.com/channels/x/123, vimeo.com/groups/x/videos/123, vimeo.com/showcase/x/video/123
    const idx = parts.findIndex((p) => /^\d{5,12}$/.test(p));
    if (idx < 0) return null;
    const id = parts[idx];
    const hash = (/^[0-9a-f]{6,20}$/i.test(parts[idx + 1] || '') && parts[idx + 1]) || u.searchParams.get('h') || '';
    if (hash && !/^[0-9a-f]{6,20}$/i.test(hash)) return null;
    return { provider: 'vimeo', id, url: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}` };
  }
  return null;
}

async function fetchLimited(fetchImpl, url, { as = 'buffer' } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !ALLOWED_FETCH_HOSTS.has(target.hostname)) {
    throw new VideoError('Refusing to fetch from an unexpected host.', 502);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(target.href, { signal: ctrl.signal, redirect: 'error', headers: { 'user-agent': 'Swiftwing/1.0' } });
    if (!res.ok) return { ok: false, status: res.status };
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new VideoError('Thumbnail is too large.', 502);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new VideoError('Thumbnail is too large.', 502);
    return { ok: true, status: res.status, body: as === 'json' ? JSON.parse(buf.toString('utf8')) : buf };
  } catch (err) {
    if (err instanceof VideoError) throw err;
    throw new VideoError(`Couldn't reach the video site (${err.name === 'AbortError' ? 'timed out' : err.message}).`, 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the best thumbnail and the title for a parsed video. */
export async function fetchVideoInfo(video, fetchImpl = fetch) {
  if (video.provider === 'youtube') {
    let title = '';
    const meta = await fetchLimited(fetchImpl, `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(video.url)}`, { as: 'json' }).catch(() => null);
    if (meta?.ok) title = String(meta.body.title || '');
    else if (meta && [401, 403, 404].includes(meta.status)) {
      throw new VideoError('YouTube says this video is private, removed or not embeddable.', 404);
    }
    // maxresdefault (1280×720) only exists for HD videos; the others are 4:3 with black bars.
    for (const [name, letterboxed] of [['maxresdefault', false], ['sddefault', true], ['hqdefault', true]]) {
      const img = await fetchLimited(fetchImpl, `https://i.ytimg.com/vi/${video.id}/${name}.jpg`);
      if (img.ok) return { title, image: img.body, letterboxed };
    }
    throw new VideoError("Couldn't find a thumbnail for that YouTube video.", 404);
  }

  const meta = await fetchLimited(fetchImpl, `https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(video.url)}`, { as: 'json' });
  if (!meta.ok) {
    throw new VideoError(
      meta.status === 403 || meta.status === 404
        ? "Vimeo won't share this video's details. Check it is public, or that the link includes its private hash."
        : `Vimeo returned an error (${meta.status}).`,
      404,
    );
  }
  const thumb = String(meta.body.thumbnail_url || '');
  if (!thumb) throw new VideoError("Vimeo didn't return a thumbnail for that video.", 404);
  const img = await fetchLimited(fetchImpl, thumb);
  if (!img.ok) throw new VideoError("Couldn't download the Vimeo thumbnail.", 502);
  return { title: String(meta.body.title || ''), image: img.body, letterboxed: false };
}

function playButtonSvg(size, style) {
  const fill = style === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.62)';
  const ring = style === 'light' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.9)';
  const arrow = style === 'light' ? '#111111' : '#ffffff';
  const r = size / 2;
  const stroke = Math.max(2, Math.round(size * 0.035));
  // Triangle nudged right so it looks optically centred.
  const t = size * 0.2;
  const cx = r + size * 0.04;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<circle cx="${r}" cy="${r}" r="${r - stroke}" fill="${fill}" stroke="${ring}" stroke-width="${stroke}"/>` +
      `<polygon points="${cx - t * 0.8},${r - t} ${cx - t * 0.8},${r + t} ${cx + t},${r}" fill="${arrow}"/>` +
      `</svg>`,
  );
}

/**
 * Crop letterboxing, scale to at most maxWidth and draw a play button in the middle.
 * @returns {Promise<{buffer: Buffer, width: number, height: number}>}
 */
export async function makeVideoThumbnail(image, { letterboxed = false, style = 'dark', maxWidth = 1200, jpegQuality = 82 } = {}) {
  let base = sharp(image).rotate();
  const meta = await base.metadata();
  let { width, height } = meta;
  if (letterboxed && width && height && Math.abs(width / height - 4 / 3) < 0.05) {
    // YouTube's 4:3 fallbacks add black bars above and below a 16:9 picture.
    const h = Math.round((width * 9) / 16);
    base = base.extract({ left: 0, top: Math.round((height - h) / 2), width, height: h });
    height = h;
  }
  const scaled = await base
    .resize({ width: Math.min(width, maxWidth), withoutEnlargement: true })
    .toColorspace('srgb')
    .toBuffer({ resolveWithObject: true });
  const w = scaled.info.width;
  const h = scaled.info.height;
  const size = Math.max(48, Math.round(Math.min(w, h) * 0.24));
  const buffer = await sharp(scaled.data)
    .composite([{ input: playButtonSvg(size, style === 'light' ? 'light' : 'dark'), gravity: 'centre' }])
    .flatten({ background: '#000000' })
    .jpeg({ quality: jpegQuality, mozjpeg: true, progressive: true })
    .toBuffer();
  return { buffer, width: w, height: h };
}
