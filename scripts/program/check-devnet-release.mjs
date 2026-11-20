import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { DEVNET } from "../../apps/web/lib/solana/addresses.ts";

const requireWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { BorshAccountsCoder } = requireWeb("@anchor-lang/core");
const { Connection, PublicKey } = requireWeb("@solana/web3.js");
const { getAssociatedTokenAddressSync } = requireWeb("@solana/spl-token");
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const program = new PublicKey(DEVNET.program);
const usdc = new PublicKey(DEVNET.usdcMint);
const tokenProgram = new PublicKey(DEVNET.tokenProgram);
const target = new URL(
  "../../apps/purrps-game-program/target/",
  import.meta.url,
);

function check(condition, code) {
  if (!condition) throw new Error(code);
}

function pda(seed) {
  return PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0];
}

export function deployedBytes(entry, data, dataAddress, artifact) {
  check(
    entry?.owner.equals(loader) &&
      entry.executable &&
      entry.data.length === 36 &&
      entry.data.readUInt32LE(0) === 2 &&
      new PublicKey(entry.data.subarray(4)).equals(dataAddress),
    "INVALID_PROGRAM_ACCOUNT",
  );
  check(
    data?.owner.equals(loader) &&
      !data.executable &&
      data.data.length >= 45 &&
      data.data.readUInt32LE(0) === 3 &&
      [0, 1].includes(data.data[12]),
    "INVALID_PROGRAM_DATA",
  );
  const bytes = data.data.subarray(45);
  check(
    bytes.subarray(0, artifact.length).equals(artifact) &&
      bytes.subarray(artifact.length).every((byte) => byte === 0),
    "DEPLOYED_BUILD_MISMATCH",
  );
  return {
    slot: data.data.readBigUInt64LE(4).toString(),
    bytes: artifact.length,
    allocatedBytes: bytes.length,
    sha256: createHash("sha256").update(artifact).digest("hex"),
    upgradeAuthority:
      data.data[12] === 1
        ? new PublicKey(data.data.subarray(13, 45)).toBase58()
        : null,
  };
}

async function verifyRelease(starterOpen) {
  const [artifact, idl, buildId] = await Promise.all([
    readFile(new URL("deploy/purrps_game.so", target)),
    readFile(new URL("idl/purrps_game.json", target), "utf8"),
    readFile(new URL("../../apps/web/.next/BUILD_ID", import.meta.url), "utf8"),
  ]);
  check(
    artifact.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])),
    "INVALID_LOCAL_SBF",
  );
  check(/^[\w-]{1,128}$/.test(buildId.trim()), "INVALID_WEB_BUILD");
  const layout = JSON.parse(idl);
  check(layout.address === DEVNET.program, "INVALID_LOCAL_IDL");
  const coder = new BorshAccountsCoder(layout);
  const rpc = new Connection("https://api.devnet.solana.com", "finalized", {
    disableRetryOnRateLimit: true,
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }),
  });
  check((await rpc.getGenesisHash()) === DEVNET.genesisHash, "WRONG_NETWORK");
  const [dataKey] = PublicKey.findProgramAddressSync(
    [program.toBuffer()],
    loader,
  );
  const configKey = pda("game-config");
  const houseKey = pda("house");
  const [entry, data, configAccount, houseAccount, policyAccount] =
    await rpc.getMultipleAccountsInfo([
      program,
      dataKey,
      configKey,
      houseKey,
      pda("sponsor-policy"),
    ]);
  const deployed = deployedBytes(entry, data, dataKey, artifact);
  for (const account of [configAccount, houseAccount, policyAccount]) {
    check(
      account?.owner.equals(program) && !account.executable,
      "INVALID_RELEASE_STATE",
    );
  }
  const c = coder.decode("GameConfig", configAccount.data);
  const h = coder.decode("HouseState", houseAccount.data);
  const policy = coder.decode("SponsorPolicy", policyAccount.data);
  check(
    (starterOpen
      ? c.allow_starter && c.catalog?.version > 0
      : !c.allow_starter) &&
      !c.allow_purchases &&
      !c.allow_reservations &&
      policy.paused,
    starterOpen ? "UNEXPECTED_ADMISSION_STATE" : "ADMISSION_ENABLED",
  );
  check(
    c.schema_version === 1 &&
      c.rules?.version > 0 &&
      c.usdc_mint.equals(usdc) &&
      c.token_program.equals(tokenProgram) &&
      c.usdc_decimals === 6 &&
      h.config.equals(configKey) &&
      h.usdc_mint.equals(usdc) &&
      h.vault.equals(
        getAssociatedTokenAddressSync(usdc, houseKey, true, tokenProgram),
      ) &&
      policy.config.equals(configKey),
    "INVALID_RELEASE_STATE",
  );
  const version = Buffer.alloc(4);
  version.writeUInt32LE(c.rules.version);
  const [ruleKey] = PublicKey.findProgramAddressSync(
    [Buffer.from("rules"), version],
    program,
  );
  const [rulesAccount, vault, sponsor, admin] = await Promise.all([
    rpc.getAccountInfo(ruleKey),
    rpc.getTokenAccountBalance(h.vault),
    rpc.getBalance(policy.authority),
    deployed.upgradeAuthority === null
      ? Promise.resolve(null)
      : rpc.getBalance(new PublicKey(deployed.upgradeAuthority)),
  ]);
  check(rulesAccount?.owner.equals(program), "INVALID_RELEASE_STATE");
  const rules = coder.decode("GameRulesVersion", rulesAccount.data);
  check(
    rules.binding.version === c.rules.version &&
      Buffer.from(rules.binding.content_hash).equals(
        Buffer.from(c.rules.content_hash),
      ),
    "INVALID_RELEASE_STATE",
  );
  const liability = [
    h.total_available_base_units,
    h.total_purchase_escrow_base_units,
    h.total_max_gross_base_units,
    h.buffer_base_units,
  ].reduce((sum, value) => sum + BigInt(value.toString()), 0n);
  check(
    vault.value.decimals === 6 && BigInt(vault.value.amount) >= liability,
    "VAULT_SHORTFALL",
  );
  return {
    deployed,
    localWebBuildId: buildId.trim(),
    rules: c.rules.version,
    catalog: c.catalog?.version ?? null,
    admission: starterOpen ? "starter_only" : "closed",
    vaultBaseUnits: vault.value.amount,
    obligationsWithBufferBaseUnits: liability.toString(),
    vaultHeadroomBaseUnits: (BigInt(vault.value.amount) - liability).toString(),
    sponsorLamports: String(sponsor),
    upgradeAuthorityLamports: admin === null ? null : String(admin),
  };
}

if (import.meta.main) {
  try {
    const release = await verifyRelease(
      process.argv.includes("--starter-open"),
    );
    process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "DEVNET_RELEASE_CHECK_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
