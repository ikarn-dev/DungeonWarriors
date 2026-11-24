import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { requestWalletConnection } from "../../../../apps/web/components/wallet-connect";

function walletFixture() {
  const extension = Object.assign(new EventEmitter(), {
    name: "Phantom",
    connected: false,
    connecting: false,
  });
  type Adapter = Parameters<typeof requestWalletConnection>[1];
  const adapter = extension as unknown as Adapter;
  return {
    adapter,
    extension,
    connect: vi.fn(async () => {}),
    select: vi.fn(),
    onFailure: vi.fn(),
  };
}

it("lets the provider connect a newly selected wallet exactly once", () => {
  const { adapter, extension, connect, select, onFailure } = walletFixture();
  const clear = requestWalletConnection(
    { wallet: null, connect, select },
    adapter,
    onFailure,
  );

  expect(select).toHaveBeenCalledExactlyOnceWith("Phantom");
  expect(connect).not.toHaveBeenCalled();
  extension.emit("error", new Error("Extension declined the connection"));
  expect(onFailure).toHaveBeenCalledTimes(1);
  clear();
  expect(extension.listenerCount("error")).toBe(0);
});

it("calls connect on click for the remembered adapter and reports a no-op", async () => {
  const { adapter, extension, connect, select, onFailure } = walletFixture();
  const wallet = {
    wallet: { adapter, readyState: adapter.readyState },
    connect,
    select,
  };

  const clear = requestWalletConnection(wallet, adapter, onFailure);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(select).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(onFailure).toHaveBeenCalledTimes(1);

  clear();
  onFailure.mockClear();
  connect.mockImplementationOnce(async () => {
    extension.connected = true;
  });
  requestWalletConnection(wallet, adapter, onFailure);
  await Promise.resolve();
  expect(connect).toHaveBeenCalledTimes(2);
  expect(onFailure).not.toHaveBeenCalled();
});
