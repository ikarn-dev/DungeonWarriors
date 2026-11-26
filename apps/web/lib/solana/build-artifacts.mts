import { createHash } from "node:crypto";
import { z } from "zod";
import { DEVNET } from "./addresses.ts";

export const REQUIRED_PROGRAM_INSTRUCTIONS = [
  "configure_dungeon",
  "reserve_dungeon",
  "fulfill_dungeon",
  "settle_dungeon",
  "prepare_dungeon_settlement",
  "record_dungeon_settlement",
  "finalize_dungeon_settlement",
  "refund_dungeon_randomness",
  "initialize_config",
  "publish_rules",
  "publish_catalog",
  "create_player",
  "inspect_oracle",
  "initialize_house",
  "fund_house",
  "withdraw_surplus",
  "set_house_buffer",
  "deposit",
  "withdraw",
  "inspect_run",
  "inspect_run_oracle",
  "inspect_run_escrow",
  "claim_starter",
  "fulfill_starter",
  "purchase_capsule",
  "fulfill_capsule",
  "refund_capsule",
  "apply_upgrade",
  "select_cat",
  "set_admission",
  "authorize_session",
  "revoke_session",
  "configure_sponsorship",
  "fund_sponsorship",
  "reclaim_expired_run_budget",
  "reserve_run",
  "delegate_run",
  "activate_run",
  "advance_run",
  "expire_delegated_activation",
  "process_undelegation",
  "abort_undelegated_reservation",
  "settle_returned_run",
  "settle_run_action",
  "request_completion",
  "fund_run_completion",
  "reclaim_completion_balance",
  "submit_intents",
  "heartbeat",
  "revoke_run_input_key",
  "suspend_or_resume_run",
  "resume_run",
] as const;

const byte = z.number().int().min(0).max(255);
const instructionSchema = z
  .object({
    name: z.string().min(1).max(128),
    discriminator: z.array(byte).length(8),
    accounts: z.array(z.json()).max(64),
    args: z.array(z.json()).max(32),
  })
  .passthrough();
const idlSchema = z
  .object({
    address: z.literal(DEVNET.program),
    metadata: z
      .object({ name: z.string(), version: z.string(), spec: z.string() })
      .passthrough(),
    instructions: z.array(instructionSchema).min(5).max(128),
    accounts: z
      .array(
        z
          .object({ name: z.string(), discriminator: z.array(byte).max(32) })
          .passthrough(),
      )
      .min(1),
    types: z
      .array(z.object({ name: z.string(), type: z.json() }).passthrough())
      .min(1),
  })
  .passthrough();

function normalized(name: string): string {
  return name.replace(/[_-]/g, "").toLowerCase();
}

// Consume actual Anchor output; this rejects the old counter ABI and mismatched
// addresses. It does not manufacture an IDL or claim a Rust build/test passed.
export function validatedClientSource(
  idlInput: unknown,
  typeSource: string,
): string {
  const idl = idlSchema.parse(idlInput);
  if (
    normalized(idl.metadata.name) !== "dungeonwarriors" ||
    !/export\s+type\s+DungeonWarriors\s*=/.test(typeSource) ||
    !typeSource.includes(DEVNET.program)
  ) {
    throw new Error("WRONG_PROGRAM_ARTIFACTS");
  }
  const names = idl.instructions.map((instruction) =>
    normalized(instruction.name),
  );
  if (new Set(names).size !== names.length)
    throw new Error("DUPLICATE_INSTRUCTION");
  for (const required of REQUIRED_PROGRAM_INSTRUCTIONS) {
    const instruction = idl.instructions.find(
      (candidate) => normalized(candidate.name) === normalized(required),
    );
    const expected = createHash("sha256")
      .update(`global:${required}`)
      .digest()
      .subarray(0, 8);
    if (
      instruction === undefined ||
      instruction.discriminator.some(
        (value, index) => value !== expected[index],
      ) ||
      !normalized(typeSource).includes(normalized(required))
    )
      throw new Error("STALE_PROGRAM_ARTIFACTS");
  }
  return `// Generated from user-built Anchor artifacts. Regenerate with program:export-client.\nimport type { Idl as AnchorIdl } from "@anchor-lang/core";\n${typeSource.trim()}\n\nexport const DUNGEON_WARRIORS_IDL = ${JSON.stringify(idl, null, 2)} satisfies AnchorIdl;\n`;
}
