import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
} from "node:crypto";
import { createRequire } from "node:module";
import { validatePreparedTransaction } from "../../../apps/web/lib/game/transaction-intents.ts";
import { readWebJson } from "../../../apps/web/lib/game/web-api.ts";
import { DEVNET } from "../../../apps/web/lib/solana/addresses.ts";

const require = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { PublicKey, VersionedTransaction } = require("@solana/web3.js");
const target = process.argv[2];
const expectedSponsor = process.env.SPONSOR_PUBLIC_KEY;
let cookie;

async function call(path, body, expected, origin = target) {
  const post = body !== undefined;
  const response = await fetch(new URL(path, target), {
    method: post ? "POST" : "GET",
    headers: {
      ...(post ? { Origin: origin, "Content-Type": "application/json" } : {}),
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    ...(post ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  let value;
  try {
    value = await readWebJson(response);
  } catch {
    throw new Error(`${path}: HTTP ${response.status} without JSON`);
  }
  if (
    response.status !== expected ||
    !response.headers.get("cache-control")?.includes("no-store")
  ) {
    const code =
      typeof value?.error === "string" && /^[A-Z_]{1,72}$/.test(value.error)
        ? value.error
        : "UNEXPECTED_RESPONSE";
    throw new Error(`${path}: HTTP ${response.status} ${code}`);
  }
  return { value, headers: response.headers };
}

async function verify() {
  const url = new URL(target);
  if (url.protocol !== "https:" || url.origin !== target)
    throw new Error("Use the exact HTTPS origin without a path.");
  if (
    !expectedSponsor ||
    new PublicKey(expectedSponsor).toBase58() !== expectedSponsor
  )
    throw new Error("Set the expected SPONSOR_PUBLIC_KEY for this check.");
  const secret = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      randomBytes(32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const owner = new PublicKey(
    createPublicKey(secret)
      .export({ format: "der", type: "spki" })
      .subarray(-32),
  );
  const wallet = owner.toBase58();
  await call("/api/auth/challenge", { wallet }, 403, "https://example.invalid");
  await call("/api/auth/session", undefined, 401);
  const { value: c } = await call("/api/auth/challenge", { wallet }, 200);
  if (!/^[0-9a-f]{64}$/.test(c?.challengeId) || typeof c.message !== "string")
    throw new Error("Invalid challenge.");
  const issued = c.message.match(/\nIssued At: ([^\n]+)\n/)?.[1];
  const expected = `${url.host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to PURRPS. This does not authorize transactions.\n\nURI: ${target}\nVersion: 1\nChain ID: solana:devnet\nNonce: ${c.challengeId}\nIssued At: ${issued}\nExpiration Time: ${c.expiresAt}`;
  if (
    c.message !== expected ||
    Date.parse(c.expiresAt) - Date.parse(issued) !== 300000
  )
    throw new Error("Challenge is not bound to this site, wallet and expiry.");
  const signed = {
    challengeId: c.challengeId,
    signature: sign(null, Buffer.from(c.message), secret).toString("base64"),
  };
  const verified = await call("/api/auth/verify", signed, 200);
  const cookieHeader = verified.headers.get("set-cookie");
  cookie = cookieHeader?.split(";")[0];
  try {
    if (
      !cookie ||
      !/^__Host-purrps-session=[A-Za-z0-9_-]{43}$/.test(cookie) ||
      ![
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Strict",
        "Max-Age=43200",
      ].every((flag) => cookieHeader.includes(flag))
    )
      throw new Error("Invalid session cookie.");
    const intent = { operation: "createPlayer", sponsored: true };
    const [session, , state, genesis, , prepared] = await Promise.all([
      call("/api/auth/session", undefined, 200),
      call("/api/auth/verify", signed, 401),
      call("/api/chain/state", { kind: "wallet" }, 200),
      call(
        "/api/rpc/devnet",
        { jsonrpc: "2.0", id: 1, method: "getGenesisHash" },
        200,
      ),
      call(
        "/api/rpc/devnet",
        { jsonrpc: "2.0", id: 2, method: "getBalance", params: [wallet] },
        400,
      ),
      call("/api/tx/prepare", intent, 200),
    ]);
    if (
      verified.value.wallet !== wallet ||
      session.value.wallet !== wallet ||
      genesis.value.result !== DEVNET.genesisHash ||
      state.value.commitment !== "finalized" ||
      !Number.isSafeInteger(state.value.slot)
    )
      throw new Error("Incorrect hosted wallet or chain state.");
    const program = new PublicKey(DEVNET.program);
    const names = ["game-config", "player", "collection", "house"];
    for (const [index, name] of names.entries()) {
      const seeds = [
        Buffer.from(name),
        ...(["player", "collection"].includes(name) ? [owner.toBuffer()] : []),
      ];
      const expected = PublicKey.findProgramAddressSync(
        seeds,
        program,
      )[0].toBase58();
      const record = state.value.accounts?.[index];
      if (
        record?.address !== expected ||
        (record.account !== null && record.account?.owner !== DEVNET.program)
      )
        throw new Error("Hosted read returned a wrong account.");
    }
    const bytes = Buffer.from(prepared.value.transaction, "base64");
    if (bytes.length > 1232)
      throw new Error("Prepared transaction is oversized.");
    const tx = VersionedTransaction.deserialize(bytes);
    validatePreparedTransaction(tx, wallet, intent);
    if (tx.signatures.some((signature) => signature.some((byte) => byte !== 0)))
      throw new Error("Preparation returned a signed transaction.");
    const sponsor = tx.message.staticAccountKeys[0].toBase58();
    return {
      status: sponsor === expectedSponsor ? "passed" : "sponsor_mismatch",
      origin: target,
      slot: state.value.slot,
      configInitialized: state.value.accounts[0].account !== null,
      houseInitialized: state.value.accounts[3].account !== null,
      sponsor,
      expectedSponsor,
      transaction: "prepared_only",
    };
  } finally {
    if (cookie) {
      await call("/api/auth/logout", {}, 200);
      await call("/api/auth/session", undefined, 401);
    }
  }
}

try {
  const result = await verify();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const safeMessage = /^[a-zA-Z0-9 ./_:,-]{1,140}$/.test(message)
    ? message
    : "Hosted check failed.";
  process.stderr.write(`${safeMessage}\n`);
  process.exitCode = 1;
}
