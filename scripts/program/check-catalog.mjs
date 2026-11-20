import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CATALOG_V1 } from "../../apps/web/lib/game/catalog.ts";
import { rpcConfigSchema } from "../../apps/web/lib/providers/config.ts";
import { DEVNET } from "../../apps/web/lib/solana/addresses.ts";
import { PURRPS_GAME_IDL } from "../../apps/web/lib/solana/purrps-game.ts";
import { checkGameAssets } from "../assets/check-assets.mjs";
import { check, requireWeb } from "./run-sponsor-state.mjs";

const { BN, BorshCoder, convertIdlToCamelCase } =
  requireWeb("@anchor-lang/core");
const {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} = requireWeb("@solana/web3.js");
const program = new PublicKey(DEVNET.program);
const coder = new BorshCoder(convertIdlToCamelCase(PURRPS_GAME_IDL));
const publicDir = fileURLToPath(
  new URL("../../apps/web/public", import.meta.url),
);
const pda = (seed, ...parts) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...parts], program)[0];
const configAddress = pda("game-config");
const versionBytes = Buffer.from([1, 0, 0, 0]);
const catalogAddress = pda("catalog", versionBytes);

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
    version: 1,
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

async function inspectCatalog(env) {
  const media = await checkGameAssets(publicDir, 1);
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
      record.binding.version === 1 &&
      Buffer.from(record.binding.contentHash).toString("hex") ===
        expectedHash &&
      record.assetManifest.version === 1 &&
      Buffer.from(record.assetManifest.contentHash).toString("hex") ===
        media.binding.contentHash
    );
  };
  const result = {
    catalog: catalogAddress.toBase58(),
    assetManifest: media.binding,
    catalogHash: expectedHash,
  };
  if (config.catalog !== null) {
    check(
      config.catalog.version === 1 &&
        Buffer.from(config.catalog.contentHash).toString("hex") ===
          expectedHash &&
        matches(current),
      "CATALOG_ALREADY_PUBLISHED_WITH_DIFFERENT_BINDING",
    );
    return { ...result, status: "published" };
  }
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
      args: { expectedCurrentVersion: 0, catalog, assetManifest },
    }),
  });
  const { blockhash } = await rpc.getLatestBlockhash("finalized");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: config.admin,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message(),
  );
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
  return {
    ...result,
    status: "simulated",
    slot: context.slot,
    computeUnits: value.unitsConsumed,
  };
}

if (import.meta.main) {
  try {
    process.stdout.write(
      `${JSON.stringify(await inspectCatalog(process.env))}\n`,
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
