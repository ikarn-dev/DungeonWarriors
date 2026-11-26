import { displayUsdc } from "../lib/game/custody-client";
import DotsLoader from "./DotsLoader";
import { UiIcon } from "./UiIcon";

// The Begin quest wager field, the Play key and the forfeit note.
export function QuestWager({
  id,
  available,
  value,
  onChange,
  locked,
  invalid,
  busy,
  checking,
  blocked,
  canSign,
  onPlay,
  onEnable,
  onDeposit,
}: {
  readonly id: string;
  readonly available: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly locked: boolean;
  readonly invalid: boolean;
  readonly busy: boolean;
  readonly checking: boolean;
  readonly blocked: boolean;
  readonly canSign: boolean;
  readonly onEnable: () => void;
  readonly onDeposit: () => void;
  readonly onPlay: () => void;
}) {
  const funded = BigInt(available) > 0n;
  return (
    <div className="bet-card dungeon-bet">
      <div className="bet-field">
        <div className="bet-field-head">
          <label htmlFor={id}>Wager</label>
          <span>
            Available{" "}
            <strong className="lobby-figure">{displayUsdc(available)}</strong>{" "}
            USDC
          </span>
        </div>
        <div className="bet-amount">
          <input
            id={id}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={locked}
            aria-invalid={value !== "" && invalid}
          />
          <span>USDC</span>
        </div>
      </div>
      <button
        className="pixel-button lobby-play"
        aria-busy={busy || checking}
        data-tone="gold"
        type="button"
        disabled={blocked || busy || checking || (canSign && invalid)}
        onClick={canSign ? onPlay : funded ? onEnable : onDeposit}
      >
        {busy || checking ? (
          <DotsLoader
            label={
              checking ? "Checking your last quest" : "Starting your quest"
            }
          />
        ) : canSign ? (
          "Play"
        ) : funded ? (
          "Enable this browser"
        ) : (
          "Deposit USDC"
        )}
      </button>
      {!canSign && funded && (
        <p className="lobby-section-note">
          Funded already? Approve browser access once to play.
        </p>
      )}
      <p className="quest-note">
        <span className="quest-note-mark" aria-hidden="true">
          <UiIcon name="alert" size={12} />
        </span>
        Leaving or refreshing during a room forfeits your wager.
      </p>
    </div>
  );
}
