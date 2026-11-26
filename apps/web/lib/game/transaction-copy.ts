import type { PlayerIntent } from "./custody-client";
import { displayUsdc } from "./custody-client";
import type { DeviceIntent } from "./device-intents";
import { CAT_NAMES } from "./lobby-state";
import type { LobbyIntent } from "./transaction-intents";

// Plain-language toast lines for each step of a wallet transaction
// (2026-11-24): what is being prepared, approved and confirmed, then the
// finalized result.
export type TransactionCopy = {
  readonly preparing: string;
  readonly approve: string;
  readonly confirming: string;
  readonly done: string;
};

export function transactionCopy(
  intent: LobbyIntent | PlayerIntent | DeviceIntent,
): TransactionCopy {
  const steps = (thing: string, done: string): TransactionCopy => ({
    preparing: `Preparing your ${thing}…`,
    approve: `Approve the ${thing} in your wallet`,
    confirming: `Confirming your ${thing}…`,
    done,
  });
  switch (intent.operation) {
    case "createPlayer":
      return steps("account", "Your account is ready");
    case "claimStarter":
      return steps("starter cat", "Your starter cat is on its way");
    case "selectCat":
      return steps("cat choice", `${CAT_NAMES[intent.cat]} selected`);
    case "depositWithDevice":
      return steps("deposit", `Deposited ${displayUsdc(intent.amount)} USDC`);
    case "setGameDevice":
      return intent.device
        ? steps("browser access", "Browser enabled")
        : steps("revocation", "Browser access revoked");
    case "withdrawWithDevice":
      return steps("withdrawal", `Withdrew ${displayUsdc(intent.amount)} USDC`);
    case "game": {
      const action = intent.action;
      switch (action.kind) {
        case "deposit":
          return steps(
            "deposit",
            `Deposited ${displayUsdc(action.amount)} USDC`,
          );
        case "withdraw":
          return steps(
            "withdrawal",
            `Withdrew ${displayUsdc(action.amount)} USDC`,
          );
        case "purchaseCapsule":
          return steps(
            action.capsule === "paidCat" ? "cat capsule" : "upgrade capsule",
            "Capsule bought",
          );
        case "refundCapsule":
          return steps("refund", "Capsule refunded");
        case "applyUpgrade":
          return steps("upgrade", `${CAT_NAMES[action.cat]} upgraded`);
        default: {
          const never: never = action;
          return never;
        }
      }
    }
    default: {
      const never: never = intent;
      return never;
    }
  }
}
