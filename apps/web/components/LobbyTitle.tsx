import Image from "next/image";

// Server-rendered brand header so the wordmark paints before wallet hydration.
// The title screen shows the large logo (its partner badges sit at the foot
// of the page); the lobby centres a smaller logo at the top.
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
          sizes={bar ? "26rem" : "(max-height: 40rem) 20rem, 36rem"}
          preload
          className="lobby-logo"
        />
      </h1>
    </header>
  );
}
