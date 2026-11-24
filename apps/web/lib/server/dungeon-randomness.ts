import "server-only";
import { createHash, createHmac } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { expeditionAddress } from "../dungeon/transactions";
import { nonceBytes } from "../solana/program";
import { browserVerifierKey } from "./browser-config";
import { ApiError } from "./runtime";

export function dungeonSecret(owner: string, nonce: string): Buffer {
  return createHmac("sha256", browserVerifierKey().secretKey)
    .update("purrps:dungeon-secret:v1")
    .update(new PublicKey(owner).toBytes())
    .update(nonceBytes(nonce))
    .digest();
}
export const secretCommitment = (secret: Uint8Array) =>
  createHash("sha256").update(secret).digest("hex");
export function dungeonTrap(
  owner: string,
  nonce: string,
  random: string,
  room: number,
): number {
  if (
    !Number.isInteger(room) ||
    room < 0 ||
    room >= 5 ||
    !/^[a-f0-9]{64}$/.test(random)
  )
    throw new ApiError("INVALID_DUNGEON_PROOF", 409);
  for (let counter = 0; counter < 8; counter++) {
    const bytes = createHash("sha256")
      .update("purrps:dungeon-gate:v1")
      .update(expeditionAddress(owner, nonce).toBytes())
      .update(Buffer.from(random, "hex"))
      .update(dungeonSecret(owner, nonce))
      .update(Uint8Array.of(room, counter))
      .digest();
    const value = bytes.find((v) => v < 255);
    if (value !== undefined) return value % 3;
  }
  throw new ApiError("INVALID_DUNGEON_PROOF", 409);
}
// Room generation seed. It uses the VRF bytes but never the committed secret,
// so revealing it with the room start cannot leak a gate outcome.
export function dungeonRoomSeed(
  owner: string,
  nonce: string,
  random: string,
  room: number,
): string {
  if (
    !Number.isInteger(room) ||
    room < 0 ||
    room >= 5 ||
    !/^[a-f0-9]{64}$/.test(random)
  )
    throw new ApiError("INVALID_DUNGEON_PROOF", 409);
  return createHash("sha256")
    .update("purrps:dungeon-room:v2")
    .update(expeditionAddress(owner, nonce).toBytes())
    .update(Buffer.from(random, "hex"))
    .update(Uint8Array.of(room))
    .digest("hex");
}
