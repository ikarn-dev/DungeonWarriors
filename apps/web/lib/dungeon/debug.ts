export function logDungeon(
  event: string,
  fields: Readonly<Record<string, string | number | boolean>>,
) {
  // biome-ignore lint/suspicious/noConsole: Player-requested diagnostics contain only status codes and summary flags.
  console.info(`[dungeon] ${event}`, fields);
}
