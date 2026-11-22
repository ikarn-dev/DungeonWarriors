import Image from "next/image";

// Server-rendered brand header so the wordmark paints before wallet hydration.
export default function LobbyTitle() {
  return (
    <header className="lobby-head">
      <h1 className="lobby-title">
        <Image
          src="/logo-no-bg.png"
          alt="PURRPS"
          width={1254}
          height={1254}
          sizes="(max-height: 40rem) 8rem, 14rem"
          preload
          className="lobby-logo"
        />
      </h1>
      <p className="lobby-network">Solana Devnet</p>
    </header>
  );
}
