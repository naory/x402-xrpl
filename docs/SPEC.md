# x402 XRPL Settlement Adapter -- Specification

## 1. Overview

This document defines the XRPL (XRP Ledger) settlement adapter for the
x402 payment protocol.

The purpose of this adapter is to enable XRPL to function as a
settlement rail within x402-compliant payment flows, including HTTP 402
challenge--response interactions.

This adapter:

-   Implements XRPL as a supported network in x402 V2
-   Defines payment challenge structure
-   Defines receipt and verification requirements
-   Specifies memo and idempotency conventions
-   Defines anti-replay policy

XRPL is not currently included in the x402 reference SDKs. This adapter
fills that gap while remaining fully compliant with x402 V2 semantics.

------------------------------------------------------------------------

## 2. Goals

-   Enable XRPL-based settlement for x402 flows
-   Support XRP and IOU-based stablecoins
-   Ensure deterministic verification
-   Prevent replay and duplicate settlement
-   Maintain compatibility with existing x402 header patterns

Non-goals (v1): - Cross-currency path payments - On-ledger escrow
logic - Facilitator-submitted transactions (client submits first)

------------------------------------------------------------------------

## 3. Network Identification

This adapter uses CAIP-2 network identifiers.

### Supported Networks

  Network   CAIP-2 ID
  --------- --------------
  Mainnet   xrpl:1
  Testnet   xrpl:testnet
  Devnet    xrpl:devnet

The `network` field in challenges and receipts MUST match one of the
supported identifiers.

------------------------------------------------------------------------

## 4. Supported Assets

### 4.1 Native XRP

``` json
{ "kind": "XRP" }
```

Rules: - Exact value match required - No path payments allowed - No
partial payments allowed

### 4.2 IOU Stablecoins

``` json
{
  "kind": "IOU",
  "currency": "RLUSD",
  "issuer": "rIssuerAddress..."
}
```

Rules: - Currency and issuer MUST match exactly - Delivered amount MUST
equal requested amount - No path-based conversions in v1

------------------------------------------------------------------------

## 5. x402 Challenge Structure

Example:

``` json
{
  "version": "2",
  "network": "xrpl:testnet",
  "amount": "2.50",
  "asset": { "kind": "XRP" },
  "destination": "rDestinationAddress...",
  "expiresAt": "2026-02-17T12:00:00Z",
  "paymentId": "ULID",
  "memo": {
    "format": "x402",
    "paymentId": "ULID",
    "sessionId": "optional"
  }
}
```

------------------------------------------------------------------------

## 6. XRPL Transaction Requirements

The client must:

-   Submit a Payment transaction
-   Set Destination equal to challenge.destination
-   Set Amount exactly equal to challenge.amount
-   Include Memo per specification
-   Wait for validated status
-   Return transaction hash as receipt

------------------------------------------------------------------------

## 7. Memo Convention

MemoType: "x402"\
MemoFormat: "application/json"

MemoData JSON:

``` json
{
  "v": 1,
  "t": "x402",
  "paymentId": "ULID",
  "sessionId": "optional"
}
```

Verification rules:

-   Memo must exist
-   paymentId must match challenge.paymentId

------------------------------------------------------------------------

## 8. Receipt Format

Header:

X-PAYMENT-RECEIPT: base64-encoded JSON

Decoded JSON:

``` json
{
  "network": "xrpl:testnet",
  "txHash": "ABCDEF123...",
  "paymentId": "ULID"
}
```

------------------------------------------------------------------------

## 9. Verification Algorithm

Server must:

1.  Confirm network matches challenge
2.  Fetch transaction by txHash
3.  Confirm:
    -   Validated = true
    -   Type = Payment
    -   Destination matches
    -   Amount matches
    -   Asset matches
    -   Memo matches paymentId
4.  Ensure paymentId not previously used
5.  Mark paymentId as used
6.  Return success

------------------------------------------------------------------------

## 10. Idempotency & Replay Protection

Rules:

-   paymentId MUST be unique per payment attempt
-   If same paymentId + same txHash → idempotent success
-   If same paymentId + different txHash → reject
-   If txHash reused → reject

Challenge expiry enforced via expiresAt.

------------------------------------------------------------------------

## 11. Error Codes

  Code                  Description
  --------------------- ---------------------------
  expired_challenge     Payment after TTL
  network_mismatch      Wrong network
  invalid_amount        Amount mismatch
  invalid_asset         Asset mismatch
  invalid_destination   Destination mismatch
  invalid_memo          Memo malformed
  replay_detected       paymentId reused
  tx_not_validated      Transaction not validated
  tx_not_found          Unknown txHash

------------------------------------------------------------------------

## 12. Version

Initial version: 0.1.0
