import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import {
  DUNGEON_V3,
  ENGINE,
  LEGACY_DUNGEON_ENGINE_HASH,
} from "../../apps/web/lib/dungeon/rules.ts";
import { DEVNET } from "../../apps/web/lib/solana/addresses.ts";
import { DUNGEON_WARRIORS_IDL } from "../../apps/web/lib/solana/dungeon-warriors.ts";
import { checkEngine } from "./dungeon-engine.mjs";
import { waitForFinalized } from "./publication-status.mjs";
import { check, requireWeb } from "./run-sponsor-state.mjs";

const { BorshCoder, convertIdlToCamelCase } = requireWeb("@anchor-lang/core");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = requireWeb("@solana/web3.js");
const [mode, path, extra] = process.argv.slice(2);
check(
  mode === undefined ||
    (["--publish", "--stage", "--pause"].includes(mode) &&
      path &&
      extra === undefined),
  "Usage: node --env-file=apps/web/.env scripts/program/publish-dungeon.mjs [--pause|--stage|--publish admin-keypair.json]",
);
const engineHash = checkEngine();
const coder = new BorshCoder(convertIdlToCamelCase(DUNGEON_WARRIORS_IDL));
const program = new PublicKey(DEVNET.program);
const pda = (seed) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0];
const config = pda("game-config"),
  dungeon = pda("dungeon-config");
const rpc = new Connection(process.env.HELIUS_DEVNET_RPC_URL, {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
  fetch: (url, init) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(12000) }),
});
check((await rpc.getGenesisHash()) === DEVNET.genesisHash, "WRONG_NETWORK");
const [configInfo, dungeonInfo] = await rpc.getMultipleAccountsInfo([
  config,
  dungeon,
]);
check(configInfo?.owner.equals(program), "INVALID_CONFIG");
const game = coder.accounts.decode("gameConfig", configInfo.data);
let current = null;
if (dungeonInfo) {
  check(dungeonInfo.owner.equals(program), "INVALID_DUNGEON");
  current = coder.accounts.decode("dungeonConfig", dungeonInfo.data);
}
const rulesHash = (rules) =>
  createHash("sha256")
    .update("purrps:dungeon-rules:v1")
    .update(coder.types.encode("dungeonRules", rules))
    .digest("hex");
const hash = rulesHash(DUNGEON_V3);
const currentHash = current
  ? Buffer.from(current.rulesHash).toString("hex")
  : null;
const currentEngineHash = current
  ? Buffer.from(current.rules.engineHash).toString("hex")
  : null;
if (current)
  check(currentHash === rulesHash(current.rules), "INVALID_PUBLISHED_RULES");
const matchesTarget =
  current?.rules.version === DUNGEON_V3.version && currentHash === hash;
