"use client";

import { type ReactNode, useState } from "react";
import { displaySol, displayUsdc, parseUsdc } from "../lib/game/custody-client";
import { readWallet, useFinalized } from "./account-data";
import DotsLoader from "./DotsLoader";
import { type WalletIcon, WarriorIcon } from "./WarriorIcon";

// A figure and its unit; a skeleton until the finalized read arrives.
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
      {value} <span className="vault-unit">{unit}</span>
    </>
  );
}
function Row({
  icon,
  label,
  children,
}: {
  readonly icon: WalletIcon;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <dt>
        <WarriorIcon name={icon} />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
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
  // The transfer in progress; its button shows the loader beside its label.
  const [active, setActive] = useState<"deposit" | "withdraw" | null>(null);
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
    setActive(kind);
    void transfer(kind, units.toString())
      .then(() => setAmount(""))
      .finally(() => setActive(null));
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
          <div className="vault-grid">
            <section className="vault-card" aria-labelledby="vault-purrps">
              <h3 id="vault-purrps" className="vault-head">
                <span className="vault-mark" aria-hidden="true">
                  <WarriorIcon name="chest" />
                </span>
                In PURRPS
              </h3>
              <p className="vault-figure">
                <span>Available</span>
                <strong>
                  <Amount
                    value={usdc(credits?.availableBaseUnits)}
                    unit="USDC"
                  />
                </strong>
              </p>
              <dl className="vault-rows">
                <Row icon="lock" label="In play">
                  <Amount
                    value={usdc(credits?.lockedStakeBaseUnits)}
                    unit="USDC"
                  />
                </Row>
                <Row icon="bag" label="Pending purchases">
                  <Amount
                    value={usdc(credits?.purchaseEscrowBaseUnits)}
                    unit="USDC"
                  />
                </Row>
              </dl>
            </section>
            <section className="vault-card" aria-labelledby="vault-wallet">
              <h3 id="vault-wallet" className="vault-head">
                <span className="vault-mark" aria-hidden="true">
                  <WarriorIcon name="purse" />
                </span>
                Your wallet
              </h3>
              <p className="vault-figure">
                <span>USDC</span>
                <strong>
                  <Amount value={usdc(funds?.usdcBaseUnits)} unit="USDC" />
                </strong>
              </p>
              <dl className="vault-rows">
                <Row icon="gem" label="SOL">
                  <Amount
                    value={funds && displaySol(funds.solLamports)}
                    unit="SOL"
                  />
                </Row>
              </dl>
            </section>
          </div>
          <form
            className="vault-transfer"
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="transfer-amount">Amount</label>
            <div className="vault-transfer-row">
              <div className="bet-amount">
                <input
                  id="transfer-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  autoComplete="off"
                  maxLength={21}
                  value={amount}
                  aria-invalid={problem !== null}
                  aria-describedby={problem ? "transfer-problem" : undefined}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={blocked}
                />
                <span>USDC</span>
                {/* Fills the most a deposit can take: the wallet's USDC. */}
                <button
                  type="button"
                  className="vault-max"
                  title="Use your full wallet USDC balance"
                  disabled={
                    blocked || !funds || BigInt(funds.usdcBaseUnits) === 0n
                  }
                  onClick={() => {
                    if (!funds) return;
                    setAmount(displayUsdc(funds.usdcBaseUnits));
                    setProblem(null);
                  }}
                >
                  Max
                </button>
              </div>
              <button
                type="button"
                className="pixel-button"
                data-tone="gold"
                aria-busy={active === "deposit"}
                disabled={!amount || blocked || value === null}
                onClick={() => move("deposit")}
              >
                {active === "deposit" ? (
                  <DotsLoader label="Depositing" />
                ) : (
                  <WarriorIcon name="deposit" />
                )}
                Deposit
              </button>
              <button
                type="button"
                className="pixel-button"
                aria-busy={active === "withdraw"}
                disabled={!amount || blocked || value === null}
                onClick={() => move("withdraw")}
              >
                {active === "withdraw" ? (
                  <DotsLoader label="Withdrawing" />
                ) : (
                  <WarriorIcon name="withdraw" />
                )}
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
