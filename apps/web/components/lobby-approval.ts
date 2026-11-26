import { VersionedTransaction } from "@solana/web3.js";
import { catalogManifestPath, verifyManifestBinding } from "../lib/game/assets";
import {
  type PlayerIntent,
  validatePreparedPlayerAction,
} from "../lib/game/custody-client";
import {
  type DeviceIntent,
  validateDeviceTransaction,
} from "../lib/game/device-intents";
import { gameDeviceKey, signGameTransaction } from "../lib/game/device-key";
import type { LobbyState } from "../lib/game/lobby-state";
import {
  type LobbyIntent,
  lobbyPreparedSchema,
  validatePreparedTransaction,
} from "../lib/game/transaction-intents";
import {
  decodeBase64,
  readWebJson,
  WebApiError,
  webApi,
} from "../lib/game/web-api";

export async function approveLobbyTransaction(
  address: string,
  intent: LobbyIntent | PlayerIntent | DeviceIntent,
  assetBinding: LobbyState["assetBinding"] | undefined,
  walletSign:
    | ((tx: VersionedTransaction) => Promise<VersionedTransaction>)
    | undefined,
  onWalletApproval: () => void,
  signal: AbortSignal,
) {
  if (!walletSign && intent.operation !== "withdrawWithDevice")
    throw new WebApiError("TRANSACTION_SIGNING_REQUIRED");
  if (
    intent.operation === "claimStarter" ||
    (intent.operation === "game" && intent.action.kind === "purchaseCapsule")
  ) {
    if (assetBinding == null) throw new WebApiError("ASSETS_NOT_READY");
    const response = await fetch(catalogManifestPath(assetBinding.version), {
      cache: "no-store",
      signal,
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 262144
    )
      throw new WebApiError("ASSETS_NOT_READY");
    await verifyManifestBinding(await readWebJson(response), assetBinding);
  }
  const prepared = lobbyPreparedSchema.parse(
    await webApi("/api/tx/prepare", intent, signal),
  );
  const tx = VersionedTransaction.deserialize(
    decodeBase64(prepared.transaction),
  );
  if (intent.operation === "game")
    validatePreparedPlayerAction(tx, address, intent);
  else if (
    intent.operation === "depositWithDevice" ||
    intent.operation === "setGameDevice" ||
    intent.operation === "withdrawWithDevice"
  )
    validateDeviceTransaction(tx, address, intent);
  else validatePreparedTransaction(tx, address, intent);

  signal.throwIfAborted();
  let signed: VersionedTransaction;
  if (intent.operation === "withdrawWithDevice") {
    const key = await gameDeviceKey(address);
    if (!key || key.address !== intent.device)
      throw new WebApiError("GAME_DEVICE_UNAVAILABLE");
    signed = await signGameTransaction(key, tx);
  } else {
    if (!walletSign) throw new WebApiError("TRANSACTION_SIGNING_REQUIRED");
    onWalletApproval();
    signed = await walletSign(tx);
  }
  return { signed, lastValidBlockHeight: prepared.lastValidBlockHeight };
}
