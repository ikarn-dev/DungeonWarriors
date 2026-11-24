import type { useWallet } from "@solana/wallet-adapter-react";
import type { ReactNode } from "react";
import type { LobbyState } from "../lib/game/lobby-state";
import DotsLoader from "./DotsLoader";

// The single next step before the lobby menu opens: connect (in the wallet
// pop-up), sign in (prompted automatically), create the player account, then
// claim the free starter cat.
export default function LobbyStart({
  wallet,
  busy,
  blocked,
  restoring,
  authenticated,
  restoreFailed,
  state,
  gettingCat,
  onPickWallet,
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
  readonly onPickWallet: () => void;
  readonly onSignIn: () => void;
  readonly onCreatePlayer: () => void;
  readonly onClaimStarter: () => void;
}) {
  let body: ReactNode;
  // Waiting states show only the loader, without the panel around it.
  let waiting = false;
  if (!wallet.connected)
    body = wallet.connecting ? (
      ((waiting = true), <DotsLoader label="Connecting your wallet" />)
    ) : (
      <>
        <p>Connect a Solana wallet to enter the catacombs.</p>
        <button
          type="button"
          className="pixel-button"
          data-tone="gold"
          onClick={onPickWallet}
        >
          Connect wallet
        </button>
      </>
    );
  else if (restoring) body = <DotsLoader label="Connecting" />;
  else if (!authenticated)
    body =
      busy && !restoreFailed ? (
        <>
          <DotsLoader label="Waiting for your wallet" />
          <p>Approve the sign-in message in your wallet.</p>
        </>
      ) : (
        <>
          <p>
            {restoreFailed
              ? "PURRPS couldn't reach your session."
              : "Your wallet didn't sign in."}
          </p>
          <button
            type="button"
            className="pixel-button"
            data-tone="gold"
            disabled={
              busy || (!restoreFailed && wallet.signMessage === undefined)
            }
            onClick={onSignIn}
          >
            Try again
          </button>
        </>
      );
  else if (state === null) body = <DotsLoader label="Loading your cats" />;
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
