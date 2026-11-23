import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { RULES_V2, RULES_V3 } from "../../apps/web/lib/game/rules.ts";
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
const rulesAddress = (version) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(version);
  return pda("rules", bytes);
};
const rulesHash = (data) =>
  createHash("sha256")
    .update("purrps:rules:v1")
    .update(program.toBuffer())
    .update(coder.types.encode("gameRules", data))
    .digest("hex");
const target = RULES_V3.rulesVersion;

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
    if (response.ok && (await response.text()).includes("platform-course-v3"))
      return true;
  }
  return false;
}

const current = await readConfig();
const clientReady = await hostedClientReady();
let signature;
if (mode === "--publish" && current.rules?.version !== target) {
  check(clientReady, "PUBLISH_THE_WEB_CLIENT_FIRST");
  check(current.catalog?.version >= 2, "PUBLISH_THE_PIXEL_ART_CATALOG_FIRST");
  const currentVersion = current.rules?.version;
  check(
    currentVersion === 1 || currentVersion === 2,
    "UNEXPECTED_CURRENT_RULES",
  );
  if (currentVersion === 2)
    check(
      Buffer.from(current.rules.contentHash).toString("hex") ===
        rulesHash(RULES_V2),
      "RULES_HASH_MISMATCH",
    );
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(adminPath, "utf8"))),
  );
  check(admin.publicKey.equals(current.admin), "INVALID_ADMIN");
  // Publish both missing versions atomically so new runs skip intermediate rules.
  const instructions = [RULES_V2, RULES_V3]
    .filter((data) => data.rulesVersion > currentVersion)
    .map(
      (data) =>
        new TransactionInstruction({
          programId: program,
          keys: [
            { pubkey: config, isSigner: false, isWritable: true },
            { pubkey: admin.publicKey, isSigner: true, isWritable: true },
            {
              pubkey: rulesAddress(data.rulesVersion),
              isSigner: false,
              isWritable: true,
            },
            {
              pubkey: SystemProgram.programId,
              isSigner: false,
              isWritable: false,
            },
          ],
          data: coder.instruction.encode("publishRules", {
            args: {
              expectedCurrentVersion: data.rulesVersion - 1,
              rules: data,
            },
          }),
        }),
    );
  const block = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: admin.publicKey,
    blockhash: block.blockhash,
    lastValidBlockHeight: block.lastValidBlockHeight,
  }).add(...instructions);
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
if (signature)
  check(latest.rules?.version === target, "PUBLICATION_NOT_VISIBLE");
if (latest.rules?.version === target)
  check(
    Buffer.from(latest.rules.contentHash).toString("hex") ===
      rulesHash(RULES_V3),
    "RULES_HASH_MISMATCH",
  );
process.stdout.write(
  `${JSON.stringify({
    network: "solana-devnet",
    currentRules: latest.rules?.version,
    targetRules: target,
    catalogVersion: latest.catalog?.version,
    clientReady,
    rules: rulesAddress(target).toBase58(),
    signature,
  })}\n`,
);
