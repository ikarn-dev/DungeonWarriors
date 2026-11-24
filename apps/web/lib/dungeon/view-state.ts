import type { DungeonView } from "./protocol";

const terminal = (view: DungeonView) =>
  ["won", "lost", "refunded", "cancelled"].includes(view.phase);
export function mergeDungeonView(
  prior: DungeonView | null,
  next: DungeonView | null,
  newApproval = false,
): DungeonView | null {
  if (!prior || !next) return next;
  if (BigInt(prior.nonce) > BigInt(next.nonce)) return prior;
  if (prior.nonce !== next.nonce) return next;
  if (next.serverNow < prior.serverNow) return prior;
  if (
    newApproval &&
    prior.phase === "cancelled" &&
    next.phase === "preparing" &&
    next.preparation
  )
    return next;
  if (
    (prior.settled && !next.settled) ||
    prior.gates.length > next.gates.length ||
    (terminal(prior) && !terminal(next))
  )
    return prior;
  return next;
}
