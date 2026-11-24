export async function waitForFinalized(
  rpc,
  signature,
  { attempts = 60, pause = () => new Promise((r) => setTimeout(r, 1000)) } = {},
) {
  for (let i = 0; i < attempts; i++) {
    let result;
    try {
      result = await rpc.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
    } catch {
      throw new Error(`PUBLICATION_STATUS_UNKNOWN:${signature}`);
    }
    const status = result.value[0];
    if (status?.err) throw new Error(`PUBLICATION_FAILED:${signature}`);
    if (status?.confirmationStatus === "finalized") return status;
    if (i + 1 < attempts) await pause();
  }
  throw new Error(`PUBLICATION_NOT_FINALIZED:${signature}`);
}
