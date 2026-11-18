import { decodeOracleQuote } from "../../apps/web/lib/providers/oracle.mts";
import {
  accountBytes,
  accountSchema,
} from "../../apps/web/lib/providers/rpc-schema.mts";
import { DEVNET, oracleAddress } from "../../apps/web/lib/solana/addresses.mts";

// A BTC notification proves the configured WSS pair delivers actual oracle data.
// Freshness is checked separately against the ER Clock in the HTTP account read.
export function checkErStream(config) {
  return new Promise((resolve, reject) => {
    let socket;
    let subscription;
    let received = false;
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {}
      if (code === undefined) resolve();
      else reject(new Error(code));
    };
    const timer = setTimeout(() => finish("WEBSOCKET_TIMEOUT"), 8000);
    try {
      socket = new WebSocket(config.MAGICBLOCK_ER_WS_URL);
      socket.addEventListener("open", () => {
        if (finished) return;
        try {
          socket.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "accountSubscribe",
              params: [
                oracleAddress(1),
                { encoding: "base64", commitment: "processed" },
              ],
            }),
          );
        } catch {
          finish("WEBSOCKET_UNAVAILABLE");
        }
      });
      socket.addEventListener("error", () => finish("WEBSOCKET_UNAVAILABLE"));
      socket.addEventListener("close", () => finish("WEBSOCKET_UNAVAILABLE"));
      socket.addEventListener("message", (event) => {
        if (finished) return;
        try {
          if (typeof event.data !== "string" || event.data.length > 256 * 1024)
            throw Error();
          const message = JSON.parse(event.data);
          if (message.jsonrpc !== "2.0" || message.error !== undefined)
            throw Error();
          if (message.id === 1 && subscription === undefined) {
            if (!Number.isSafeInteger(message.result) || message.result < 0)
              throw Error();
            subscription = message.result;
          } else if (
            message.method === "accountNotification" &&
            subscription !== undefined &&
            message.params?.subscription === subscription &&
            !received
          ) {
            const { context, value } = message.params.result;
            if (!Number.isSafeInteger(context?.slot) || context.slot < 0)
              throw Error();
            const account = accountSchema.parse(value);
            if (account.owner !== DEVNET.oracleProgram || account.executable) {
              finish("ORACLE_ACCOUNT_MISMATCH");
              return;
            }
            const quote = decodeOracleQuote(
              accountBytes(account),
              config.MAGICBLOCK_ORACLE_BTC_WRITE_AUTHORITY,
            );
            if (
              quote.price <= 0n ||
              quote.postedSlot <= 0n ||
              quote.postedSlot > BigInt(context.slot) ||
              quote.exponent < config.ORACLE_MIN_EXPONENT ||
              quote.exponent > config.ORACLE_MAX_EXPONENT ||
              quote.publishedAtSeconds < 0n ||
              quote.previousPublishedAtSeconds > quote.publishedAtSeconds
            )
              throw Error();
            received = true;
            socket.send(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "accountUnsubscribe",
                params: [subscription],
              }),
            );
          } else if (
            message.method === "accountNotification" &&
            received &&
            message.params?.subscription === subscription
          ) {
            // A notification already in flight can arrive before the unsubscribe ACK.
            return;
          } else if (message.id === 2 && received && message.result === true) {
            finish();
          } else {
            throw Error();
          }
        } catch {
          finish("WEBSOCKET_RESPONSE_INVALID");
        }
      });
    } catch {
      finish("WEBSOCKET_UNAVAILABLE");
    }
  });
}
