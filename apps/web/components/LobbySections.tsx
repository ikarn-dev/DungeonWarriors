import type { VersionedTransaction } from "@solana/web3.js";
import type { ComponentProps } from "react";
import { useState } from "react";
import type { CatId } from "../lib/game/catalog";
import type { PlayerIntent } from "../lib/game/custody-client";
import type { LobbyState } from "../lib/game/lobby-state";
import type { LobbyIntent } from "../lib/game/transaction-intents";
import CapsuleShop from "./CapsuleShop";
import CatCollection from "./CatCollection";
import DungeonEntry from "./DungeonEntry";
import DungeonHistory from "./DungeonHistory";
import LeaderboardPanel from "./LeaderboardPanel";
import { LobbyHero, LobbyMenu, type LobbyTab } from "./LobbyMenu";
import WalletPanel from "./WalletPanel";

type Work = (fn: (signal: AbortSignal) => Promise<void>) => Promise<void>;

// The signed-in lobby: one menu entry and one panel per player task.
export default function LobbySections({
  state,
  address,
  sign,
  blocked,
  accountRevision,
  shopDraw,
  tab,
  setTab,
  perform,
  transact,
  reload,
}: {
  readonly state: LobbyState;
  readonly address: string;
  readonly sign:
    | ((tx: VersionedTransaction) => Promise<VersionedTransaction>)
    | undefined;
  readonly blocked: boolean;
  readonly accountRevision: number | undefined;
  readonly shopDraw: Pick<
    ComponentProps<typeof CapsuleShop>,
    "receipt" | "retryDraw" | "onViewDraw"
  >;
  readonly tab: LobbyTab;
  readonly setTab: (tab: LobbyTab) => void;
  readonly perform: Work;
  readonly transact: (
    intent: LobbyIntent | PlayerIntent,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly reload: (signal: AbortSignal) => Promise<void>;
}) {
  const [preferred, setPreferred] = useState<CatId | null>(null);
  const selected =
    state.cats.find(({ id }) => id === (preferred ?? state.selected)) ??
    state.cats[0] ??
    null;
  const game = (action: PlayerIntent["action"]) =>
    void perform((signal) =>
      transact({ operation: "game", sponsored: false, action }, signal),
    );
  return (
    <LobbyMenu
      tab={tab}
      onTab={setTab}
      cursor={selected?.id ?? state.selected}
      panels={{
        play: (
          <>
            {selected && <LobbyHero cat={selected} />}
            {selected && (
              <DungeonEntry
                key={address}
                state={state}
                cat={selected.id}
                wallet={address}
                blocked={blocked}
                sign={sign}
                refresh={reload}
              />
            )}
          </>
        ),
        cats: (
          <>
            <CatCollection
              state={state}
              selected={selected?.id ?? null}
              blocked={blocked}
              onSelect={setPreferred}
            />
          </>
        ),
        shop: (
          <CapsuleShop
            key={`shop:${address}`}
            state={state}
            blocked={blocked}
            action={game}
            {...shopDraw}
          />
        ),
        wallet: (
          <WalletPanel
            key={`wallet:${address}`}
            revision={tab === "wallet" ? accountRevision : undefined}
            blocked={blocked}
            transfer={(kind, amount) =>
              perform((signal) =>
                transact(
                  {
                    operation: "game",
                    sponsored: false,
                    action: { kind, amount },
                  },
                  signal,
                ),
              )
            }
          />
        ),
        history: (
          <DungeonHistory
            key={`history:${address}`}
            revision={tab === "history" ? accountRevision : undefined}
          />
        ),
        leaderboard: (
          <LeaderboardPanel
            key={`board:${address}`}
            wallet={address}
            revision={tab === "leaderboard" ? accountRevision : undefined}
          />
        ),
      }}
    />
  );
}
