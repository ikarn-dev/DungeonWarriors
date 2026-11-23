import Image from "next/image";
import BrandBadges from "./BrandBadges";

// Server-rendered brand header so the wordmark paints before wallet hydration.
// The title screen shows the large logo with badges; the lobby uses a
// compact navbar mark.
export default function LobbyTitle({
  bar = false,
}: {
  readonly bar?: boolean;
}) {
  return (
    <header className="lobby-head" data-variant={bar ? "bar" : undefined}>
      <h1 className="lobby-title">
        <Image
          src="/logo-no-bg.png"
          alt="PURRPS"
          width={1254}
          height={1254}
          sizes={bar ? "5rem" : "(max-height: 40rem) 8rem, 14rem"}
          preload
          className="lobby-logo"
        />
      </h1>
      {!bar && <BrandBadges />}
    </header>
  );
}
