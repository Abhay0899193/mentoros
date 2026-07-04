/**
 * Pure PCM16/WAV helpers. No I/O, no Electron — trivially unit-testable.
 * All audio in MentorOS voice is mono, signed 16-bit little-endian.
 */

/** Wrap raw PCM16 mono samples in a canonical 44-byte WAV header. */
export function encodeWavPcm16(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface DecodedWav {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
}

/**
 * Extract PCM16 samples + format from a WAV buffer by scanning RIFF chunks
 * (robust to the extra chunks `afconvert` sometimes emits). Throws on non-WAV
 * or non-PCM16 input.
 */
export function decodeWavPcm16(buf: Buffer): DecodedWav {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let pcm: Buffer | null = null;

  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      pcm = buf.subarray(body, Math.min(body + size, buf.length));
    }
    off = body + size + (size % 2); // chunks are word-aligned
  }

  if (!pcm) throw new Error("no data chunk");
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}`);
  return { pcm, sampleRate, channels };
}

/** Duration in milliseconds of a PCM16 mono buffer at the given sample rate. */
export function pcm16DurationMs(pcm: Buffer, sampleRate: number): number {
  const frames = Math.floor(pcm.length / 2);
  return sampleRate > 0 ? (frames / sampleRate) * 1000 : 0;
}

/** Split a buffer into fixed-size chunks (last chunk may be shorter). */
export function* chunkBuffer(buf: Buffer, bytesPerChunk: number): Generator<Buffer> {
  if (bytesPerChunk <= 0) throw new Error("bytesPerChunk must be positive");
  for (let off = 0; off < buf.length; off += bytesPerChunk) {
    yield buf.subarray(off, Math.min(off + bytesPerChunk, buf.length));
  }
}
