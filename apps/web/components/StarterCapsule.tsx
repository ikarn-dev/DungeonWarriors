import Image from "next/image";
import { MEDIA_ROOT } from "../lib/game/assets";
import { CAT_NAMES, type LobbyState } from "../lib/game/lobby-state";
import style from "./StarterExperience.module.css";

const art = MEDIA_ROOT;

export default function StarterCapsule({
  state,
  submitting = false,
}: {
  state: LobbyState | null;
  submitting?: boolean;
}) {
  const phase =
    submitting && state?.starter === "unclaimed"
      ? "submitting"
      : (state?.starter ?? "unclaimed");
  const award =
    phase === "fulfilled" && state?.cats.length === 1 ? state.cats[0] : null;
  const title = award
    ? CAT_NAMES[award.id]
    : phase === "fulfilled"
      ? "Starter claimed"
      : phase === "submitting"
        ? "Opening capsule"
        : phase === "pending"
          ? "Drawing your cat"
          : "Your first cat";

  return (
    <section
      className={style.capsuleStage}
      data-phase={phase}
      aria-label="Starter capsule"
    >
      <div className={style.platform} aria-hidden="true">
        <div className={style.halo} />
        <div className={style.capsule}>
          <Image
            unoptimized
            className={style.lid}
            src={`${art}/capsule-lid.svg`}
            width={160}
            height={160}
            alt=""
          />
          <Image
            unoptimized
            className={style.capsuleBase}
            src={`${art}/capsule-base.svg`}
            width={160}
            height={160}
            alt=""
          />
          {award && (
            <Image
              unoptimized
              className={style.reveal}
              src={`${art}/portrait-${award.id}.svg`}
              width={176}
              height={176}
              alt=""
            />
          )}
        </div>
      </div>
      <div className={style.stageCopy} aria-live="polite" aria-atomic="true">
        <h2>{title}</h2>
        {award ? (
          <p>
            <span className={style.rarity}>{award.rarity}</span> · Level{" "}
            {award.level}
          </p>
        ) : phase === "submitting" ? (
          <p>Confirming your request on Solana Devnet.</p>
        ) : phase === "pending" ? (
          <p>Waiting for MagicBlock randomness.</p>
        ) : phase === "fulfilled" ? (
          <p>Choose a cat from your collection.</p>
        ) : (
          <p>One free cat per wallet.</p>
        )}
      </div>
    </section>
  );
}
