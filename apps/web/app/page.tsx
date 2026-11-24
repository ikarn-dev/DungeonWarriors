import LobbyBackdrop from "../components/LobbyBackdrop";
import { LobbyClickSounds } from "../components/LobbySound";
import LobbyTitle from "../components/LobbyTitle";
import LobbyToaster from "../components/LobbyToaster";
import TitleStart from "../components/TitleStart";

// Filigree corner for the metallic frame; mirrored for the other corners.
function FrameCorner({ corner }: { readonly corner: string }) {
  return (
    <svg
      className="title-corner"
      data-corner={corner}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path
        d="M2 46V12C2 6 6 2 12 2h34v6H14c-3 0-6 3-6 6v32z"
        fill="url(#title-metal)"
      />
      <path
        d="M14 14h18l-4 4H18v10l-4 4z"
        fill="url(#title-metal)"
        opacity="0.85"
      />
      <path d="M7 7l6 0 0 6-6 0z" fill="#1d7f73" />
      <path d="M8 8l3 0 0 3-3 0z" fill="#8ff0dc" opacity="0.8" />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="lobby" data-screen="title">
      <LobbyBackdrop />
      <LobbyClickSounds />
      <LobbyToaster />
      <svg className="title-defs" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="title-metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fbeab0" />
            <stop offset="0.3" stopColor="#c9963c" />
            <stop offset="0.55" stopColor="#fff3c4" />
            <stop offset="0.8" stopColor="#8a6120" />
            <stop offset="1" stopColor="#e2b85c" />
          </linearGradient>
        </defs>
      </svg>
      <div className="title-frame">
        <FrameCorner corner="tl" />
        <FrameCorner corner="tr" />
        <FrameCorner corner="bl" />
        <FrameCorner corner="br" />
        <div className="title-sheen" aria-hidden="true" />
        <LobbyTitle />
        <TitleStart />
      </div>
    </main>
  );
}
