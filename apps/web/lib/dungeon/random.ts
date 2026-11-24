// xoshiro128** seeded from a 64-hex room seed. Only 32-bit integer operations,
// so the browser and the server generate identical rooms.
export class RoomRandom {
  private s: [number, number, number, number];
  constructor(seed: string) {
    if (!/^[a-f0-9]{64}$/.test(seed)) throw new Error("INVALID_DUNGEON_SEED");
    const word = (i: number) =>
      Number.parseInt(seed.slice(i * 8, i * 8 + 8), 16) >>> 0;
    this.s = [word(0) | 1, word(1), word(2), word(3)];
  }
  next(): number {
    const [a, b, c, d] = this.s;
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    let c2 = (c ^ a) >>> 0;
    let d2 = (d ^ b) >>> 0;
    const b2 = (b ^ c2) >>> 0;
    const a2 = (a ^ d2) >>> 0;
    c2 = (c2 ^ t) >>> 0;
    d2 = rotl(d2, 11);
    this.s = [a2, b2, c2, d2];
    return result;
  }
  // Uniform integer in [0, n) by rejection, n <= 2^16.
  int(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 65536)
      throw new Error("INVALID_DUNGEON_RANGE");
    const limit = 4294967296 - (4294967296 % n);
    for (;;) {
      const value = this.next();
      if (value < limit) return value % n;
    }
  }
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error("INVALID_DUNGEON_RANGE");
    return item;
  }
}
function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
// Integer triangle wave in [0, span] with a dwell at each end.
export function shuttle(
  tick: number,
  phase: number,
  travel: number,
  dwell: number,
  span: number,
): number {
  const period = 2 * (travel + dwell);
  const t = (tick + phase) % period;
  if (t < dwell) return 0;
  if (t < dwell + travel) return Math.trunc(((t - dwell) * span) / travel);
  if (t < 2 * dwell + travel) return span;
  return Math.trunc(((period - t) * span) / travel);
}
