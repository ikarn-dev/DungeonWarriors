import Image from "next/image";
import BrandBadges from "./BrandBadges";

// Server-rendered brand header so the wordmark paints before wallet hydration.
// The title screen shows the large logo with badges; the lobby centres a
// smaller logo at the top.
export default function LobbyTitle({
  bar = false,
}: {
  readonly bar?: boolean;
}) {
  return (
    <header className="lobby-head" data-variant={bar ? "bar" : undefined}>
      <h1 className="lobby-title">
        <Image
          src="/game_logo.png"
          alt="Dungeon Warriors"
          width={1774}
          height={887}
          sizes={bar ? "26rem" : "(max-height: 40rem) 14rem, 21rem"}
          preload
          className="lobby-logo"
        />
      </h1>
      {!bar && <BrandBadges />}
    </header>
  );
}
