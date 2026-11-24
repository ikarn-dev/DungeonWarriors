import { ChipSynth } from "./chip-synth";

// One shared player for click and feedback sounds on every screen. There is
// no background music; sounds play only in answer to the player's actions.
class LobbySounds {
  private synth: ChipSynth | null = null;
  private enabled = false;

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
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.sync();
  }
  blip() {
    if (this.synth && this.active())
      this.synth.blip(this.synth.ctx.currentTime);
  }
  hover() {
    if (this.synth && this.active())
      this.synth.hover(this.synth.ctx.currentTime);
  }
  powerDown() {
    if (this.synth && this.active())
      this.synth.powerDown(this.synth.ctx.currentTime);
  }
  reveal() {
    if (this.synth && this.active())
      this.synth.jingle(this.synth.ctx.currentTime);
  }
  // Start: the game jingle followed by a short meow.
  start() {
    if (!this.synth || !this.active()) return;
    const now = this.synth.ctx.currentTime;
    this.synth.jingle(now);
    this.synth.meow(now + 0.32);
  }
  // Plays even while muting, so the toggle always answers.
  cue(on: boolean) {
    if (!this.synth) return;
    void this.synth.ctx.resume();
    this.synth.cue(on, this.synth.ctx.currentTime + 0.02);
  }
  private active() {
    return this.enabled && !document.hidden;
  }
  // Suspend the context when sound is off or the tab is hidden, after any
  // closing cue has played out.
  private sync() {
    const synth = this.synth;
    if (!synth) return;
    if (this.active()) void synth.ctx.resume();
    else
      setTimeout(() => {
        if (!this.active()) void synth.ctx.suspend();
      }, 600);
  }
}

export const lobbySounds = new LobbySounds();
