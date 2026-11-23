import LobbySound from "../../components/LobbySound";
import LobbyTitle from "../../components/LobbyTitle";
import WalletShell from "../../components/WalletShell";

export default function StarterPage() {
  return (
    <main className="lobby">
      <LobbyTitle bar />
      <LobbySound track="lobby" />
      <WalletShell />
    </main>
  );
}
