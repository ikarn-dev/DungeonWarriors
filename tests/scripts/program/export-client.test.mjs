import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DEVNET } from "../../../apps/web/lib/solana/addresses.mts";
import {
  REQUIRED_PROGRAM_INSTRUCTIONS,
  validatedClientSource,
} from "../../../apps/web/lib/solana/build-artifacts.mts";

function artifacts() {
  const instructions = REQUIRED_PROGRAM_INSTRUCTIONS.map((name) => ({
    name,
    discriminator: [
      ...createHash("sha256").update(`global:${name}`).digest().subarray(0, 8),
    ],
    accounts: [],
    args: [],
  }));
  return {
    idl: {
      address: DEVNET.program,
      metadata: { name: "purrps_game", version: "0.1.0", spec: "0.1.0" },
      instructions,
      accounts: [{ name: "GameConfig", discriminator: Array(8).fill(1) }],
      types: [{ name: "GameConfig", type: { kind: "struct", fields: [] } }],
    },
    typeSource: `export type PurrpsGame = { address: "${DEVNET.program}"; instructions: [${instructions.map(({ name }) => `"${name}"`).join(",")}]; };`,
  };
}

test("exports actual artifact content with a checked runtime IDL and its generated type", () => {
  const { idl, typeSource } = artifacts();
  const output = validatedClientSource(idl, typeSource);
  assert.ok(output.includes(typeSource));
  assert.ok(output.includes("export const PURRPS_GAME_IDL"));
  assert.ok(output.includes("satisfies AnchorIdl"));
});

test("rejects stale counter artifacts, wrong addresses, mismatched types and discriminators", () => {
  const { idl, typeSource } = artifacts();
  assert.throws(() =>
    validatedClientSource(
      { ...idl, address: "11111111111111111111111111111111" },
      typeSource,
    ),
  );
  assert.throws(() =>
    validatedClientSource(
      { ...idl, instructions: idl.instructions.slice(0, 2) },
      typeSource,
    ),
  );
  assert.throws(() => validatedClientSource(idl, "export type Counter = {}"));
  assert.throws(() =>
    validatedClientSource(
      idl,
      `export type PurrpsGame = { address: "${DEVNET.program}" };`,
    ),
  );
  const corrupted = structuredClone(idl);
  corrupted.instructions[0].discriminator[0] ^= 1;
  assert.throws(() => validatedClientSource(corrupted, typeSource));
  const missingDiscriminator = structuredClone(idl);
  missingDiscriminator.instructions[0].discriminator = [];
  assert.throws(() => validatedClientSource(missingDiscriminator, typeSource));
  const foreignAccount = structuredClone(idl);
  foreignAccount.accounts.push({ name: "ProgramData", discriminator: [] });
  assert.ok(
    validatedClientSource(foreignAccount, typeSource).includes(
      "PURRPS_GAME_IDL",
    ),
  );
  const duplicate = structuredClone(idl);
  duplicate.instructions.push(duplicate.instructions[0]);
  assert.throws(() => validatedClientSource(duplicate, typeSource));
  const camel = structuredClone(idl);
  camel.instructions = camel.instructions.map((instruction) => ({
    ...instruction,
    name: instruction.name.replace(/_([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    ),
  }));
  assert.ok(
    validatedClientSource(camel, typeSource).includes("PURRPS_GAME_IDL"),
  );
});
