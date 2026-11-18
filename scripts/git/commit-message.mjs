export function commitSubject(args) {
  const message = args[0];
  if (
    args.length !== 1 ||
    typeof message !== "string" ||
    message === "chore: save completed coding task" ||
    message.length > 100 ||
    !/^(feat|fix|refactor|perf|test|build|ci|docs|style|chore|revert)(\([a-z0-9/-]+\))?!?: [^\r\n]+$/.test(
      message,
    )
  ) {
    throw new Error(
      "Provide a concise, change-specific Conventional Commit subject; no generic fallback is used.",
    );
  }
  return message;
}
