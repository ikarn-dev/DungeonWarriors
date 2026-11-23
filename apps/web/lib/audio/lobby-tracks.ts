import type { Voice } from "./chip-synth";

// Two original 8-bar chiptune loops, written in 16th-note steps.
// Melody tokens: a note name starts a note, "-" holds it, "." is a rest.
export type LobbyTrack = "title" | "lobby";
type Chord = { root: number; minor: boolean };
type StepNote = { voice: Voice; midi: number; steps: number };
export type Step = {
  notes: StepNote[];
  kick: boolean;
  hat: boolean;
  meowChance: number;
};
export type CompiledTrack = { stepSeconds: number; steps: Step[] };

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function midi(name: string) {
  const match = /^([A-G]#?)(\d)$/.exec(name);
  const semitone = match ? NAMES.indexOf(match[1] ?? "") : -1;
  if (!match || semitone < 0) throw new Error(`Bad note ${name}`);
  return 12 * (Number(match[2]) + 1) + semitone;
}

function melody(bars: readonly string[]): StepNote[] {
  if (bars.some((bar) => bar.trim().split(/\s+/).length !== 16))
    throw new Error("Each melody bar needs 16 steps");
  const tokens = bars.join(" ").split(/\s+/);
  const notes: StepNote[] = [];
  tokens.forEach((token, step) => {
    if (token === "-" || token === ".") return;
    let steps = 1;
    while (tokens[step + steps] === "-") steps++;
    notes[step] = { voice: "lead", midi: midi(token), steps };
  });
  return notes;
}

function compile(spec: {
  bpm: number;
  lead: readonly string[];
  chords: readonly Chord[];
  bass: readonly (readonly [number, number, number])[];
  arpEvery: number;
  kicks: readonly number[];
  hats: readonly number[];
  meows: readonly (readonly [number, number])[];
}): CompiledTrack {
  const total = spec.lead.length * 16;
  const steps: Step[] = Array.from({ length: total }, () => ({
    notes: [],
    kick: false,
    hat: false,
    meowChance: 0,
  }));
  melody(spec.lead).forEach((note, step) => {
    if (note) steps[step]?.notes.push(note);
  });
  spec.chords.forEach(({ root, minor }, bar) => {
    const tones = [0, minor ? 3 : 4, 7, 12];
    let bass = root - 24;
    while (bass < 36) bass += 12;
    for (let s = 0; s < 16; s++) {
      const step = steps[bar * 16 + s];
      if (!step) continue;
      if (s % spec.arpEvery === 0)
        step.notes.push({
          voice: "arp",
          midi: root + (tones[(s / spec.arpEvery) % 4] ?? 0),
          steps: 1,
        });
      for (const [at, offset, length] of spec.bass)
        if (at === s)
          step.notes.push({
            voice: "bass",
            midi: bass + offset,
            steps: length,
          });
      step.kick = spec.kicks.includes(s);
      step.hat = spec.hats.includes(s);
    }
  });
  for (const [bar, chance] of spec.meows) {
    const step = steps[bar * 16 + 12];
    if (step) step.meowChance = chance;
  }
  return { stepSeconds: 60 / spec.bpm / 4, steps };
}

const major = (root: number): Chord => ({ root, minor: false });
const minor = (root: number): Chord => ({ root, minor: true });

// Bright title theme: C – Am – F – G.
const title = compile({
  bpm: 116,
  lead: [
    "E5 - G5 - C6 - B5 - G5 - E5 - G5 - - -",
    "A5 - - - G5 - E5 - C5 - E5 - A4 - - -",
    "F5 - A5 - C6 - A5 - G5 - F5 - E5 - D5 -",
    "D5 - - - G5 - - - B4 - D5 - G5 - - -",
    "C6 - B5 - G5 - E5 - G5 - C6 - E6 - - -",
    "D6 - C6 - A5 - E5 - A5 - C6 - B5 - A5 -",
    "A5 - F5 - C5 - F5 - A5 - G5 - F5 - A5 -",
    "G5 - - - - - . . D5 . E5 . F5 . G5 .",
  ],
  chords: [60, 57, 65, 55, 60, 57, 65, 55].map((root, i) =>
    i % 4 === 1 ? minor(root) : major(root),
  ),
  bass: [
    [0, 0, 3],
    [4, 12, 2],
    [6, 0, 2],
    [8, 7, 3],
    [12, 12, 2],
    [14, 7, 2],
  ],
  arpEvery: 1,
  kicks: [0, 8],
  hats: [2, 6, 10, 14],
  meows: [
    [3, 0.5],
    [7, 0.6],
  ],
});

// Calmer lobby theme: F – Dm – Bb – C.
const lobby = compile({
  bpm: 92,
  lead: [
    "A4 - - - C5 - - - F5 - - - E5 - C5 -",
    "D5 - - - - - - - A4 - - - F4 - - -",
    "D5 - - - F5 - - - D5 - C5 - A#4 - - -",
    "C5 - - - - - - - . . . . . . . .",
    "F5 - - - E5 - F5 - G5 - - - A5 - - -",
    "F5 - - - D5 - - - A4 - - - D5 - - -",
    "D5 - C5 - A#4 - - - G4 - - - A#4 - D5 -",
    "C5 - - - - - - - - - - - . . . .",
  ],
  chords: [53, 62, 58, 60, 53, 62, 58, 60].map((root, i) =>
    i % 4 === 1 ? minor(root) : major(root),
  ),
  bass: [
    [0, 0, 6],
    [8, 7, 6],
  ],
  arpEvery: 2,
  kicks: [],
  hats: [4, 12],
  meows: [
    [3, 0.35],
    [7, 0.6],
  ],
});

export const TRACKS: Record<LobbyTrack, CompiledTrack> = { title, lobby };
