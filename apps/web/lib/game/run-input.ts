import { BN, utils } from "@anchor-lang/core";
import { MAGIC_CONTEXT_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  type BlockhashWithExpiryBlockHeight,
  type Connection,
  type Keypair,
  type PublicKey,
  SendTransactionError,
  TransactionExpiredBlockheightExceededError,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  intentEnvelopeSchema,
  MAX_INTENTS_PER_SUBMISSION,
  type PlayerIntent,
  PROTOCOL_VERSION,
} from "./protocol";
import { RULES_V1 } from "./rules";
import { programInstruction } from "./run-transactions";

const runBlockhashes = new WeakMap<
  Connection,
  {
    fetchedAt: number;
    block: Promise<BlockhashWithExpiryBlockHeight>;
  }
>();

export function getRunBlockhash(rpc: Connection) {
  const now = performance.now();
  const cached = runBlockhashes.get(rpc);
  if (cached && now - cached.fetchedAt < 1000) return cached.block;
  const block = rpc.getLatestBlockhash("processed").catch((error: unknown) => {
    if (runBlockhashes.get(rpc)?.block === block) runBlockhashes.delete(rpc);
    throw error;
  });
  runBlockhashes.set(rpc, { fetchedAt: now, block });
  return block;
}

export function runInputTransaction(
  run: PublicKey,
  key: Keypair,
  sequence: bigint,
  actions: readonly PlayerIntent[],
  blockhash: string,
  rulesVersion: number = RULES_V1.rulesVersion,
) {
  if (actions.length === 0 || actions.length > MAX_INTENTS_PER_SUBMISSION)
    throw new RangeError("Invalid control batch");
  const heartbeat = actions.some(
    ({ kind }) => kind === "heartbeat" || kind === "inactive",
  );
  if (heartbeat && actions.length !== 1)
    throw new RangeError("Send liveness separately");
  const intents = actions.map((action, i) => {
    const envelope = intentEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      rulesVersion,
      run: run.toBase58(),
      clientSequence: sequence + BigInt(i) + 1n,
      action,
    });
    return {
      ...envelope,
      run,
      clientSequence: new BN(envelope.clientSequence.toString()),
      action: {
        [action.kind]:
          action.kind === "move"
            ? { axis: { [action.axis]: {} } }
            : action.kind === "heartbeat"
              ? { active: action.active }
              : {},
      },
    };
  });
  const instruction = programInstruction(
    heartbeat ? "heartbeat" : "submitIntents",
    { run, authority: key.publicKey, magicContext: MAGIC_CONTEXT_ID },
    heartbeat ? { intent: intents[0] } : { args: { intents } },
  );
  const message = new TransactionMessage({
    recentBlockhash: blockhash,
    payerKey: key.publicKey,
    instructions: [instruction],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([key]);
  return tx;
}

export async function sendRunInput(
  rpc: Connection,
  run: PublicKey,
  key: Keypair,
  sequence: bigint,
  actions: readonly PlayerIntent[],
  signal: AbortSignal,
  rulesVersion: number = RULES_V1.rulesVersion,
) {
  const block = await getRunBlockhash(rpc).catch(() => null);
  if (block === null) return false;
  signal.throwIfAborted();
  const tx = runInputTransaction(
    run,
    key,
    sequence,
    actions,
    block.blockhash,
    rulesVersion,
  );
  const signature = utils.bytes.bs58.encode(
    tx.signatures[0] ?? new Uint8Array(),
  );
  // Resolve the original signature even when the RPC response is lost.
  try {
    await rpc.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 0,
    });
  } catch (error) {
    if (error instanceof SendTransactionError) return false;
  }
  for (;;) {
    signal.throwIfAborted();
    try {
      const result = await rpc.confirmTransaction(
        {
          ...block,
          signature,
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        },
        "confirmed",
      );
      return result.value.err === null;
    } catch (error) {
      if (error instanceof TransactionExpiredBlockheightExceededError)
        return false;
      signal.throwIfAborted();
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  }
}
