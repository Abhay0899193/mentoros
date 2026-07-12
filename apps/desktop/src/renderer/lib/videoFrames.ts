/**
 * videoFrames — turn a generated mp4 into sprite-clip frames.
 *
 * The avatar player is a sprite stack, so "attach the video" = sample its
 * frames uniformly and hand them to the existing PUT-config path as webp data
 * URIs. At full count a 24fps LTX clip is indistinguishable from video
 * playback; lower counts trade smoothness for frame budget.
 *
 * The mp4 is fetched into a blob URL first: a blob is same-origin, so the
 * canvas never taints regardless of where the page is served from (file://
 * Electron shell vs. core-served LAN page).
 */

export function uniformIndices(total: number, pick: number): number[] {
  const t = Math.max(1, Math.floor(total));
  const n = Math.min(Math.max(1, Math.floor(pick)), t);
  if (n === 1) return [0];
  const out: number[] = [];
  for (let k = 0; k < n; k += 1) {
    out.push(Math.round((k * (t - 1)) / (n - 1)));
  }
  return out;
}

export interface ExtractFramesOptions {
  /** Frame count and rate of the source video (from the videogen history row). */
  totalFrames: number;
  fps: number;
  /** How many frames to keep (uniformly sampled). Clamped to totalFrames. */
  pick: number;
  /** webp encode quality 0..1. */
  quality?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface ExtractFramesResult {
  dataUris: string[];
  /** Wall-clock length of the source — carry onto the clip so speed stays real-time. */
  durationMs: number;
  width: number;
  height: number;
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not decode the video.'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = t;
  });
}

function meanLuma(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const data = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let count = 0;
  // Every 16th pixel is plenty for "is this frame black?".
  for (let i = 0; i < data.length; i += 64) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count += 1;
  }
  return count ? sum / count : 0;
}

function toWebpDataUri(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('webp encoding failed.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('webp encoding failed.'));
        reader.readAsDataURL(blob);
      },
      'image/webp',
      quality,
    );
  });
}

export async function extractFrames(
  url: string,
  { totalFrames, fps, pick, quality = 0.82, onProgress }: ExtractFramesOptions,
): Promise<ExtractFramesResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the video.');
  const blobUrl = URL.createObjectURL(await res.blob());

  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  try {
    video.src = blobUrl;
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Could not open the video.')), {
        once: true,
      });
    });

    const safeFps = fps > 0 ? fps : 24;
    const nominalDuration = totalFrames / safeFps;
    const duration =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : nominalDuration;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('Could not decode the video.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');

    const indices = uniformIndices(totalFrames, pick);
    const dataUris: string[] = [];
    for (let k = 0; k < indices.length; k += 1) {
      const t = Math.min((indices[k] + 0.5) / safeFps, Math.max(0, duration - 0.001));
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, width, height);
      // LTX mp4s open on a black frame (same reason history thumbs seek 0.4s) —
      // if the very first sample reads black, take it a beat later instead.
      if (k === 0 && indices[k] === 0 && meanLuma(ctx, width, height) < 8) {
        await seekTo(video, Math.min(0.4, Math.max(0, duration - 0.001)));
        ctx.drawImage(video, 0, 0, width, height);
      }
      dataUris.push(await toWebpDataUri(canvas, quality));
      onProgress?.(k + 1, indices.length);
    }

    return { dataUris, durationMs: Math.round(nominalDuration * 1000), width, height };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(blobUrl);
  }
}
