import FrameCorners from "../components/FrameCorners";
import LobbyBackdrop from "../components/LobbyBackdrop";
import { LobbyClickSounds } from "../components/LobbySound";
import LobbyTitle from "../components/LobbyTitle";
import TitleStart from "../components/TitleStart";

export default function Home() {
  return (
    <main className="lobby" data-screen="title">
      <LobbyBackdrop />
      <LobbyClickSounds />
      <div className="title-frame">
        <FrameCorners />
        <div className="title-sheen" aria-hidden="true" />
        <LobbyTitle />
        <TitleStart />
      </div>
    </main>
  );
}
