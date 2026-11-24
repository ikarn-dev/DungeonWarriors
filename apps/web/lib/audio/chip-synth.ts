// Short UI sounds built on the Web Audio API: clicks, chirps, a start jingle
// and a filtered meow. There is no background music (2026-11-24 decision).
// Everything runs through a gentle low-pass filter at low volume.
const UI_LEVEL = 0.04;
const MEOW_LEVEL = 0.14;

// Fourier series of a pulse wave with the given duty cycle.
function pulseWave(ctx: AudioContext, duty: number) {
  const size = 32;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let n = 1; n < size; n++) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (Math.PI * n);
    imag[n] = (2 * Math.sin(Math.PI * n * duty) ** 2) / (Math.PI * n);
  }
  return ctx.createPeriodicWave(real, imag);
}

export class ChipSynth {
  readonly ctx: AudioContext;
  private readonly ui: GainNode;
  private readonly meowBus: GainNode;
  private readonly wave: PeriodicWave;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 3200;
    soften.Q.value = 0.5;
    soften.connect(ctx.destination);
    const bus = (level: number) => {
      const gain = ctx.createGain();
      gain.gain.value = level;
      gain.connect(soften);
      return gain;
    };
    this.ui = bus(UI_LEVEL);
    this.meowBus = bus(MEOW_LEVEL);
    this.wave = pulseWave(ctx, 0.25);
  }

  blip(at: number) {
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.setValueAtTime(1320, at);
    osc.frequency.linearRampToValueAtTime(1760, at + 0.03);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.8, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
    osc.connect(env).connect(this.ui);
    osc.start(at);
    osc.stop(at + 0.08);
  }

  // Short square-wave note on the UI bus.
  private chirp(
    at: number,
    from: number,
    to: number,
    seconds: number,
    level = 0.8,
  ) {
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + seconds * 0.6);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(level, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    osc.connect(env).connect(this.ui);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  // Quiet rising chirp for hovering a primary button.
  hover(at: number) {
    this.chirp(at, 990, 1320, 0.06, 0.45);
  }

  // Four-note "game start" arpeggio: C6 E6 G6 C7.
  jingle(at: number) {
    [1047, 1319, 1568, 2093].forEach((hz, i) => {
      this.chirp(at + i * 0.07, hz, hz, i === 3 ? 0.22 : 0.08, 0.7);
    });
  }

  // Two notes up when sound turns on, two down when it turns off.
  cue(on: boolean, at: number) {
    const [first, second] = on ? [784, 1175] : [1175, 784];
    this.chirp(at, first, first, 0.07);
    this.chirp(at + 0.08, second, second, 0.12);
  }

  // Descending blip for disconnecting, like a console powering off.
  powerDown(at: number) {
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.setValueAtTime(880, at);
    osc.frequency.exponentialRampToValueAtTime(196, at + 0.22);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.9, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.26);
    osc.connect(env).connect(this.ui);
    osc.start(at);
    osc.stop(at + 0.28);
  }

  // A quick "mrrp": a sawtooth through a moving band-pass formant, rising
  // then falling in pitch with a light vibrato.
  meow(at: number) {
    const ctx = this.ctx;
    const tune = 2 ** ((Math.random() * 4 - 2) / 12);
    const length = 0.22;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const pitch = osc.frequency;
    pitch.setValueAtTime(520 * tune, at);
    pitch.linearRampToValueAtTime(640 * tune, at + length * 0.35);
    pitch.exponentialRampToValueAtTime(480 * tune, at + length);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 8;
    vibrato.connect(depth).connect(pitch);
    const formant = ctx.createBiquadFilter();
    formant.type = "bandpass";
    formant.Q.value = 3;
    formant.frequency.setValueAtTime(900, at);
    formant.frequency.linearRampToValueAtTime(1700, at + length * 0.4);
    formant.frequency.linearRampToValueAtTime(800, at + length);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + 0.05);
    env.gain.setValueAtTime(1, at + length * 0.6);
    env.gain.linearRampToValueAtTime(0, at + length);
    osc.connect(formant).connect(env).connect(this.meowBus);
    osc.start(at);
    vibrato.start(at);
    osc.stop(at + length + 0.05);
    vibrato.stop(at + length + 0.05);
  }
}
