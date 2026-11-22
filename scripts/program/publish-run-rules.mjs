import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { RULES_V2 } from "../../apps/web/lib/game/rules.ts";
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
const program = new PublicKey(DEVNET.program);
const coder = new BorshCoder(convertIdlToCamelCase(PURRPS_GAME_IDL));
const pda = (seed, ...parts) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...parts], program)[0];
const config = pda("game-config");
const version = Buffer.alloc(4);
version.writeUInt32LE(RULES_V2.rulesVersion);
const rules = pda("rules", version);
const expectedHash = createHash("sha256")
  .update("purrps:rules:v1")
  .update(program.toBuffer())
  .update(coder.types.encode("gameRules", RULES_V2))
  .digest("hex");

const [mode, adminPath, extra] = process.argv.slice(2);
check(
  mode === undefined ||
    (mode === "--publish" && adminPath && extra === undefined),
  "Usage: node --env-file=apps/web/.env scripts/program/publish-run-rules.mjs [--publish admin-keypair.json]",
);
const rpc = new Connection(process.env.HELIUS_DEVNET_RPC_URL, {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
});
check((await rpc.getGenesisHash()) === DEVNET.genesisHash, "WRONG_NETWORK");

async function readConfig() {
  const account = await rpc.getAccountInfo(config);
  check(
    account?.owner.equals(program) && !account.executable,
    "INVALID_CONFIG",
  );
  return coder.accounts.decode("gameConfig", account.data);
}

async function hostedClientReady() {
  const starter = new URL("/starter", process.env.APP_ORIGIN);
  const html = await fetch(starter, { signal: AbortSignal.timeout(8000) });
  if (!html.ok) return false;
  const chunks = new Set(
    [
      ...(await html.text()).matchAll(/src="(\/_next\/static\/[^"<]+\.js)"/g),
    ].map((match) => match[1]),
  );
  for (const path of chunks) {
    const response = await fetch(new URL(path, starter), {
      signal: AbortSignal.timeout(8000),
    });
    if (
      response.ok &&
      (await response.text()).includes("progressive-course-v2")
    )
      return true;
  }
  return false;
}

const current = await readConfig();
const clientReady = await hostedClientReady();
let signature;
if (mode === "--publish" && current.rules?.version !== RULES_V2.rulesVersion) {
  check(clientReady, "PUBLISH_THE_WEB_CLIENT_FIRST");
  check(
    current.rules?.version === RULES_V2.rulesVersion - 1,
    "UNEXPECTED_CURRENT_RULES",
  );
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(adminPath, "utf8"))),
  );
  check(admin.publicKey.equals(current.admin), "INVALID_ADMIN");
  const ix = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: rules, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("publishRules", {
      args: { expectedCurrentVersion: current.rules.version, rules: RULES_V2 },
    }),
  });
  const block = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: admin.publicKey,
    blockhash: block.blockhash,
    lastValidBlockHeight: block.lastValidBlockHeight,
  }).add(ix);
  transaction.sign(admin);
  signature = await rpc.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
  });
  const result = await rpc.confirmTransaction(
    { ...block, signature },
    "finalized",
  );
  check(result.value.err === null, "PUBLICATION_FAILED");
}

const latest = signature ? await readConfig() : current;
if (latest.rules?.version === RULES_V2.rulesVersion)
  check(
    Buffer.from(latest.rules.contentHash).toString("hex") === expectedHash,
    "RULES_HASH_MISMATCH",
  );
process.stdout.write(
  `${JSON.stringify({
    network: "solana-devnet",
    currentRules: latest.rules?.version,
    targetRules: RULES_V2.rulesVersion,
    clientReady,
    rules: rules.toBase58(),
    signature,
  })}\n`,
);
