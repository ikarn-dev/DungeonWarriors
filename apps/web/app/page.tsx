import BrandBadges from "../components/BrandBadges";
import LobbyBackdrop from "../components/LobbyBackdrop";
import { LobbyClickSounds } from "../components/LobbySound";
import LobbyTitle from "../components/LobbyTitle";
import TitleStart from "../components/TitleStart";
// Title screen (2026-11-26): no panel. The logo stands large over the
// castle in a warm halo, the Start key sits under it and the partner marks
// sit quietly at the foot of the screen.
export default function Home() {
  return (
    <main className="lobby" data-screen="title">
      <LobbyBackdrop />
      <LobbyClickSounds />
      <div className="title-stage">
        <div className="title-glow" aria-hidden="true" />
        <LobbyTitle />
        <TitleStart />
      </div>
      <footer className="title-footer">
        <BrandBadges />
      </footer>
    </main>
  );
}
