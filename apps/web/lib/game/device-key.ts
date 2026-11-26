import { PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { WebApiError } from "./web-api";

type DeviceKey = { address: string; privateKey: CryptoKey };
const unavailable = () => new WebApiError("GAME_DEVICE_UNAVAILABLE");

function openKeys(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dungeon-warriors-device", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("signers");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(unavailable());
    request.onblocked = () => reject(unavailable());
  });
}

async function readKey(
  db: IDBDatabase,
  wallet: string,
): Promise<DeviceKey | undefined> {
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("signers")
      .objectStore("signers")
      .get(wallet);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(unavailable());
  });
}

export async function gameDeviceKey(wallet: string, create = false) {
  let db: IDBDatabase | undefined;
  try {
    const keys = await openKeys();
    db = keys;
    const existing = await readKey(keys, wallet);
    if (existing || !create) return existing;
    const pair = await crypto.subtle.generateKey("Ed25519", false, [
      "sign",
      "verify",
    ]);
    if (!("privateKey" in pair)) throw unavailable();
    const address = new PublicKey(
      new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    ).toBase58();
    const key = { address, privateKey: pair.privateKey };
    const store = keys.transaction("signers", "readwrite");
    store.objectStore("signers").add(key, wallet);
    // add is atomic across tabs. Use the key that won an overlapping enrollment.
    await new Promise<void>((resolve, reject) => {
      store.oncomplete = () => resolve();
      store.onabort = () => reject(unavailable());
    }).catch(async (error: unknown) => {
      if (!(await readKey(keys, wallet))) throw error;
    });
    const persisted = await readKey(keys, wallet);
    if (!persisted) throw unavailable();
    return persisted;
  } catch {
    if (create) throw unavailable();
    return undefined;
  } finally {
    db?.close();
  }
}

export async function signDeviceMessage(key: DeviceKey, message: Uint8Array) {
  return new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      key.privateKey,
      Uint8Array.from(message),
    ),
  );
}

export async function signGameTransaction(
  key: DeviceKey,
  tx: VersionedTransaction,
) {
  tx.addSignature(
    new PublicKey(key.address),
    await signDeviceMessage(key, tx.message.serialize()),
  );
  return tx;
}
