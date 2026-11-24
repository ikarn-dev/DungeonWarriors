import LobbySound from "../../components/LobbySound";
import LobbyTitle from "../../components/LobbyTitle";
import StarterPanel from "../../components/StarterLobby";

export default function StarterPage() {
  return (
    <main className="lobby">
      <LobbyTitle bar />
      <LobbySound />
      <StarterPanel />
    </main>
  );
}
