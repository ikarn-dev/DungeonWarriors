import type { VersionedTransaction } from "@solana/web3.js";
import type { PlayerIntent } from "../lib/game/custody-client";
import type { LobbyState } from "../lib/game/lobby-state";
import type { LobbyIntent } from "../lib/game/transaction-intents";
import CapsuleShop from "./CapsuleShop";
import CatCollection from "./CatCollection";
import CatUpgrades from "./CatUpgrades";
import HistoryPanel from "./HistoryPanel";
import LeaderboardPanel from "./LeaderboardPanel";
import { LobbyHero, LobbyMenu, type LobbyTab } from "./LobbyMenu";
import RunEntry from "./RunEntry";
import WalletPanel from "./WalletPanel";

type Work = (fn: (signal: AbortSignal) => Promise<void>) => Promise<void>;

// The signed-in lobby: one menu entry and one panel per player task.
export default function LobbySections({
  state,
  address,
  sign,
  blocked,
  accountRevision,
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
  readonly tab: LobbyTab;
  readonly setTab: (tab: LobbyTab) => void;
  readonly perform: Work;
  readonly transact: (
    intent: LobbyIntent | PlayerIntent,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly reload: (signal: AbortSignal) => Promise<void>;
}) {
  const selected = state.cats.find(({ id }) => id === state.selected) ?? null;
  const reloadSoon = () => void perform((signal) => reload(signal));
  const game = (action: PlayerIntent["action"]) =>
    void perform((signal) =>
      transact({ operation: "game", sponsored: false, action }, signal),
    );
  return (
    <LobbyMenu
      tab={tab}
      onTab={setTab}
      cursor={state.selected}
      panels={{
        play: (
          <>
            {selected && <LobbyHero cat={selected} />}
            <RunEntry
              key={`run:${address}`}
              state={state}
              wallet={address}
              blocked={blocked}
              sign={sign}
              work={perform}
              refresh={reload}
            />
          </>
        ),
        cats: (
          <>
            <CatCollection
              state={state}
              blocked={blocked}
              onSelect={(cat) => {
                const version = state.inventoryVersion;
                if (version === null) return;
                void perform((signal) =>
                  transact(
                    {
                      operation: "selectCat",
                      inventoryVersion: version.toString(),
                      cat,
                      sponsored: false,
                    },
                    signal,
                  ),
                );
              }}
            />
            <CatUpgrades state={state} blocked={blocked} action={game} />
          </>
        ),
        shop: (
          <CapsuleShop
            key={`shop:${address}`}
            state={state}
            wallet={address}
            blocked={blocked}
            action={game}
          />
        ),
        wallet: (
          <WalletPanel
            key={`wallet:${address}`}
            revision={accountRevision}
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
          <HistoryPanel
            key={`history:${address}`}
            wallet={address}
            revision={accountRevision}
            media={state.assetBinding}
            onSettled={reloadSoon}
          />
        ),
        leaderboard: (
          <LeaderboardPanel
            key={`board:${address}`}
            wallet={address}
            revision={accountRevision}
          />
        ),
      }}
    />
  );
}
