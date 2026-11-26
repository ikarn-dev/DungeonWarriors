import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assetManifestBytes } from "../../apps/web/lib/game/assets.ts";
import { CATALOG_V1 } from "../../apps/web/lib/game/catalog.ts";
import { rpcConfigSchema } from "../../apps/web/lib/providers/config.ts";
import { DEVNET } from "../../apps/web/lib/solana/addresses.ts";
import { DUNGEON_WARRIORS_IDL } from "../../apps/web/lib/solana/dungeon-warriors.ts";
import { checkGameAssets } from "../assets/check-assets.mjs";
import { check, requireWeb } from "./run-sponsor-state.mjs";

// Catalog v2 (2026-11-22) republishes the unchanged v1 values with media v2.
// Read-only by default: it simulates the next publication. `--publish` signs
// with the configured admin only after the hosted site serves the same media.
const TARGET = 2;
const MEDIA_VERSION = 2;

const { BN, BorshCoder, convertIdlToCamelCase } =
  requireWeb("@anchor-lang/core");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = requireWeb("@solana/web3.js");
const program = new PublicKey(DEVNET.program);
const coder = new BorshCoder(convertIdlToCamelCase(DUNGEON_WARRIORS_IDL));
const publicDir = fileURLToPath(
  new URL("../../apps/web/public", import.meta.url),
);
const pda = (seed, ...parts) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...parts], program)[0];
const configAddress = pda("game-config");
const versionSeed = (version) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(version);
  return bytes;
};
const catalogAddress = pda("catalog", versionSeed(TARGET));

function catalogData(contentHash) {
  const {
    cats,
    upgrades,
    starterPriceBaseUnits,
    catPriceBaseUnits,
    upgradePriceBaseUnits,
    ...values
  } = CATALOG_V1;
  const catalog = {
    ...values,
    catalogVersion: TARGET,
    cats: cats.map(({ id, rarity, power, ...stats }) => ({
      ...stats,
      id: { [id]: {} },
      rarity: { [rarity]: {} },
      power: { [power]: {} },
    })),
    upgrades: upgrades.map(({ rarity, ...stats }) => ({
      ...stats,
      rarity: { [rarity]: {} },
    })),
    starterPriceBaseUnits: new BN(starterPriceBaseUnits.toString()),
    catPriceBaseUnits: new BN(catPriceBaseUnits.toString()),
    upgradePriceBaseUnits: new BN(upgradePriceBaseUnits.toString()),
  };
  const assetManifest = {
    version: MEDIA_VERSION,
    contentHash: [...Buffer.from(contentHash, "hex")],
  };
  const expectedHash = createHash("sha256")
    .update("purrps:catalog:v1")
    .update(program.toBuffer())
    .update(coder.types.encode("catalog", catalog))
    .update(coder.types.encode("versionBinding", assetManifest))
    .digest("hex");
  return { catalog, assetManifest, expectedHash };
}

// The live site must already serve the exact manifest the catalog will bind.
async function hostedMediaMatches(origin, contentHash) {
  const url = new URL(`/game-assets/v${MEDIA_VERSION}/manifest.json`, origin);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) return false;
  const digest = createHash("sha256")
    .update(assetManifestBytes(await response.json()))
    .digest("hex");
  return digest === contentHash;
}

