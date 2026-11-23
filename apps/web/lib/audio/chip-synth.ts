// Retro chip voices built on the Web Audio API: pulse lead and arpeggio,
// triangle bass, noise hats, a soft kick, UI blips and a filtered meow.
// Every sound runs through one master gain and a gentle low-pass filter.
export type Voice = "lead" | "arp" | "bass";

const MASTER = 0.5;
const midiHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

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
  private readonly out: GainNode;
  private readonly bus: Record<Voice | "drum" | "meow" | "ui", GainNode>;
  private readonly waves: Record<"lead" | "arp", PeriodicWave>;
  private readonly noise: AudioBuffer;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const soften = ctx.createBiquadFilter();
    soften.type = "lowpass";
    soften.frequency.value = 3200;
    soften.Q.value = 0.5;
    soften.connect(ctx.destination);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(soften);
    // Music buses follow the master fade. Meows and UI sounds bypass it, so
    // they still play while the background loop is paused or fading.
    const bus = (level: number, direct = false) => {
      const gain = ctx.createGain();
      gain.gain.value = direct ? level * MASTER : level;
      gain.connect(direct ? soften : this.out);
      return gain;
    };
    this.bus = {
      lead: bus(0.2),
      arp: bus(0.06),
      bass: bus(0.22),
      drum: bus(0.12),
      meow: bus(0.28, true),
      ui: bus(0.08, true),
    };
    this.waves = { lead: pulseWave(ctx, 0.25), arp: pulseWave(ctx, 0.125) };
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  // Ramps the master level from its current value; 1 is full volume.
  fade(level: number, at: number, seconds: number) {
    const gain = this.out.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(gain.value, at);
    gain.linearRampToValueAtTime(level * MASTER, at + seconds);
  }

  note(voice: Voice, midi: number, at: number, seconds: number) {
    const osc = this.ctx.createOscillator();
    if (voice === "bass") osc.type = "triangle";
    else osc.setPeriodicWave(this.waves[voice]);
    osc.frequency.value = midiHz(midi);
    const env = this.ctx.createGain();
    const end = at + seconds;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + 0.006);
    env.gain.exponentialRampToValueAtTime(
      voice === "lead" ? 0.55 : 0.35,
      at + 0.08,
    );
    env.gain.setTargetAtTime(0.0001, end, 0.03);
    osc.connect(env).connect(this.bus[voice]);
    osc.start(at);
    osc.stop(end + 0.2);
  }

  kick(at: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
    osc.connect(env).connect(this.bus.drum);
    osc.start(at);
    osc.stop(at + 0.16);
  }

  hat(at: number) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const high = this.ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 7000;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.35, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    source.connect(high).connect(env).connect(this.bus.drum);
    source.start(at, Math.random() * 0.5, 0.05);
  }

  blip(at: number) {
    const osc = this.ctx.createOscillator();
    osc.setPeriodicWave(this.waves.lead);
    osc.frequency.setValueAtTime(1320, at);
    osc.frequency.linearRampToValueAtTime(1760, at + 0.03);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.8, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
    osc.connect(env).connect(this.bus.ui);
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
    osc.setPeriodicWave(this.waves.lead);
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + seconds * 0.6);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(level, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    osc.connect(env).connect(this.bus.ui);
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
    osc.setPeriodicWave(this.waves.lead);
    osc.frequency.setValueAtTime(880, at);
    osc.frequency.exponentialRampToValueAtTime(196, at + 0.22);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.9, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.26);
    osc.connect(env).connect(this.bus.ui);
    osc.start(at);
    osc.stop(at + 0.28);
  }

  // A soft "mi-aow": a sawtooth through a moving band-pass formant, rising
  // then falling in pitch with a light vibrato. `short` gives a quick "mrrp".
  meow(at: number, short = false, pan = 0) {
    const ctx = this.ctx;
    const tune = 2 ** ((Math.random() * 4 - 2) / 12);
    const length = short ? 0.22 : 0.42;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const pitch = osc.frequency;
    pitch.setValueAtTime((short ? 520 : 560) * tune, at);
    pitch.linearRampToValueAtTime(
      (short ? 640 : 820) * tune,
      at + length * 0.35,
    );
    pitch.exponentialRampToValueAtTime((short ? 480 : 470) * tune, at + length);
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
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(formant).connect(env).connect(panner).connect(this.bus.meow);
    osc.start(at);
    vibrato.start(at);
    osc.stop(at + length + 0.05);
    vibrato.stop(at + length + 0.05);
  }
}
