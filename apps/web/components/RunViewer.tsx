"use client";

import { type ComponentProps, useCallback, useState } from "react";
import BrowserRunStage from "./BrowserRunStage";
import RunStage from "./RunStage";
import { RULES_V4 } from "../lib/game/rules";

// A legacy escrow retains its frozen execution rules through the migration.
export default function RunViewer(props: ComponentProps<typeof RunStage> & { rulesVersion?: number | null }) {
  const [legacy, setLegacy] = useState(props.rulesVersion !== RULES_V4.rulesVersion);
  const useLegacy = useCallback(() => setLegacy(true), []);
  if (legacy) return <RunStage {...props} />;
  return <BrowserRunStage nonce={props.nonce}
    media={props.media} artwork={props.artwork} activating={props.activating}
    present={props.present ?? true} onFinalized={props.onFinalized}
    runSettled={props.runSettled} onLegacy={useLegacy} />;
}
