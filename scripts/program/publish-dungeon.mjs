import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { DUNGEON_V1, ENGINE } from "../../apps/web/lib/dungeon/rules.ts";
import { DEVNET } from "../../apps/web/lib/solana/addresses.ts";
import { PURRPS_GAME_IDL } from "../../apps/web/lib/solana/purrps-game.ts";
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
  mode === undefined || (mode === "--publish" && path && extra === undefined),
  "Usage: node --env-file=apps/web/.env scripts/program/publish-dungeon.mjs [--publish admin-keypair.json]",
);
const coder = new BorshCoder(convertIdlToCamelCase(PURRPS_GAME_IDL));
const program = new PublicKey(DEVNET.program);
const pda = (seed) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0];
const config = pda("game-config"),
  dungeon = pda("dungeon-config");
const rpc = new Connection(process.env.HELIUS_DEVNET_RPC_URL, {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
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
const hash = createHash("sha256")
  .update("purrps:dungeon-rules:v1")
  .update(coder.types.encode("dungeonRules", DUNGEON_V1))
  .digest("hex");
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
if (mode === "--publish") {
  check(
    game.allowReservations,
    "ENABLE_RESERVATIONS_BEFORE_DUNGEON_PUBLICATION",
  );
  const hosted = await fetch(new URL("/api/dungeon", process.env.APP_ORIGIN), {
    signal: AbortSignal.timeout(8000),
  });
  check(hosted.ok, "PUBLISH_THE_DUNGEON_WEB_BUILD_FIRST");
  const ready = await hosted.json();
  check(
    ready.engine === ENGINE &&
      ready.version === 1 &&
      ready.verifier === verifier.toBase58(),
    "HOSTED_DUNGEON_MISMATCH",
  );
  if (current)
    check(
      current.rules.version === 1 &&
        Buffer.from(current.rulesHash).toString("hex") === hash,
      "DUNGEON_RULES_MISMATCH",
    );
  if (!current?.enabled || !current.verifier.equals(verifier)) {
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
        rules: DUNGEON_V1,
        verifier,
        enabled: true,
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
    check(preview.value.err === null, "DUNGEON_PUBLICATION_SIMULATION_FAILED");
    signature = await rpc.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: "confirmed",
    });
    check(
      (await rpc.confirmTransaction({ ...block, signature }, "finalized")).value
        .err === null,
      "DUNGEON_PUBLICATION_FAILED",
    );
    const published = await rpc.getAccountInfo(dungeon);
    check(published?.owner.equals(program), "DUNGEON_PUBLICATION_NOT_VISIBLE");
    current = coder.accounts.decode("dungeonConfig", published.data);
    check(
      current.enabled &&
        current.verifier.equals(verifier) &&
        Buffer.from(current.rulesHash).toString("hex") === hash,
      "DUNGEON_PUBLICATION_MISMATCH",
    );
  }
}
process.stdout.write(
  `${JSON.stringify({
    network: "solana-devnet",
    engine: ENGINE,
    program: program.toBase58(),
    dungeon: dungeon.toBase58(),
    configured: current !== null,
    enabled: current?.enabled ?? false,
    targetRulesHash: hash,
    verifier: verifier.toBase58(),
    signature,
  })}\n`,
);
