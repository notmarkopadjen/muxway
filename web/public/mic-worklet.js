// Runs on the audio thread: turns the microphone's samples into 16-bit PCM
// and posts a frame every tenth of a second. Served as a file of the client's
// own, so the content security policy needs nothing new.
class Frames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buf = new Int16Array(this.size);
    this.at = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.at++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.at === this.size) {
        // The buffer moves to the page; a fresh one takes its place.
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(this.size);
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor('frames', Frames);
