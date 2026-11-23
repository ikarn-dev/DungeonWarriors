import Link from "next/link";
import LobbyScene from "../components/LobbyScene";
import LobbySound from "../components/LobbySound";
import LobbyTitle from "../components/LobbyTitle";
import { CATALOG_V1 } from "../lib/game/catalog";

export default function Home() {
  return (
    <main className="lobby" data-screen="title">
      <LobbyScene cats={CATALOG_V1.cats.map(({ id }) => id)} />
      <LobbyTitle />
      <LobbySound track="title" />
      <div className="lobby-body">
        <Link
          href="/starter"
          prefetch={false}
          className="pixel-button lobby-play"
          data-tone="gold"
        >
          Start
          <span className="pixel-icon" data-icon="right" aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}
