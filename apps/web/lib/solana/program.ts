import { BorshCoder, convertIdlToCamelCase, utils } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { DEVNET } from "./addresses.ts";
import { PURRPS_GAME_IDL } from "./purrps-game.ts";

export const program = new PublicKey(DEVNET.program);
export const idl = convertIdlToCamelCase(PURRPS_GAME_IDL);
export const coder = new BorshCoder(idl);
export const u64Input = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .pipe(z.string().refine((n) => BigInt(n) <= 0xffffffffffffffffn));
export function nonceBytes(value: string | bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}
export function pda(seed: string, ...parts: Uint8Array[]) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...parts],
    program,
  )[0];
}

export const hydraProgram = new PublicKey(
  "eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf",
);

export function crankAddress(run: PublicKey) {
  const hash = utils.sha256.hash as typeof utils.sha256.hash &
    ((value: Uint8Array) => string);
  const seed = Buffer.from(
    hash(Buffer.concat([Buffer.from("purrps:crank:v1"), run.toBuffer()])),
    "hex",
  );
  return PublicKey.findProgramAddressSync(
    [Buffer.from("crank"), run.toBytes(), seed],
    hydraProgram,
  )[0];
}
