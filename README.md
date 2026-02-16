# x402-xrpl

Standalone project scaffold for experimenting with x402 flows on XRPL.

## Quick start

```bash
pnpm install
pnpm dev
```

## Scripts

- `pnpm dev` — run `src/index.ts` with `tsx`
- `pnpm build` — compile TypeScript to `dist/`
- `pnpm format` — format all files with Prettier
- `pnpm format:check` — verify formatting without writing changes
- `pnpm test` — run settlement adapter tests

## Usage example

```ts
import {
  InMemoryReplayStore,
  buildXrplMemo,
  createChallenge,
  encodeReceiptHeader,
  verifySettlement,
  type FetchTransaction,
} from "./src/index.js";

const challenge = createChallenge({
  network: "xrpl:testnet",
  amount: "2.5",
  asset: { kind: "XRP" },
  destination: "rDestinationAddress...",
  expiresAt: "2026-02-17T12:00:00Z",
  paymentId: "01JABCXYZPAYMENTID",
});

const xrplMemo = buildXrplMemo(challenge);
console.log("Attach this memo to your XRPL Payment:", xrplMemo);

const receiptHeaderValue = encodeReceiptHeader({
  network: challenge.network,
  txHash: "ABCDEF123...",
  paymentId: challenge.paymentId,
});

const fetchTransaction: FetchTransaction = async () => ({
  validated: true,
  TransactionType: "Payment",
  Destination: challenge.destination,
  // XRP is represented in drops on XRPL.
  Amount: "2500000",
  Memos: [xrplMemo],
});

const replayStore = new InMemoryReplayStore();

const result = await verifySettlement({
  challenge,
  receiptHeaderValue,
  fetchTransaction,
  replayStore,
});

console.log(result);
// { ok: true, idempotent: false, receipt: { ... } }
```

Second call with the same `paymentId` + `txHash` returns idempotent success.
