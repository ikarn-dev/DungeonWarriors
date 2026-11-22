import Link from "next/link";
import LobbyScene from "../components/LobbyScene";
import LobbyTitle from "../components/LobbyTitle";
import { CATALOG_V1 } from "../lib/game/catalog";

export default function Home() {
  return (
    <main className="lobby">
      <LobbyScene cats={CATALOG_V1.cats.map(({ id }) => id)} />
      <LobbyTitle />
      <div className="lobby-body">
        <Link
          href="/starter"
          prefetch={false}
          className="pixel-button lobby-play"
          data-tone="gold"
        >
          Play
        </Link>
      </div>
    </main>
  );
}
