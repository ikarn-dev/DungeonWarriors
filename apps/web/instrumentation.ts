export async function register() {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  const { SENTRY_DSN: dsn } = process.env;
  if (!dsn) return;
  const [{ initWithoutDefaultIntegrations }, { telemetryOptions }] =
    await Promise.all([
      import("@sentry/nextjs"),
      import("./lib/server/telemetry"),
    ]);
  initWithoutDefaultIntegrations({ dsn, ...telemetryOptions });
}
