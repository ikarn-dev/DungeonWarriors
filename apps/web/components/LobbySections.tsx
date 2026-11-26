import type { ComponentProps } from "react";
import { useCallback, useEffect, useState } from "react";
import type { CatId } from "../lib/game/catalog";
import type { PlayerIntent } from "../lib/game/custody-client";
import type { DeviceIntent } from "../lib/game/device-intents";
import { gameDeviceKey } from "../lib/game/device-key";
import type { LobbyState } from "../lib/game/lobby-state";
import type { LobbyIntent } from "../lib/game/transaction-intents";
import { WebApiError } from "../lib/game/web-api";
import CapsuleShop from "./CapsuleShop";
import CatCollection from "./CatCollection";
import DungeonEntry from "./DungeonEntry";
import HistoryTabs from "./HistoryTabs";
import LeaderboardPanel from "./LeaderboardPanel";
import { LobbyHero } from "./LobbyHero";
import { LobbyMenu, type LobbyTab } from "./LobbyMenu";
import WalletPanel from "./WalletPanel";

type Work = (fn: (signal: AbortSignal) => Promise<void>) => Promise<void>;

// The signed-in lobby: one menu entry and one panel per player task.
export default function LobbySections({
  state,
  address,
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
  readonly blocked: boolean;
  readonly accountRevision: number | undefined;
  readonly shopDraw: Pick<
    ComponentProps<typeof CapsuleShop>,
    "receipt" | "retryDraw" | "onViewDraw"
  >;
  readonly tab: LobbyTab | null;
  readonly setTab: (tab: LobbyTab | null) => void;
  readonly perform: Work;
  readonly transact: (
    intent: LobbyIntent | PlayerIntent | DeviceIntent,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly reload: (signal: AbortSignal) => Promise<void>;
}) {
  const showMenu = useCallback(() => setTab(null), [setTab]);
  const access = state.gameDevice;
  const [local, setLocal] = useState<{
    owner: string;
    device: string | undefined;
  } | null>(null);
  const checkedDevice = local?.owner === address;
  const device =
    checkedDevice && local.device === access?.address
      ? local.device
      : undefined;
  const authorizedDevice = access?.address;
  useEffect(() => {
    let current = true;
    void (
      authorizedDevice ? gameDeviceKey(address) : Promise.resolve(undefined)
    ).then((key) => {
      if (current) setLocal({ owner: address, device: key?.address });
    });
    return () => {
      current = false;
    };
  }, [address, authorizedDevice]);
  const enable = () =>
    void perform(async (signal) => {
      const key = await gameDeviceKey(address, true);
      if (!key) throw new WebApiError("GAME_DEVICE_UNAVAILABLE");
      await transact(
        { operation: "setGameDevice", sponsored: false, device: key.address },
        signal,
      );
    });
  const revoke = () => {
    if (
      !window.confirm("Revoke browser access to your Dungeon Warriors balance?")
    )
      return;
    void perform((signal) =>
      transact(
        { operation: "setGameDevice", sponsored: false, device: null },
        signal,
      ),
    );
  };
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
      panels={{
        play: (
          <>
            <header className="lobby-window-head">
              <h2>Begin quest</h2>
            </header>
            {selected && <LobbyHero cat={selected} />}
            {selected && (
              <DungeonEntry
                key={address}
                state={state}
                cat={selected.id}
                wallet={address}
                device={device}
                onEnable={enable}
                onDeposit={() => setTab("wallet")}
                blocked={blocked || !checkedDevice}
                refresh={reload}
                showMenu={showMenu}
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
            deviceReady={device !== undefined}
            hasGrant={access !== null}
            onEnable={enable}
            onRevoke={revoke}
            transfer={(kind, amount) =>
              perform(async (signal) => {
                if (kind === "deposit") {
                  const key = await gameDeviceKey(address, true);
                  if (!key) throw new WebApiError("GAME_DEVICE_UNAVAILABLE");
                  await transact(
                    {
                      operation: "depositWithDevice",
                      sponsored: false,
                      device: key.address,
                      amount,
                    },
                    signal,
                  );
                } else {
                  if (!device || !access)
                    throw new WebApiError("INVALID_GAME_DEVICE");
                  await transact(
                    {
                      operation: "withdrawWithDevice",
                      sponsored: true,
                      device,
                      amount,
                      nonce: access.nextWithdrawal,
                    },
                    signal,
                  );
                }
              })
            }
          />
        ),
        history: (
          <HistoryTabs
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
