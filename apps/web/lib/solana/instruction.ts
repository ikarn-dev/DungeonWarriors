import type { IdlInstructionAccountItem } from "@anchor-lang/core";
import { type PublicKey, TransactionInstruction } from "@solana/web3.js";
import { WebApiError } from "../game/web-api";
import { coder, idl, program } from "./program";

function metas(
  items: IdlInstructionAccountItem[],
  values: Record<string, PublicKey>,
): TransactionInstruction["keys"] {
  return items.flatMap((meta) => {
    if ("accounts" in meta) return metas(meta.accounts, values);
    const pubkey = Object.hasOwn(values, meta.name)
      ? values[meta.name]
      : undefined;
    if (!pubkey) throw new WebApiError("UNSUPPORTED_ACCOUNT_LAYOUT");
    return [
      {
        pubkey,
        isSigner: "signer" in meta && meta.signer === true,
        isWritable:
          "writable" in meta &&
          meta.writable === true &&
          !("optional" in meta && meta.optional && pubkey.equals(program)),
      },
    ];
  });
}
export function programInstruction(
  name: string,
  values: Record<string, PublicKey>,
  args: object,
) {
  const definition = idl.instructions.find((ix) => ix.name === name);
  if (!definition) throw new WebApiError("INSTRUCTION_NOT_BUILT");
  return new TransactionInstruction({
    programId: program,
    keys: metas(definition.accounts, values),
    data: coder.instruction.encode(name, args),
  });
}
