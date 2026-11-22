"use client";

import { useState } from "react";
import { displaySol, displayUsdc, parseUsdc } from "../lib/game/custody-client";
import { readWallet, useFinalized } from "./account-data";

function Amount({
  value,
  unit,
}: {
  readonly value: string | undefined;
  readonly unit: string;
}) {
  return value === undefined ? (
    <span className="lobby-skeleton" />
  ) : (
    <>
      {value} {unit}
    </>
  );
}

export default function WalletPanel({
  revision,
  blocked,
  transfer,
}: {
  readonly revision: number | undefined;
  readonly blocked: boolean;
  readonly transfer: (
    kind: "deposit" | "withdraw",
    amount: string,
  ) => Promise<void>;
}) {
  const { value, failed, retry } = useFinalized(revision, readWallet);
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const credits = value?.credits ?? undefined;
  const funds = value?.funds;
  const usdc = (raw: string | undefined) =>
    raw === undefined ? undefined : displayUsdc(raw);

  function move(kind: "deposit" | "withdraw") {
    let units: bigint;
    try {
      units = parseUsdc(amount);
    } catch {
      setProblem("Enter a positive USDC amount with up to six decimals.");
      return;
    }
    const limit =
      kind === "deposit"
        ? BigInt(funds?.usdcBaseUnits ?? "0")
        : BigInt(credits?.availableBaseUnits ?? "0");
    if (units > limit) {
      setProblem(
        kind === "deposit"
          ? "That is more USDC than your wallet holds."
          : "That is more than your available PURRPS balance.",
      );
      return;
    }
    setProblem(null);
    void transfer(kind, units.toString()).then(() => setAmount(""));
  }

  return (
    <div className="lobby-section">
      <header className="lobby-section-head">
        <h2>Wallet</h2>
      </header>
      {failed && value === null ? (
        <div className="lobby-empty">
          <p>Balances could not be read.</p>
          <button type="button" className="pixel-button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="lobby-columns">
            <section className="lobby-stats" aria-label="In PURRPS">
              <h3>In PURRPS</h3>
              <dl>
                <div>
                  <dt>Available</dt>
                  <dd>
                    <Amount
                      value={usdc(credits?.availableBaseUnits)}
                      unit="USDC"
                    />
                  </dd>
                </div>
                <div>
                  <dt>In play</dt>
                  <dd>
                    <Amount
                      value={usdc(credits?.lockedStakeBaseUnits)}
                      unit="USDC"
                    />
                  </dd>
                </div>
                <div>
                  <dt>Pending purchases</dt>
                  <dd>
                    <Amount
                      value={usdc(credits?.purchaseEscrowBaseUnits)}
                      unit="USDC"
                    />
                  </dd>
                </div>
              </dl>
            </section>
            <section className="lobby-stats" aria-label="Your wallet">
              <h3>Your wallet</h3>
              <dl>
                <div>
                  <dt>SOL</dt>
                  <dd>
                    <Amount
                      value={funds && displaySol(funds.solLamports)}
                      unit="SOL"
                    />
                  </dd>
                </div>
                <div>
                  <dt>USDC</dt>
                  <dd>
                    <Amount value={usdc(funds?.usdcBaseUnits)} unit="USDC" />
                  </dd>
                </div>
              </dl>
            </section>
          </div>
          <form
            className="lobby-transfer"
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="transfer-amount">Amount (Devnet USDC)</label>
            <div className="lobby-transfer-row">
              <input
                id="transfer-amount"
                inputMode="decimal"
                autoComplete="off"
                maxLength={21}
                value={amount}
                aria-invalid={problem !== null}
                aria-describedby={problem ? "transfer-problem" : undefined}
                onChange={(event) => setAmount(event.target.value)}
                disabled={blocked}
              />
              <button
                type="button"
                className="pixel-button"
                data-tone="gold"
                disabled={!amount || blocked || value === null}
                onClick={() => move("deposit")}
              >
                Deposit
              </button>
              <button
                type="button"
                className="pixel-button"
                disabled={!amount || blocked || value === null}
                onClick={() => move("withdraw")}
              >
                Withdraw
              </button>
            </div>
            {problem && (
              <p id="transfer-problem" role="alert" className="lobby-problem">
                {problem}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}