const secret = Buffer.from(
  process.env.BROWSER_VERIFIER_SECRET_KEY ?? "",
  "base64",
);
check(secret.length === 64, "VERIFIER_NOT_CONFIGURED");
const verifier = Keypair.fromSecretKey(secret).publicKey;
check(
  !verifier.equals(game.admin) &&
    verifier.toBase58() !== process.env.SPONSOR_PUBLIC_KEY,
  "VERIFIER_MUST_BE_DEDICATED",
);
let signature;
if (mode !== undefined) {
  const enable = mode === "--publish";
  const pause = mode === "--pause";
  if (pause) check(current, "DUNGEON_NOT_PUBLISHED");
  if (mode === "--stage" && current && !matchesTarget) {
    check(
      current.rules.version + 1 === DUNGEON_V3.version &&
        currentEngineHash === LEGACY_DUNGEON_ENGINE_HASH,
      "DUNGEON_RULES_MISMATCH",
    );
    // Once the pause finalizes, no other legacy reservation can race this scan.
    check(!current.enabled, "PAUSE_DUNGEON_BEFORE_STAGING_UPGRADE");
    const expeditions = await rpc.getProgramAccounts(program, {
      commitment: "finalized",
      filters: [{ memcmp: coder.accounts.memcmp("dungeonExpedition") }],
    });
    check(
      expeditions.every(({ account }) => {
        const { status } = coder.accounts.decode(
          "dungeonExpedition",
          account.data,
        );
        return ["won", "lost", "refunded"].includes(Object.keys(status)[0]);
      }),
      "UNSETTLED_DUNGEON_EXPEDITIONS",
    );
  }
  if (enable) {
    check(matchesTarget, "STAGE_DUNGEON_RULES_BEFORE_PUBLISHING");
    check(
      game.allowReservations,
      "ENABLE_RESERVATIONS_BEFORE_DUNGEON_PUBLICATION",
    );
    const hosted = await fetch(
      new URL("/api/dungeon", process.env.APP_ORIGIN),
      {
        signal: AbortSignal.timeout(8000),
      },
    );
    check(hosted.ok, "PUBLISH_THE_DUNGEON_WEB_BUILD_FIRST");
    const ready = await hosted.json();
    check(
      ready.engine === ENGINE &&
        ready.version === DUNGEON_V3.version &&
        ready.engineHash === engineHash &&
        ready.verifier === verifier.toBase58(),
      "HOSTED_DUNGEON_MISMATCH",
    );
  }
  const rules = pause ? current.rules : DUNGEON_V3;
  const targetVerifier = pause ? current.verifier : verifier;
  const targetHash = pause ? currentHash : hash;
  if (
    !current ||
    currentHash !== targetHash ||
    current.enabled !== enable ||
    !current.verifier.equals(targetVerifier)
  ) {
    const admin = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))),
    );
    check(admin.publicKey.equals(game.admin), "INVALID_ADMIN");
    const ix = new TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: dungeon, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: coder.instruction.encode("configureDungeon", {
        rules,
        verifier: targetVerifier,
        enabled: enable,
      }),
    });
    const block = await rpc.getLatestBlockhash("confirmed");
    const transaction = new Transaction({
      feePayer: admin.publicKey,
      blockhash: block.blockhash,
      lastValidBlockHeight: block.lastValidBlockHeight,
    }).add(ix);
    transaction.sign(admin);
    const preview = await rpc.simulateTransaction(transaction);
    if (preview.value.err !== null) {
      const anchorError = preview.value.logs?.find((line) =>
        line.includes("Error Code:"),
      );
      check(
        false,
        anchorError ??
          `DUNGEON_PUBLICATION_SIMULATION_FAILED:${JSON.stringify(preview.value.err)}`,
      );
    }
    signature = await rpc.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: "confirmed",
    });
    // Use bounded HTTP polling: some operator networks block RPC WebSockets.
    // Keep the signature in any ambiguous error; never send a replacement here.
    await waitForFinalized(rpc, signature);
    const published = await rpc.getAccountInfo(dungeon);
    check(published?.owner.equals(program), "DUNGEON_PUBLICATION_NOT_VISIBLE");
    current = coder.accounts.decode("dungeonConfig", published.data);
    check(
      current.enabled === enable &&
        current.verifier.equals(targetVerifier) &&
        Buffer.from(current.rulesHash).toString("hex") === targetHash,
      "DUNGEON_PUBLICATION_MISMATCH",
    );
  }
}
process.stdout.write(
  `${JSON.stringify({
    network: "solana-devnet",
    engine: ENGINE,
    engineHash,
    program: program.toBase58(),
    dungeon: dungeon.toBase58(),
    configured: current !== null,
    enabled: current?.enabled ?? false,
    currentRulesVersion: current?.rules.version ?? null,
    currentEngineHash: current
      ? Buffer.from(current.rules.engineHash).toString("hex")
      : null,
    currentRulesHash: current
      ? Buffer.from(current.rulesHash).toString("hex")
      : null,
    targetRulesVersion: DUNGEON_V3.version,
    targetRulesHash: hash,
    verifier: verifier.toBase58(),
    signature,
  })}\n`,
);
