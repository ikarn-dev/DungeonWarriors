import { createRequire } from "node:module";
import { beforeEach, expect, it, vi } from "vitest";
import WalletDialog from "../../../../apps/web/components/WalletDialog";
import { useHydratedWallet } from "../../../../apps/web/components/WalletProviders";

const adapter = vi.hoisted(() => ({ useWallet: vi.fn() }));
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: adapter.useWallet,
}));

const requireWeb = createRequire(
  new URL("../../../../apps/web/package.json", import.meta.url),
);
const { createElement } = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
const noop = () => undefined;
const extension = {
  adapter: { name: "Extension wallet", icon: "/test-wallet.svg" },
};
const detectedWallet = {
  wallets: [extension],
  wallet: extension,
  connected: true,
  publicKey: { toBase58: () => "test-wallet" },
};
function dialog(open: boolean, wallet: ReturnType<typeof useHydratedWallet>) {
  return createElement(WalletDialog, {
    open,
    wallet,
    busy: false,
    onClose: noop,
  });
}
function ConnectedDialog() {
  const wallet = useHydratedWallet();
  return createElement(
    "div",
    null,
    wallet.connected && createElement("span", null, "Connected wallet"),
    dialog(true, wallet),
  );
}

beforeEach(() => adapter.useWallet.mockReset());

it("keeps the server and hydration snapshots stable when the wallet is already detected", () => {
  adapter.useWallet.mockReturnValue({
    wallets: [],
    wallet: null,
    connected: false,
    publicKey: null,
  });
  const server = renderToStaticMarkup(createElement(ConnectedDialog));
  adapter.useWallet.mockReturnValue(detectedWallet);
  const hydratedFromServer = renderToStaticMarkup(
    createElement(ConnectedDialog),
  );
  expect(adapter.useWallet).toHaveBeenCalledTimes(2);
  expect(hydratedFromServer).toBe(server);
  expect(server).not.toContain("Connected wallet");
  expect(server).not.toContain("Extension wallet");
});

it("renders discovered wallets only when the dialog opens", () => {
  const props = {
    wallet: detectedWallet,
    busy: false,
    onClose: noop,
  };
  const closed = renderToStaticMarkup(
    createElement(WalletDialog, { ...props, open: false }),
  );
  expect(closed).not.toContain("wallet-picker");
  const open = renderToStaticMarkup(
    createElement(WalletDialog, { ...props, open: true }),
  );
  expect(open).toContain("Extension wallet");
  expect(open).not.toContain("No Solana wallet found");
});
