import { z } from "zod";

const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
const position = z.union([signature, z.literal("latest")]).nullable();
export const transactionCursor = z.strictObject({
  player: position,
  collection: position,
});
export type TransactionCursor = z.infer<typeof transactionCursor>;

const activity = z.enum([
  "Wager placed",
  "Payout",
  "Quest settled",
  "Runner settled",
  "Wager refund",
  "Starter requested",
  "Starter cat granted",
  "Capsule purchased",
  "Capsule opened",
  "Capsule refund",
  "Deposit",
  "Withdrawal",
  "Player created",
  "Cat upgraded",
  "Details unavailable",
]);
export type TransactionActivity = z.infer<typeof activity>;
export const transactionPageSize = 10;
export const transactionHistoryPage = z.strictObject({
  entries: z
    .array(
      z.strictObject({
        signature,
        slot: z.number().int().nonnegative(),
        blockTime: z
          .number()
          .int()
          .nonnegative()
          .max(8_640_000_000_000)
          .nullable(),
        activities: z.array(activity).min(1).max(activity.options.length),
      }),
    )
    .max(transactionPageSize),
  next: transactionCursor.nullable(),
});
export type TransactionHistoryPage = z.infer<typeof transactionHistoryPage>;
