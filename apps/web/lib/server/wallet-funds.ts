import "server-only";

import {
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import { type Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { DEVNET } from "../solana/addresses";
import { ApiError } from "./runtime";

const mint = new PublicKey(DEVNET.usdcMint);
const tokenProgram = new PublicKey(DEVNET.tokenProgram);

export async function readWalletFunds(rpc: Connection, owner: PublicKey) {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
  const { context, value } = await rpc.getMultipleAccountsInfoAndContext(
    [owner, ata],
    { commitment: "finalized" },
  );
  const [account, token] = value;
  const lamports = account?.lamports ?? 0;
  if (value.length !== 2 || !Number.isSafeInteger(lamports) || lamports < 0)
    throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
  let amount = 0n;
  if (
    token &&
    !(
      token.owner.equals(SystemProgram.programId) &&
      token.data.length === 0 &&
      !token.executable
    )
  ) {
    try {
      if (token.executable) throw new Error("INVALID_TOKEN_ACCOUNT");
      const usdc = unpackAccount(ata, token, tokenProgram);
      if (
        !usdc.mint.equals(mint) ||
        !usdc.owner.equals(owner) ||
        !usdc.isInitialized
      )
        throw new Error("INVALID_TOKEN_ACCOUNT");
      amount = usdc.amount;
    } catch {
      throw new ApiError("INVALID_CHAIN_ACCOUNT", 502);
    }
  }
  return {
    slot: context.slot,
    solLamports: lamports.toString(),
    usdcBaseUnits: amount.toString(),
  };
}
