"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { displaySol, displayUsdc } from "../lib/game/custody-client";
import { webApi } from "../lib/game/web-api";

const rawAmount = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const response = z.object({
  commitment: z.literal("finalized"),
  walletFunds: z.strictObject({
    solLamports: rawAmount,
    usdcBaseUnits: rawAmount,
  }),
});
type Funds = z.infer<typeof response>["walletFunds"];

export default function WalletFunds({
  revision,
}: {
  revision: number | undefined;
}) {
  const [view, setView] = useState<{
    revision: number;
    funds: Funds | null;
  } | null>(null);
  useEffect(() => {
    if (revision === undefined) return;
    const controller = new AbortController();
    void webApi("/api/chain/state", { kind: "walletFunds" }, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setView({ revision, funds: response.parse(value).walletFunds });
      })
      .catch(() => {
        if (!controller.signal.aborted) setView({ revision, funds: null });
      });
    return () => controller.abort();
  }, [revision]);
  const current = view?.revision === revision ? view : null;
  return (
    <section
      aria-label="Devnet wallet balances"
      className="grid gap-2 rounded-md border border-[#cbd3be] p-3 text-sm"
    >
      <h2 className="font-semibold">Wallet balances</h2>
      {current === null ? (
        <output>Reading Devnet wallet balances…</output>
      ) : current.funds === null ? (
        <output>
          Wallet balances unavailable. Use Refresh account to retry.
        </output>
      ) : (
        <dl className="grid gap-2">
          <div className="flex flex-wrap justify-between gap-2">
            <dt>Wallet SOL</dt>
            <dd className="font-mono tabular-nums">
              {displaySol(current.funds.solLamports)} SOL
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt>Wallet USDC</dt>
            <dd className="font-mono tabular-nums">
              {displayUsdc(current.funds.usdcBaseUnits)} USDC
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