async function inspectCatalog(env, adminPath) {
  const media = await checkGameAssets(publicDir, MEDIA_VERSION);
  check(media.ready, "ASSETS_NOT_READY");
  const { HELIUS_DEVNET_RPC_URL } = rpcConfigSchema.parse(env);
  const rpc = new Connection(HELIUS_DEVNET_RPC_URL, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      }),
  });
  check((await rpc.getGenesisHash()) === DEVNET.genesisHash, "WRONG_NETWORK");
  const [configInfo, current] = await rpc.getMultipleAccountsInfo(
    [configAddress, catalogAddress],
    "finalized",
  );
  check(
    configInfo?.owner.equals(program) && !configInfo.executable,
    "INVALID_CONFIG",
  );
  const config = coder.accounts.decode("gameConfig", configInfo.data);
  check(config.schemaVersion === 1 && config.rules !== null, "INVALID_CONFIG");
  const { catalog, assetManifest, expectedHash } = catalogData(
    media.binding.contentHash,
  );
  const matches = (info) => {
    if (!info?.owner.equals(program) || info.executable) return false;
    const record = coder.accounts.decode("catalogVersion", info.data);
    return (
      record.schemaVersion === 1 &&
      record.binding.version === TARGET &&
      Buffer.from(record.binding.contentHash).toString("hex") ===
        expectedHash &&
      record.assetManifest.version === MEDIA_VERSION &&
      Buffer.from(record.assetManifest.contentHash).toString("hex") ===
        media.binding.contentHash
    );
  };
  const result = {
    network: "solana-devnet",
    catalog: catalogAddress.toBase58(),
    assetManifest: media.binding,
    catalogHash: expectedHash,
  };
  if (config.catalog?.version === TARGET) {
    check(
      Buffer.from(config.catalog.contentHash).toString("hex") ===
        expectedHash && matches(current),
      "CATALOG_ALREADY_PUBLISHED_WITH_DIFFERENT_BINDING",
    );
    return { ...result, status: "published" };
  }
  check(config.catalog?.version === TARGET - 1, "UNEXPECTED_CURRENT_CATALOG");
  check(current === null, "CATALOG_PDA_OCCUPIED");
  const ix = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: configAddress, isSigner: false, isWritable: true },
      { pubkey: config.admin, isSigner: true, isWritable: true },
      { pubkey: catalogAddress, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: coder.instruction.encode("publishCatalog", {
      args: {
        expectedCurrentVersion: TARGET - 1,
        catalog,
        assetManifest,
      },
    }),
  });
  const block = await rpc.getLatestBlockhash("finalized");
  const message = new TransactionMessage({
    payerKey: config.admin,
    recentBlockhash: block.blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const { context, value } = await rpc.simulateTransaction(tx, {
    sigVerify: false,
    commitment: "finalized",
    accounts: { encoding: "base64", addresses: [catalogAddress.toBase58()] },
  });
  check(value.err === null, "CATALOG_SIMULATION_FAILED");
  const simulated = value.accounts?.[0];
  check(
    simulated?.data[1] === "base64" &&
      matches({
        owner: new PublicKey(simulated.owner),
        executable: simulated.executable,
        data: Buffer.from(simulated.data[0], "base64"),
      }),
    "SIMULATED_CATALOG_MISMATCH",
  );
  if (adminPath === undefined)
    return {
      ...result,
      status: "simulated",
      slot: context.slot,
      computeUnits: value.unitsConsumed,
    };
  check(
    await hostedMediaMatches(env.APP_ORIGIN, media.binding.contentHash),
    "PUBLISH_THE_WEB_CLIENT_FIRST",
  );
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(adminPath, "utf8"))),
  );
  check(admin.publicKey.equals(config.admin), "INVALID_ADMIN");
  tx.sign([admin]);
  const signature = await rpc.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "finalized",
  });
  const confirmed = await rpc.confirmTransaction(
    { ...block, signature },
    "finalized",
  );
  check(confirmed.value.err === null, "PUBLICATION_FAILED");
  const published = await rpc.getAccountInfo(catalogAddress, "finalized");
  check(matches(published), "PUBLISHED_CATALOG_MISMATCH");
  return { ...result, status: "published", signature };
}

if (import.meta.main) {
  const [mode, adminPath, extra] = process.argv.slice(2);
  try {
    check(
      mode === undefined ||
        (mode === "--publish" && adminPath && extra === undefined),
      "USAGE",
    );
    process.stdout.write(
      `${JSON.stringify(await inspectCatalog(process.env, adminPath))}\n`,
    );
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "CATALOG_CHECK_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
