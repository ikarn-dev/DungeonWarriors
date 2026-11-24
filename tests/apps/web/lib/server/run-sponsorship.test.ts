import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { afterEach, expect, it, vi } from "vitest";
import { runAddresses } from "../../../../../apps/web/lib/game/run-accounts";
import {
  type GameIntent,
  gameInstructions,
} from "../../../../../apps/web/lib/game/run-transactions";
import { coder, program } from "../../../../../apps/web/lib/solana/program";
import { config } from "./fixtures";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), admit: vi.fn() }));
vi.mock("../../../../../apps/web/lib/server/transaction-network", () => ({
  checkedConnection: mock.rpc,
}));
vi.mock(
  "../../../../../apps/web/lib/server/runtime",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../apps/web/lib/server/runtime")
    >()),
    runtime: () => ({ prefix: "test", redis: { eval: mock.admit } }),
  }),
);

import {
  prepare,
  submit,
  validateTransaction,
} from "../../../../../apps/web/lib/server/transactions";

function launch() {
  const owner = Keypair.generate();
  const play = Keypair.generate();
  const sponsor = Keypair.generate();
  vi.stubEnv("SPONSOR_PUBLIC_KEY", sponsor.publicKey.toBase58());
  vi.stubEnv(
    "SPONSOR_SECRET_KEY",
    Buffer.from(sponsor.secretKey).toString("base64"),
  );
  vi.stubEnv("SPONSOR_HOURLY_BUDGET_LAMPORTS", "100000000");
  vi.stubEnv(
    "SPONSOR_MIN_BALANCE_LAMPORTS",
    config.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
  );
  vi.stubEnv(
    "SPONSOR_OPERATION_LIMIT_LAMPORTS",
    config.SPONSOR_OPERATION_LIMIT_LAMPORTS.toString(),
  );
  vi.stubEnv(
    "SPONSOR_COMPLETION_RESERVE_LAMPORTS",
    config.SPONSOR_COMPLETION_RESERVE_LAMPORTS.toString(),
  );
  vi.stubEnv("SPONSOR_MAX_ATTEMPTS", String(config.SPONSOR_MAX_ATTEMPTS));
  const wallet = owner.publicKey.toBase58();
  const nonce = "4";
  const action = {
    kind: "reserveRun",
    nonce,
    sessionNonce: "3",
    inputKey: play.publicKey.toBase58(),
    inventoryVersion: "2",
    rulesVersion: 1,
    catalogVersion: 1,
    definingCatalogVersion: 1,
    cat: "acrobat",
    market: "SOL",
    stake: "1000000",
    maxGross: "2000000",
    expiresAtSeconds: 1_800_000_000,
    completionFunding: {
      sponsor: sponsor.publicKey.toBase58(),
      lamports: config.SPONSOR_COMPLETION_RESERVE_LAMPORTS.toString(),
      floor: config.SPONSOR_MIN_BALANCE_LAMPORTS.toString(),
      attempts: config.SPONSOR_MAX_ATTEMPTS,
    },
  } as const;
  const intent = { operation: "game", sponsored: false, action } as const;
  const run = runAddresses({ owner: wallet, nonce: BigInt(nonce) }).run[0];
  return { owner, play, sponsor, wallet, intent, run };
}

function instructionNames(tx: VersionedTransaction) {
  return TransactionMessage.decompile(tx.message).instructions.map((ix) =>
    ix.programId.equals(program)
      ? coder.instruction.decode(ix.data)?.name
      : ix.programId.toBase58(),
  );
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

it("rejects retired runner launch preparation without sponsor spend", async () => {
  const { wallet, intent } = launch();
  await expect(prepare(wallet, intent)).rejects.toThrow("ADMISSION_CLOSED");
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(mock.admit).not.toHaveBeenCalled();
});

it("moves the existing budget into the action account before delegating the same nonce", () => {
  const { sponsor, owner, wallet, intent, run } = launch();
  const delegation = {
    operation: "game",
    sponsored: false,
    action: {
      kind: "delegateRun",
      nonce: intent.action.nonce,
      delegationEpoch: "1",
      completionSponsor: sponsor.publicKey.toBase58(),
    },
  } satisfies GameIntent;
  const built = gameInstructions(wallet, delegation);
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: built.payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: built.instructions,
    }).compileToV0Message(),
  );
  tx.sign([owner]);
  expect(instructionNames(tx)).toEqual(["fundRunCompletion", "delegateRun"]);
  expect(built.operationId).toBe(run.toBase58());
  expect(() =>
    validateTransaction(
      wallet,
      delegation,
      Buffer.from(tx.serialize()).toString("base64"),
    ),
  ).not.toThrow();
});

it("omits the writable Hydra accounts when settling a run that never activated", () => {
  const { wallet, intent } = launch();
  const completion = {
    operation: "game",
    sponsored: false,
    action: {
      kind: "requestCompletion",
      nonce: intent.action.nonce,
      market: "SOL",
      hasCrank: false,
    },
  } satisfies GameIntent;
  const [ix] = gameInstructions(wallet, completion).instructions;
  expect(ix?.keys.slice(-3)).toEqual(
    Array.from({ length: 3 }, () => ({
      pubkey: program,
      isSigner: false,
      isWritable: false,
    })),
  );
});

it("rejects signed legacy launch submissions while recovery actions remain available", async () => {
  const { wallet, intent, play, sponsor } = launch();
  const value = {
    ...intent,
    playSponsor: {
      sponsor: sponsor.publicKey.toBase58(),
      floor: intent.action.completionFunding.floor,
    },
  };
  const built = gameInstructions(wallet, value);
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: built.payer,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: built.instructions,
    }).compileToV0Message(),
  );
  tx.sign([play]);
  expect(() =>
    validateTransaction(
      wallet,
      value,
      Buffer.from(tx.serialize()).toString("base64"),
    ),
  ).not.toThrow();
  await expect(
    submit(wallet, value, Buffer.from(tx.serialize()).toString("base64")),
  ).rejects.toThrow("ADMISSION_CLOSED");
  expect(mock.rpc).not.toHaveBeenCalled();
  expect(mock.admit).not.toHaveBeenCalled();
});
