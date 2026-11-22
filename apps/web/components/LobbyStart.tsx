import type { useWallet } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";
import type { LobbyState } from "../lib/game/lobby-state";
import { WalletPicker } from "./LobbyWallet";

// The single next step before the lobby menu opens: connect, sign in,
// create the player account, then claim the free starter cat.
export default function LobbyStart({
  wallet,
  busy,
  blocked,
  restoring,
  authenticated,
  restoreFailed,
  state,
  gettingCat,
  onConnect,
  onSignIn,
  onCreatePlayer,
  onClaimStarter,
}: {
  readonly wallet: ReturnType<typeof useWallet>;
  readonly busy: boolean;
  readonly blocked: boolean;
  readonly restoring: boolean;
  readonly authenticated: boolean;
  readonly restoreFailed: boolean;
  readonly state: LobbyState | null;
  readonly gettingCat: boolean;
  readonly onConnect: () => void;
  readonly onSignIn: () => void;
  readonly onCreatePlayer: () => void;
  readonly onClaimStarter: () => void;
}) {
  let body: ReactNode;
  if (!wallet.connected)
    body = <WalletPicker wallet={wallet} busy={busy} onConnect={onConnect} />;
  else if (restoring) body = <p>Restoring your session…</p>;
  else if (!authenticated)
    body = (
      <button
        type="button"
        className="pixel-button"
        data-tone="gold"
        disabled={busy || (!restoreFailed && wallet.signMessage === undefined)}
        onClick={onSignIn}
      >
        {restoreFailed ? "Retry session" : "Sign in to PURRPS"}
      </button>
    );
  else if (state === null) body = <p>Loading your finalized collection…</p>;
  else if (!state.configured)
    body = <p>Devnet configuration has not been published yet.</p>;
  else if (!state.hasPlayer)
    body = (
      <>
        <p>Create your player account. The app pays the Devnet fees.</p>
        <button
          type="button"
          className="pixel-button"
          data-tone="gold"
          disabled={blocked}
          onClick={onCreatePlayer}
        >
          Create player
        </button>
      </>
    );
  else if (state.starter === "unclaimed")
    body = (
      <>
        <p>
          Get your first cat free. One per wallet; the app pays the Devnet fees.
        </p>
        <button
          type="button"
          className="pixel-button"
          data-tone="gold"
          disabled={
            blocked || !state.allowStarter || state.catalogVersion === null
          }
          onClick={onClaimStarter}
        >
          {gettingCat ? "Getting your cat…" : "Get starter cat"}
        </button>
        {(!state.allowStarter || state.catalogVersion === null) && (
          <p>
            {state.catalogVersion === null
              ? "Starter cats open after the Devnet catalog is published."
              : "Starter cats are paused on Devnet."}
          </p>
        )}
      </>
    );
  else
    body = (
      <>
        <p>Your starter cat is on its way. Refreshing will not change it.</p>
        {state.pendingDraw !== null && (
          <a
            className="lobby-link"
            href={`https://explorer.solana.com/address/${state.pendingDraw}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            View on Solana Explorer
          </a>
        )}
      </>
    );
  return (
    <section className="lobby-start pixel-panel" aria-label="Get started">
      {body}
    </section>
  );
}
