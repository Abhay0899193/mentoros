/**
 * Streaming PCM16 player for TTS. Schedules chunks gaplessly and exposes a
 * live envelope (drives the Orb's speaking pulse). Supports instant stop and
 * ducking for barge-in.
 */
export class TtsPlayer {
  readonly levelRef: React.MutableRefObject<number> = { current: 0 };

  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private nextTime = 0;
  private sampleRate = 24000;
  private ended = false;
  private liveSources = 0;
  private raf = 0;
  private onDone: (() => void) | null = null;

  start(sampleRate: number, onDone: () => void): void {
    this.stop();
    this.sampleRate = sampleRate;
    this.ended = false;
    this.onDone = onDone;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.gain.connect(this.analyser).connect(this.ctx.destination);
    this.nextTime = this.ctx.currentTime + 0.08;

    const buf = new Float32Array(this.analyser.fftSize);
    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      this.levelRef.current = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  enqueue(pcm: ArrayBuffer): void {
    if (!this.ctx || !this.gain) return;
    const int16 = new Int16Array(pcm);
    if (int16.length === 0) return;
    const audioBuf = this.ctx.createBuffer(1, int16.length, this.sampleRate);
    const ch = audioBuf.getChannelData(0);
    for (let i = 0; i < int16.length; i++) ch[i] = int16[i] / 32768;

    const src = this.ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.gain);
    const at = Math.max(this.nextTime, this.ctx.currentTime + 0.02);
    src.start(at);
    this.nextTime = at + audioBuf.duration;
    this.liveSources += 1;
    src.onended = () => {
      this.liveSources -= 1;
      if (this.ended && this.liveSources <= 0) this.finish();
    };
  }

  /** Server signalled tts-end: finish after queued audio drains. */
  end(): void {
    this.ended = true;
    if (this.liveSources <= 0) this.finish();
  }

  /** Barge-in: fast 80ms duck to silence, then teardown. */
  duck(): void {
    if (this.ctx && this.gain) {
      this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      setTimeout(() => this.stop(), 100);
    } else {
      this.stop();
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.levelRef.current = 0;
    this.liveSources = 0;
    this.ended = false;
    this.onDone = null;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.gain = null;
    this.analyser = null;
  }

  private finish(): void {
    const done = this.onDone;
    this.stop();
    done?.();
  }
}
