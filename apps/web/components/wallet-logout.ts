export const walletSelectionKey = "walletName";
const logoutKey = "dungeon-warriors:logout";

function logoutMarker() {
  try {
    return window.localStorage.getItem(logoutKey);
  } catch {
    return null;
  }
}

export function watchWalletLogout(): () => void {
  const marker = logoutMarker();
  const reset = () => {
    if (logoutMarker() !== marker) window.location.replace("/");
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === logoutKey) reset();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) reset();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onPageShow);
  };
}

export function finishWalletLogout(disconnect: () => Promise<void>): void {
  try {
    // The provider persists selection in an effect that may not run before navigation.
    window.localStorage.removeItem(walletSelectionKey);
    window.localStorage.setItem(logoutKey, crypto.randomUUID());
  } catch {
    // Navigation still clears this tab's UI when storage is unavailable.
  }
  void disconnect().catch(() => {});
  window.location.replace("/");
}
