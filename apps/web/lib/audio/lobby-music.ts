import { ChipSynth } from "./chip-synth";
import { type CompiledTrack, type LobbyTrack, TRACKS } from "./lobby-tracks";

// Notes are scheduled slightly ahead on the audio clock; the timer only tops
// up the queue, so timing stays exact even when the main thread is busy.
const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;

type Playing = {
  name: LobbyTrack;
  track: CompiledTrack;
  step: number;
  next: number;
};

// One shared player for the title and lobby screens, so client navigation
// between them crossfades instead of restarting the audio context.
class LobbyMusic {
  private synth: ChipSynth | null = null;
  private wanted: LobbyTrack | null = null;
  private enabled = false;
  private readonly holds = new Set<string>();
  private playing: Playing | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastHop = -Infinity;

  // Browsers allow audio only after a user gesture; call this from one.
  unlock() {
    if (this.synth) {
      if (this.active()) void this.synth.ctx.resume();
      return;
    }
    if (typeof AudioContext === "undefined") return;
    this.synth = new ChipSynth(new AudioContext());
    document.addEventListener("visibilitychange", () => this.sync());
    this.sync();
  }
  setTrack(track: LobbyTrack | null) {
    this.wanted = track;
    this.sync();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.sync();
  }
  // A named hold (for example an open run) silences the music until released.
  hold(reason: string, held: boolean) {
    if (held) this.holds.add(reason);
    else this.holds.delete(reason);
    this.sync();
  }
  blip() {
    if (this.synth && this.active())
      this.synth.blip(this.synth.ctx.currentTime);
  }
  powerDown() {
    if (this.synth && this.active())
      this.synth.powerDown(this.synth.ctx.currentTime);
  }
  hover() {
    if (this.synth && this.active())
      this.synth.hover(this.synth.ctx.currentTime);
  }
  // Start: the game jingle followed by a short meow.
  start() {
    if (!this.synth || !this.active()) return;
    const now = this.synth.ctx.currentTime;
    this.synth.jingle(now);
    this.synth.meow(now + 0.32, true);
  }
  // Plays even while muting, so the toggle always answers.
  cue(on: boolean) {
    if (!this.synth) return;
    void this.synth.ctx.resume();
    this.synth.cue(on, this.synth.ctx.currentTime + 0.02);
  }
  // A lobby cat hopped. Meows are rationed so several cats never overlap,
  // and panned to where the cat is on screen (-1 left, 1 right).
  hop(pan: number) {
    if (!this.synth || !this.active()) return;
    const now = this.synth.ctx.currentTime;
    if (now - this.lastHop < 2.5 || Math.random() > 0.6) return;
    this.lastHop = now;
    this.synth.meow(now + 0.02, Math.random() < 0.5, pan);
  }

  private active() {
    return (
      this.enabled &&
      this.wanted !== null &&
      this.holds.size === 0 &&
      !document.hidden
    );
  }

  private sync() {
    const synth = this.synth;
    if (!synth) return;
    const target = this.active() ? this.wanted : null;
    if (target === (this.playing?.name ?? null)) return;
    const now = synth.ctx.currentTime;
    if (target === null) {
      synth.fade(0, now, 0.4);
      clearInterval(this.timer);
      this.playing = null;
      setTimeout(() => {
        if (this.playing === null) void synth.ctx.suspend();
      }, 600);
      return;
    }
    void synth.ctx.resume();
    if (this.playing) {
      synth.fade(0, now, 0.15);
      synth.fade(1, now + 0.2, 0.6);
    } else synth.fade(1, now, 0.8);
    this.playing = {
      name: target,
      track: TRACKS[target],
      step: 0,
      next: now + 0.2,
    };
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const synth = this.synth;
    const playing = this.playing;
    if (!synth || !playing) return;
    const { track } = playing;
    const horizon = synth.ctx.currentTime + LOOKAHEAD_S;
    while (playing.next < horizon) {
      const step = track.steps[playing.step];
      const at = playing.next;
      if (step) {
        for (const note of step.notes)
          synth.note(note.voice, note.midi, at, note.steps * track.stepSeconds);
        if (step.kick) synth.kick(at);
        if (step.hat) synth.hat(at);
        if (Math.random() < step.meowChance)
          synth.meow(
            at + track.stepSeconds,
            Math.random() < 0.4,
            Math.random() - 0.5,
          );
      }
      playing.next += track.stepSeconds;
      playing.step = (playing.step + 1) % track.steps.length;
    }
  }
}

export const lobbyMusic = new LobbyMusic();
