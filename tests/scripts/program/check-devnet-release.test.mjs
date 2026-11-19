import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { deployedBytes } from "../../../scripts/program/check-devnet-release.mjs";

const requireWeb = createRequire(
  new URL("../../../apps/web/package.json", import.meta.url),
);
const { PublicKey } = requireWeb("@solana/web3.js");
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const dataAddress = new PublicKey(new Uint8Array(32).fill(7));
const authority = new PublicKey(new Uint8Array(32).fill(9));
const bytes = Buffer.from("binary fixture");

test("release check binds executable, stored slot, authority and every deployed byte", () => {
  const entry = { owner: loader, executable: true, data: Buffer.alloc(36) };
  entry.data.writeUInt32LE(2);
  dataAddress.toBuffer().copy(entry.data, 4);
  const header = Buffer.alloc(45);
  header.writeUInt32LE(3);
  header.writeBigUInt64LE(451n, 4);
  header[12] = 1;
  authority.toBuffer().copy(header, 13);
  const data = {
    owner: loader,
    executable: false,
    data: Buffer.concat([header, bytes]),
  };
  const release = deployedBytes(entry, data, dataAddress, bytes);
  assert.equal(release.slot, "451");
  assert.equal(release.bytes, bytes.length);
  assert.equal(release.upgradeAuthority, authority.toBase58());
  assert.throws(
    () =>
      deployedBytes({ ...entry, executable: false }, data, dataAddress, bytes),
    /INVALID_PROGRAM_ACCOUNT/,
  );
  assert.throws(
    () => deployedBytes(entry, data, authority, bytes),
    /INVALID_PROGRAM_ACCOUNT/,
  );
  assert.throws(
    () =>
      deployedBytes(entry, { ...data, owner: authority }, dataAddress, bytes),
    /INVALID_PROGRAM_DATA/,
  );
  assert.throws(
    () =>
      deployedBytes(
        entry,
        data,
        dataAddress,
        Buffer.concat([bytes, Buffer.of(0)]),
      ),
    /DEPLOYED_BUILD_MISMATCH/,
  );
});
