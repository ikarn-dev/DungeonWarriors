import { readFileSync } from "node:fs";
import { BN, type IdlAccounts } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { DUNGEON_V3 } from "../../../../../apps/web/lib/dungeon/rules";
import { runAddresses } from "../../../../../apps/web/lib/game/run-accounts";
import { coder, pda } from "../../../../../apps/web/lib/server/chain";
import { DEVNET } from "../../../../../apps/web/lib/solana/addresses";
import type { DungeonWarriors } from "../../../../../apps/web/lib/solana/dungeon-warriors";

export const owner = Keypair.generate().publicKey;
export const wallet = owner.toBase58();
const playerSeed = [Buffer.from("player"), owner.toBytes()];
export const program = new PublicKey(DEVNET.program);
export const playerAddress = pda("player", owner.toBytes());
export const slot = 200;
export type Accounts = IdlAccounts<DungeonWarriors>;

export async function player(
  nextRunNonce = "10",
  overrides: Partial<Accounts["playerAccount"]> = {},
) {
  return {
    owner: program,
    data: await coder.accounts.encode("playerAccount", {
      schemaVersion: 1,
      bump: PublicKey.findProgramAddressSync(playerSeed, program)[1],
      owner,
      availableBaseUnits: new BN("9007199254740993"),
      lockedStakeBaseUnits: new BN("4000000"),
      purchaseEscrowBaseUnits: new BN("2000000"),
      nextRunNonce: new BN(nextRunNonce),
      nextDrawNonce: new BN(0),
      nextSessionNonce: new BN(0),
      settledRuns: new BN(3),
      wins: new BN(1),
      losses: new BN(1),
      technicalRefunds: new BN(1),
      ...overrides,
    }),
    executable: false,
    lamports: 1_000_000,
  };
}

export const noData = {
  owner: SystemProgram.programId,
  data: Buffer.alloc(0),
  executable: false,
  lamports: 1,
};

export async function result(
  nonce: bigint,
  refund = false,
  aliases: Partial<Accounts["resultReceipt"]> = {},
) {
  const addresses = runAddresses({ owner: wallet, nonce });
  const path = new URL(
    "../../../../fixtures/run-delivery/terminal.hex",
    import.meta.url,
  );
  const fixture = coder.accounts.decode<Accounts["runGameState"]>(
    "runGameState",
    Buffer.from(readFileSync(path, "utf8").trim(), "hex"),
  );
  return {
    owner: program,
    data: await coder.accounts.encode("resultReceipt", {
      schemaVersion: 1,
      bump: addresses.receipt[1],
      run: addresses.run[0],
      owner,
      nonce: new BN(nonce.toString()),
      market: { sol: {} },
      snapshotHash: fixture.snapshotHash,
      rules: fixture.snapshot.rulesBinding,
      cat: fixture.snapshot.cat,
      oracle: fixture.snapshot.oracle,
      startObservation: null,
      stakeBaseUnits: new BN("1000000"),
      terminal: {
        ...fixture.terminal,
        reason: refund ? { technicalAbort: {} } : { cashOut: {} },
        score: new BN(22),
        refundBaseUnits: new BN(refund ? "1000000" : "0"),
        grossPayoutBaseUnits: new BN(refund ? "0" : "1100000"),
      },
      settledAtSeconds: new BN(1_700_000_000),
      settledAtSlot: new BN(slot - 1),
      ...aliases,
    }),
    executable: false,
    lamports: 1_000_000,
  };
}

export async function dungeon(
  nonce: bigint,
  aliases: Partial<Accounts["dungeonExpedition"]> = {},
) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(nonce);
  const [, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("expedition"), owner.toBytes(), bytes],
    program,
  );
  return {
    owner: program,
    executable: false,
    lamports: 1000000,
    data: await coder.accounts.encode("dungeonExpedition", {
      schemaVersion: 1,
      bump,
      owner,
      nonce: new BN(nonce.toString()),
      cat: { collector: {} },
      verifier: owner,
      rules: DUNGEON_V3,
      rulesHash: Array(32).fill(0),
      stake: new BN(1000000),
      maxRooms: 5,
      maxGross: new BN(7214062),
      commitment: Array(32).fill(0),
      vrfProgram: owner,
      vrfQueue: owner,
      callbackAuthority: owner,
      requestSeed: Array(32).fill(0),
      requestedAt: new BN(100),
      randomnessDeadline: new BN(400),
      randomness: null,
      status: { ready: {} },
      secret: null,
      gates: Array(5).fill(255),
      gateCount: 0,
      cleared: 0,
      payout: new BN(0),
      completedAt: null,
      ...aliases,
    }),
  };
}
