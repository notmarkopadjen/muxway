// The microphone: a clip of 16 kHz mono 16-bit PCM kept in memory, wrapped
// in a WAV for the hub and dropped after. Nothing is stored. The pure parts
// (the header, the resampler, the meter) are tested on their own.

export const SAMPLE_RATE = 16_000;
export const MAX_SECONDS = 60;
export const MIN_SECONDS = 0.5;
const WORKLET = '/mic-worklet.js';
const BLOCKS = '▁▂▃▄▅▆▇█';
/** Frames the meter shows: the last eight tenths of a second. */
export const METER_WIDTH = 8;

export type MicError = 'refused' | 'none' | 'unsupported';

export class RecorderError extends Error {
  constructor(public why: MicError) {
    super(why);
  }
}

/** Loudness of one frame, 0 to 1. */
export function rms(frame: Int16Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.min(1, Math.sqrt(sum / frame.length) / 8000);
}

/** The last levels as block characters, oldest left, padded to the width. */
export function meter(levels: number[], width = METER_WIDTH): string {
  const last = levels.slice(-width);
  let out = BLOCKS[0].repeat(width - last.length);
  for (const l of last) out += BLOCKS[Math.min(BLOCKS.length - 1, Math.floor(l * BLOCKS.length))];
  return out;
}

/** Linear interpolation from one rate to another; the same array when they match. */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to || !pcm.length) return pcm;
  const n = Math.round((pcm.length * to) / from);
  const out = new Int16Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const at = i * step;
    const k = Math.floor(at);
    const a = pcm[Math.min(k, pcm.length - 1)];
    const b = pcm[Math.min(k + 1, pcm.length - 1)];
    out[i] = Math.round(a + (b - a) * (at - k));
  }
  return out;
}

/** A 44-byte RIFF/WAVE header around mono 16-bit PCM. */
export function wavFile(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const bytes = pcm.length * 2;
  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, bytes, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return out;
}

export interface Clip {
  wav: ArrayBuffer;
  seconds: number;
}

export class Recorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private frames: Int16Array[] = [];
  private samples = 0;
  private rate = SAMPLE_RATE;
  private closed = false;
  /** Loudness per frame, oldest first. */
  levels: number[] = [];
  /** Called with each frame while recording. */
  onFrame?: (levels: number[], seconds: number) => void;
  /** Called once when the clip reaches its longest. */
  onFull?: () => void;

  get seconds(): number {
    return this.samples / this.rate;
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined')
      throw new RecorderError('unsupported');
    this.closed = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      throw new RecorderError(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'refused' : 'none',
      );
    }
    // Cancelled while the permission prompt was up: the mic closes at once.
    if (this.closed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    // Where the browser cannot run a graph at 16 kHz the frames come at its
    // rate and are resampled on stop.
    try {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    } catch {
      this.ctx = new AudioContext();
    }
    this.rate = this.ctx.sampleRate;
    const max = MAX_SECONDS * this.rate;
    try {
      await this.ctx.resume();
      await this.ctx.audioWorklet.addModule(WORKLET);
      if (this.closed) return;
      const node = new AudioWorkletNode(this.ctx, 'frames', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (!this.stream) return;
        let frame = new Int16Array(e.data);
        if (this.samples + frame.length > max) frame = frame.subarray(0, max - this.samples);
        if (!frame.length) return;
        this.frames.push(frame);
        this.samples += frame.length;
        this.levels.push(rms(frame));
        if (this.levels.length > METER_WIDTH)
          this.levels.splice(0, this.levels.length - METER_WIDTH);
        this.onFrame?.(this.levels, this.seconds);
        if (this.samples >= max) this.onFull?.();
      };
      this.ctx.createMediaStreamSource(this.stream).connect(node);
    } catch {
      this.release();
      throw new RecorderError('unsupported');
    }
  }

  /** Closes the mic and returns the clip, or null when it is too short to send. */
  stop(): Clip | null {
    const frames = this.frames;
    const samples = this.samples;
    const rate = this.rate;
    this.release();
    if (samples / rate < MIN_SECONDS) return null;
    let pcm = new Int16Array(samples);
    let at = 0;
    for (const f of frames) {
      pcm.set(f, at);
      at += f.length;
    }
    pcm = resample(pcm, rate, SAMPLE_RATE);
    return { wav: wavFile(pcm, SAMPLE_RATE), seconds: pcm.length / SAMPLE_RATE };
  }

  /** Closes the mic and drops the clip. */
  cancel() {
    this.release();
  }

  private release() {
    this.closed = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.frames = [];
    this.samples = 0;
    this.levels = [];
  }
}
