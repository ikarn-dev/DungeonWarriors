// Fixed v1 Borsh offsets are asserted against serialized Rust fixtures.
export const SNAPSHOT_START = 43;
export const SNAPSHOT_END = 736;
export const ENTITY_VECTOR_OFFSET = 831;

export function guardRunLayout(data: Uint8Array): void {
  if (data.length < ENTITY_VECTOR_OFFSET || data.length > 10_240)
    throw new Error("INVALID_RUN_LAYOUT");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = ENTITY_VECTOR_OFFSET;
  const skip = (n: number) => {
    offset += n;
    if (offset > data.length) throw new Error("INVALID_RUN_LAYOUT");
  };
  const byte = () => {
    skip(1);
    return view.getUint8(offset - 1);
  };
  const option = (size: number) => {
    const tag = byte();
    if (tag > 1) throw new Error("INVALID_RUN_LAYOUT");
    if (tag === 1) skip(size);
  };
  const vector = (count: number) => {
    skip(4);
    if (view.getUint32(offset - 4, true) !== count)
      throw new Error("INVALID_RUN_LAYOUT");
  };
  vector(64);
  for (let i = 0; i < 64; i++) {
    skip(8);
    const tag = byte();
    if (tag > 5) throw new Error("INVALID_RUN_LAYOUT");
    if (tag === 4) skip(1);
    if (tag === 5) skip(4);
    skip(16);
    option(1);
    skip(9);
  }
  skip(9);
  vector(16);
  skip(16 * 68 + 2);
  option(68);
  vector(32);
  for (let i = 0; i < 32; i++) {
    const tag = byte();
    if (tag > 1) throw new Error("INVALID_RUN_LAYOUT");
    if (tag === 0) continue;
    skip(46);
    const action = byte();
    if (action > 7) throw new Error("INVALID_RUN_LAYOUT");
    if (action === 0 || action === 6) skip(1);
    skip(16);
  }
}
