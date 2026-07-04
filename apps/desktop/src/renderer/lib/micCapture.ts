/**
 * Mic capture for the voice loop: one getUserMedia stream feeding both
 * (a) a live RMS level for the Orb and (b) 16 kHz PCM16 chunks for STT.
 */

export interface MicCapture {
  stop: () => void;
}

export const STT_SAMPLE_RATE = 16000;

const workletSource = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

function resampleTo16k(input: Float32Array, fromRate: number, carry: { t: number }): Int16Array {
  const ratio = fromRate / STT_SAMPLE_RATE;
  const out: number[] = [];
  let t = carry.t;
  while (t < input.length - 1) {
    const i = Math.floor(t);
    const frac = t - i;
    const s = input[i] * (1 - frac) + input[i + 1] * frac;
    out.push(Math.max(-32768, Math.min(32767, Math.round(s * 32767))));
    t += ratio;
  }
  carry.t = t - input.length;
  return Int16Array.from(out);
}

export async function startMicCapture(opts: {
  levelRef: React.MutableRefObject<number>;
  onChunk: (pcm: ArrayBuffer) => void;
  onError: (message: string) => void;
}): Promise<MicCapture> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch {
    opts.onError('Microphone unavailable — check System Settings › Privacy & Security › Microphone.');
    return { stop: () => undefined };
  }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    opts.levelRef.current = Math.min(1, Math.sqrt(sum / buf.length) * 6);
    raf = requestAnimationFrame(tick);
  };
  tick();

  const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);
  const tap = new AudioWorkletNode(ctx, 'pcm-tap');
  const carry = { t: 0 };
  let pending: Int16Array[] = [];
  let pendingLen = 0;
  tap.port.onmessage = (ev: MessageEvent<Float32Array>) => {
    const chunk = resampleTo16k(ev.data, ctx.sampleRate, carry);
    pending.push(chunk);
    pendingLen += chunk.length;
    if (pendingLen >= 2048) {
      const merged = new Int16Array(pendingLen);
      let o = 0;
      for (const c of pending) {
        merged.set(c, o);
        o += c.length;
      }
      pending = [];
      pendingLen = 0;
      opts.onChunk(merged.buffer);
    }
  };
  source.connect(tap);
  // keep the worklet pulled without audible output
  const mute = ctx.createGain();
  mute.gain.value = 0;
  tap.connect(mute).connect(ctx.destination);

  return {
    stop: () => {
      cancelAnimationFrame(raf);
      tap.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      opts.levelRef.current = 0;
    },
  };
}
