"use client";
import Image from "next/image";
import { z } from "zod";
import { catSchema } from "../lib/dungeon/protocol";
import { displayUsdc } from "../lib/game/custody-client";
import { CAT_NAMES } from "../lib/game/lobby-state";
import { warriorAvatar } from "../lib/game/warrior-avatars";
import { webApi } from "../lib/game/web-api";
import { u64Input } from "../lib/solana/program";
import { useFinalized } from "./account-data";
import DotsLoader from "./DotsLoader";
import { UiIcon } from "./UiIcon";

const pageSchema = z.object({
  entries: z
    .array(
      z.object({
        nonce: u64Input,
        cat: catSchema,
        state: z.enum([
          "awaitingRandomness",
          "ready",
          "won",
          "lost",
          "refunded",
        ]),
        stake: u64Input,
        payout: u64Input,
      }),
    )
    .max(8),
});
const read = async (signal: AbortSignal) =>
  pageSchema.parse(await webApi("/api/dungeon", { kind: "history" }, signal));
const labels = {
  awaitingRandomness: null,
  ready: null,
  won: "Won",
  lost: "Lost",
  refunded: "Refunded",
};

export default function DungeonHistory({
  revision,
}: {
  readonly revision: number | undefined;
}) {
  const { value, failed, retry } = useFinalized(revision, read);
  const entries = value?.entries.filter(({ state }) => labels[state] !== null);

  return (
    <section className="lobby-section lobby-history">
      {failed ? (
        <div className="lobby-empty">
          <p role="alert">History unavailable.</p>
          <button className="pixel-button" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : entries === undefined ? (
        <div className="lobby-loading">
          <DotsLoader label="Loading history" />
        </div>
      ) : entries.length === 0 ? (
        <p>No completed expeditions.</p>
      ) : (
        <table className="lobby-table">
          <thead>
            <tr>
              <th scope="col">Avatar</th>
              <th scope="col" data-center>
                Result
              </th>
              <th scope="col" data-number>
                Bet (USDC)
              </th>
              <th scope="col" data-number>
                Payout (USDC)
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.nonce} data-result={entry.state}>
                <td>
                  <span className="history-cat">
                    <span className="history-art">
                      <Image
                        src={warriorAvatar(entry.cat)}
                        alt=""
                        width={1254}
                        height={1254}
                        sizes="2.25rem"
                      />
                    </span>
                    {CAT_NAMES[entry.cat]}
                  </span>
                </td>
                <td data-center>
                  <span className="history-result">
                    {entry.state === "won" && <UiIcon name="check" size={12} />}
                    {entry.state === "lost" && (
                      <UiIcon name="cross" size={12} />
                    )}
                    {labels[entry.state]}
                  </span>
                </td>
                <td data-number>{displayUsdc(entry.stake)}</td>
                <td data-number>{displayUsdc(entry.payout)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
