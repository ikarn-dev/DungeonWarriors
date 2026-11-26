import { afterEach, expect, it, vi } from "vitest";
import {
  finishWalletLogout,
  walletSelectionKey,
  watchWalletLogout,
} from "../../../../apps/web/components/wallet-logout";

function browser() {
  const values = new Map([
    [walletSelectionKey, "Phantom"],
    ["sound", "off"],
  ]);
  const events = new EventTarget();
  const replace = vi.fn();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    location: { replace },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  return { values, events, replace };
}

afterEach(() => vi.unstubAllGlobals());

it("returns home and forgets the adapter even if the extension never responds", () => {
  const { values, replace } = browser();
  const disconnect = vi.fn(() => new Promise<void>(() => {}));

  finishWalletLogout(disconnect);

  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(values.has(walletSelectionKey)).toBe(false);
  expect(values.get("sound")).toBe("off");
  expect(replace).toHaveBeenCalledExactlyOnceWith("/");
});

it.each([
  Object.assign(new Event("storage"), { key: "dungeon-warriors:logout" }),
  Object.assign(new Event("pageshow"), { persisted: true }),
])("discards the old page after confirmed logout on $type", (event) => {
  const { values, events, replace } = browser();
  const stop = watchWalletLogout();
  events.dispatchEvent(event);
  expect(replace).not.toHaveBeenCalled();

  values.set("dungeon-warriors:logout", "new-marker");
  events.dispatchEvent(event);
  expect(replace).toHaveBeenCalledExactlyOnceWith("/");

  stop();
  events.dispatchEvent(event);
  expect(replace).toHaveBeenCalledTimes(1);
});
