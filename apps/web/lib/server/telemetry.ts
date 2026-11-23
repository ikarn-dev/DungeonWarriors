import "server-only";
import {
  flush,
  getClient,
  type initWithoutDefaultIntegrations,
  metrics,
} from "@sentry/nextjs";

const routes = [
  "auth.challenge",
  "auth.verify",
  "auth.session",
  "auth.logout",
  "chain.state",
  "rpc.devnet",
  "tx.prepare",
  "tx.submit",
  "tx.status",
  "run.browser",
  "run.settle",
] as const;
export type RouteOperation = (typeof routes)[number];
const providers = ["solana", "magicblock", "redis"] as const;
type Provider = (typeof providers)[number];
const transactionStates = [
  "expired",
  "finalized",
  "failed",
  "pending",
  "unknown",
] as const;
type TransactionState = (typeof transactionStates)[number];
const operations = [...routes, ...providers, "base", "er", "sponsor"] as const;
const outcomes = [
  "ok",
  "rejected",
  "limited",
  "unavailable",
  ...transactionStates,
] as const;
type Outcome = (typeof outcomes)[number];

export const telemetryOptions = {
  environment: "devnet",
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
  },
  sendClientReports: false,
  enableOpenTelemetrySetup: false,
  enableRuntimeChannelInjection: false,
  tracesSampleRate: 0,
  beforeSend: () => null,
  beforeSendLog: () => null,
  beforeSendMetric(metric) {
    if (
      ![
        "purrps.duration",
        "purrps.transaction.status",
        "purrps.sponsor.budget_reserved",
      ].includes(metric.name) ||
      !Number.isFinite(metric.value)
    )
      return null;
    const { operation, outcome } = metric.attributes ?? {};
    if (
      !operations.some((allowed) => allowed === operation) ||
      !outcomes.some((allowed) => allowed === outcome)
    )
      return null;
    return {
      ...metric,
      attributes: { operation, outcome, "sentry.environment": "devnet" },
    };
  },
} satisfies NonNullable<Parameters<typeof initWithoutDefaultIntegrations>[0]>;

export function telemetryEnabled() {
  return getClient()?.getDsn() !== undefined;
}

export async function flushTelemetry() {
  await flush(1000);
}

export function observeDuration(
  operation: RouteOperation | Provider,
  started: number,
  outcome: Outcome,
) {
  if (!telemetryEnabled()) return;
  metrics.distribution("purrps.duration", performance.now() - started, {
    unit: "millisecond",
    attributes: { operation, outcome },
  });
}

export function httpOutcome(status: number): Outcome {
  if (status === 429) return "limited";
  if (status >= 500) return "unavailable";
  return status >= 400 ? "rejected" : "ok";
}

export function observeTransactionStatus(
  operation: "base" | "er",
  outcome: TransactionState,
) {
  if (telemetryEnabled())
    metrics.count("purrps.transaction.status", 1, {
      attributes: { operation, outcome },
    });
}

export function observeSponsorReservation(cost: bigint) {
  if (telemetryEnabled())
    metrics.distribution("purrps.sponsor.budget_reserved", Number(cost), {
      attributes: { operation: "sponsor", outcome: "ok" },
    });
}

export function providerFetch(
  operation: "solana" | "magicblock",
): typeof fetch {
  return async (input, init) => {
    const started = performance.now();
    let outcome: Outcome = "unavailable";
    try {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      outcome = httpOutcome(response.status);
      return response;
    } finally {
      observeDuration(operation, started, outcome);
    }
  };
}
