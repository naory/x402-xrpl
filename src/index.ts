export const ADAPTER_VERSION = "0.1.0";
export const RECEIPT_HEADER_NAME = "X-PAYMENT-RECEIPT";

export const SUPPORTED_NETWORKS = ["xrpl:1", "xrpl:testnet", "xrpl:devnet"] as const;
export type XrplNetwork = (typeof SUPPORTED_NETWORKS)[number];

export type SettlementErrorCode =
  | "expired_challenge"
  | "network_mismatch"
  | "invalid_amount"
  | "invalid_asset"
  | "invalid_destination"
  | "invalid_memo"
  | "replay_detected"
  | "tx_not_validated"
  | "tx_not_found";

export class SettlementVerificationError extends Error {
  readonly code: SettlementErrorCode;

  constructor(code: SettlementErrorCode, message: string) {
    super(message);
    this.name = "SettlementVerificationError";
    this.code = code;
  }
}

export interface XrpAsset {
  kind: "XRP";
}

export interface IouAsset {
  kind: "IOU";
  currency: string;
  issuer: string;
}

export type ChallengeAsset = XrpAsset | IouAsset;

export interface ChallengeMemo {
  format: "x402";
  paymentId: string;
  sessionId?: string;
}

export interface X402Challenge {
  version: "2";
  network: XrplNetwork;
  amount: string;
  asset: ChallengeAsset;
  destination: string;
  expiresAt: string;
  paymentId: string;
  memo: ChallengeMemo;
}

export interface X402Receipt {
  network: XrplNetwork;
  txHash: string;
  paymentId: string;
}

export interface X402MemoData {
  v: 1;
  t: "x402";
  paymentId: string;
  sessionId?: string;
}

export interface XrplMemoField {
  MemoType?: string;
  MemoFormat?: string;
  MemoData?: string;
}

export interface XrplMemoContainer {
  Memo?: XrplMemoField;
}

export interface XrplIssuedAmount {
  currency: string;
  issuer: string;
  value: string;
}

export interface XrplPaymentTransaction {
  validated: boolean;
  TransactionType: string;
  Destination?: string;
  Amount?: string | XrplIssuedAmount;
  Flags?: number;
  Memos?: XrplMemoContainer[];
  SendMax?: unknown;
  Paths?: unknown;
  DeliverMin?: unknown;
}

export type FetchTransaction = (
  network: XrplNetwork,
  txHash: string,
) => Promise<XrplPaymentTransaction | null>;

export interface ReplayStore {
  getTxHashByPaymentId(paymentId: string): string | undefined;
  getPaymentIdByTxHash(txHash: string): string | undefined;
  register(paymentId: string, txHash: string): void;
}

export interface VerifySettlementParams {
  challenge: X402Challenge;
  receiptHeaderValue: string;
  fetchTransaction: FetchTransaction;
  replayStore: ReplayStore;
  now?: Date;
}

export interface VerifySettlementResult {
  ok: true;
  idempotent: boolean;
  receipt: X402Receipt;
}

const PARTIAL_PAYMENT_FLAG = 0x00020000;

export class InMemoryReplayStore implements ReplayStore {
  private readonly paymentIdToTxHash = new Map<string, string>();
  private readonly txHashToPaymentId = new Map<string, string>();

  getTxHashByPaymentId(paymentId: string): string | undefined {
    return this.paymentIdToTxHash.get(paymentId);
  }

  getPaymentIdByTxHash(txHash: string): string | undefined {
    return this.txHashToPaymentId.get(txHash);
  }

  register(paymentId: string, txHash: string): void {
    const existingTxHash = this.paymentIdToTxHash.get(paymentId);
    if (existingTxHash !== undefined && existingTxHash !== txHash) {
      throw new SettlementVerificationError(
        "replay_detected",
        "paymentId already used with a different transaction hash",
      );
    }

    const existingPaymentId = this.txHashToPaymentId.get(txHash);
    if (existingPaymentId !== undefined && existingPaymentId !== paymentId) {
      throw new SettlementVerificationError(
        "replay_detected",
        "transaction hash already used by a different paymentId",
      );
    }

    this.paymentIdToTxHash.set(paymentId, txHash);
    this.txHashToPaymentId.set(txHash, paymentId);
  }
}

export function createChallenge(params: {
  network: XrplNetwork;
  amount: string;
  asset: ChallengeAsset;
  destination: string;
  expiresAt: string;
  paymentId: string;
  sessionId?: string;
}): X402Challenge {
  assertSupportedNetwork(params.network);
  assertDecimalAmount(params.amount);
  assertFutureOrPresentISODate(params.expiresAt);

  if (params.asset.kind === "IOU") {
    assertNonEmpty(params.asset.currency, "asset.currency");
    assertNonEmpty(params.asset.issuer, "asset.issuer");
  }

  assertNonEmpty(params.destination, "destination");
  assertNonEmpty(params.paymentId, "paymentId");

  return {
    version: "2",
    network: params.network,
    amount: normalizeDecimal(params.amount),
    asset: params.asset,
    destination: params.destination,
    expiresAt: params.expiresAt,
    paymentId: params.paymentId,
    memo: {
      format: "x402",
      paymentId: params.paymentId,
      sessionId: params.sessionId,
    },
  };
}

export function encodeReceiptHeader(receipt: X402Receipt): string {
  assertSupportedNetwork(receipt.network);
  assertNonEmpty(receipt.txHash, "txHash");
  assertNonEmpty(receipt.paymentId, "paymentId");
  return asciiToBase64(JSON.stringify(receipt));
}

export function decodeReceiptHeader(receiptHeaderValue: string): X402Receipt {
  let decoded: unknown;
  try {
    decoded = JSON.parse(base64ToAscii(receiptHeaderValue));
  } catch {
    throw new SettlementVerificationError("invalid_memo", "receipt header is not valid base64 JSON");
  }

  if (typeof decoded !== "object" || decoded === null) {
    throw new SettlementVerificationError("invalid_memo", "receipt payload must be an object");
  }

  const maybe = decoded as Partial<X402Receipt>;
  if (typeof maybe.network !== "string") {
    throw new SettlementVerificationError("network_mismatch", "receipt.network is required");
  }
  if (!isSupportedNetwork(maybe.network)) {
    throw new SettlementVerificationError("network_mismatch", "receipt.network is not supported");
  }
  if (typeof maybe.txHash !== "string" || maybe.txHash.length === 0) {
    throw new SettlementVerificationError("tx_not_found", "receipt.txHash is required");
  }
  if (typeof maybe.paymentId !== "string" || maybe.paymentId.length === 0) {
    throw new SettlementVerificationError("invalid_memo", "receipt.paymentId is required");
  }

  return {
    network: maybe.network,
    txHash: maybe.txHash,
    paymentId: maybe.paymentId,
  };
}

export function buildXrplMemo(challenge: Pick<X402Challenge, "paymentId" | "memo">): XrplMemoContainer {
  const memoData: X402MemoData = {
    v: 1,
    t: "x402",
    paymentId: challenge.paymentId,
    sessionId: challenge.memo.sessionId,
  };

  return {
    Memo: {
      MemoType: utf8ToHex("x402"),
      MemoFormat: utf8ToHex("application/json"),
      MemoData: utf8ToHex(JSON.stringify(memoData)),
    },
  };
}

export async function verifySettlement(
  params: VerifySettlementParams,
): Promise<VerifySettlementResult> {
  const now = params.now ?? new Date();

  validateChallenge(params.challenge);
  validateChallengeNotExpired(params.challenge, now);

  const receipt = decodeReceiptHeader(params.receiptHeaderValue);

  if (receipt.network !== params.challenge.network) {
    throw new SettlementVerificationError("network_mismatch", "receipt network does not match challenge network");
  }
  if (receipt.paymentId !== params.challenge.paymentId) {
    throw new SettlementVerificationError("invalid_memo", "receipt paymentId does not match challenge paymentId");
  }

  const existingTxHash = params.replayStore.getTxHashByPaymentId(params.challenge.paymentId);
  if (existingTxHash !== undefined && existingTxHash !== receipt.txHash) {
    throw new SettlementVerificationError("replay_detected", "paymentId already used with a different txHash");
  }

  const existingPaymentId = params.replayStore.getPaymentIdByTxHash(receipt.txHash);
  if (existingPaymentId !== undefined && existingPaymentId !== params.challenge.paymentId) {
    throw new SettlementVerificationError("replay_detected", "txHash already used for a different paymentId");
  }

  if (existingTxHash === receipt.txHash && existingPaymentId === params.challenge.paymentId) {
    return { ok: true, idempotent: true, receipt };
  }

  const tx = await params.fetchTransaction(params.challenge.network, receipt.txHash);
  if (tx === null) {
    throw new SettlementVerificationError("tx_not_found", "transaction not found");
  }

  if (!tx.validated || tx.TransactionType !== "Payment") {
    throw new SettlementVerificationError("tx_not_validated", "transaction is not a validated Payment");
  }

  if (tx.Destination !== params.challenge.destination) {
    throw new SettlementVerificationError("invalid_destination", "transaction destination does not match challenge");
  }

  if ((tx.Flags ?? 0) & PARTIAL_PAYMENT_FLAG) {
    throw new SettlementVerificationError("invalid_asset", "partial payment flag is not allowed");
  }
  if (tx.Paths !== undefined || tx.SendMax !== undefined || tx.DeliverMin !== undefined) {
    throw new SettlementVerificationError("invalid_asset", "path payment fields are not allowed in v1");
  }

  assertAmountAndAssetMatch(params.challenge, tx.Amount);
  assertMemoMatches(tx.Memos, params.challenge.paymentId);

  params.replayStore.register(params.challenge.paymentId, receipt.txHash);

  return {
    ok: true,
    idempotent: false,
    receipt,
  };
}

function validateChallenge(challenge: X402Challenge): void {
  assertSupportedNetwork(challenge.network);

  if (challenge.version !== "2") {
    throw new SettlementVerificationError("invalid_memo", "challenge.version must be 2");
  }
  assertDecimalAmount(challenge.amount);
  assertNonEmpty(challenge.destination, "challenge.destination");
  assertNonEmpty(challenge.paymentId, "challenge.paymentId");

  if (challenge.asset.kind === "IOU") {
    assertNonEmpty(challenge.asset.currency, "challenge.asset.currency");
    assertNonEmpty(challenge.asset.issuer, "challenge.asset.issuer");
  }

  if (challenge.memo.format !== "x402") {
    throw new SettlementVerificationError("invalid_memo", "challenge.memo.format must be x402");
  }
  if (challenge.memo.paymentId !== challenge.paymentId) {
    throw new SettlementVerificationError("invalid_memo", "challenge.memo.paymentId must match challenge.paymentId");
  }
  assertFutureOrPresentISODate(challenge.expiresAt);
}

function validateChallengeNotExpired(challenge: X402Challenge, now: Date): void {
  const expiresAt = new Date(challenge.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new SettlementVerificationError("expired_challenge", "challenge.expiresAt is not valid ISO-8601");
  }
  if (now.getTime() > expiresAt.getTime()) {
    throw new SettlementVerificationError("expired_challenge", "challenge has expired");
  }
}

function assertAmountAndAssetMatch(
  challenge: Pick<X402Challenge, "asset" | "amount">,
  txAmount: XrplPaymentTransaction["Amount"],
): void {
  const expectedAmount = normalizeDecimal(challenge.amount);

  if (challenge.asset.kind === "XRP") {
    if (typeof txAmount !== "string") {
      throw new SettlementVerificationError("invalid_asset", "expected XRP amount in drops string form");
    }
    const actualXrpAmount = normalizeDecimal(dropsToXrp(txAmount));
    if (actualXrpAmount !== expectedAmount) {
      throw new SettlementVerificationError("invalid_amount", "XRP amount does not match challenge amount");
    }
    return;
  }

  if (
    txAmount === undefined ||
    typeof txAmount !== "object" ||
    typeof txAmount.currency !== "string" ||
    typeof txAmount.issuer !== "string" ||
    typeof txAmount.value !== "string"
  ) {
    throw new SettlementVerificationError("invalid_asset", "expected IOU issued amount");
  }

  if (txAmount.currency !== challenge.asset.currency || txAmount.issuer !== challenge.asset.issuer) {
    throw new SettlementVerificationError("invalid_asset", "IOU currency/issuer does not match challenge");
  }

  const actualIouAmount = normalizeDecimal(txAmount.value);
  if (actualIouAmount !== expectedAmount) {
    throw new SettlementVerificationError("invalid_amount", "IOU amount does not match challenge amount");
  }
}

function assertMemoMatches(memos: XrplMemoContainer[] | undefined, paymentId: string): void {
  if (memos === undefined || memos.length === 0) {
    throw new SettlementVerificationError("invalid_memo", "transaction memo is required");
  }

  for (const memoContainer of memos) {
    const memo = memoContainer.Memo;
    if (memo === undefined) {
      continue;
    }

    const memoType = decodeMemoField(memo.MemoType);
    const memoFormat = decodeMemoField(memo.MemoFormat);
    const memoData = decodeMemoField(memo.MemoData);

    if (memoType !== "x402" || memoFormat !== "application/json" || memoData === "") {
      continue;
    }

    try {
      const parsed = JSON.parse(memoData) as Partial<X402MemoData>;
      if (
        parsed.v === 1 &&
        parsed.t === "x402" &&
        typeof parsed.paymentId === "string" &&
        parsed.paymentId === paymentId
      ) {
        return;
      }
    } catch {
      throw new SettlementVerificationError("invalid_memo", "memo JSON is malformed");
    }
  }

  throw new SettlementVerificationError("invalid_memo", "no valid x402 memo found with matching paymentId");
}

function isSupportedNetwork(value: string): value is XrplNetwork {
  return (SUPPORTED_NETWORKS as readonly string[]).includes(value);
}

function assertSupportedNetwork(network: string): asserts network is XrplNetwork {
  if (!isSupportedNetwork(network)) {
    throw new SettlementVerificationError("network_mismatch", `unsupported network: ${network}`);
  }
}

function assertFutureOrPresentISODate(value: string): void {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || !value.includes("T") || !value.endsWith("Z")) {
    throw new SettlementVerificationError("expired_challenge", "expiresAt must be an ISO-8601 UTC timestamp");
  }
}

function assertDecimalAmount(value: string): void {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new SettlementVerificationError("invalid_amount", `invalid decimal amount: ${value}`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new SettlementVerificationError("invalid_memo", `${field} is required`);
  }
}

function normalizeDecimal(value: string): string {
  assertDecimalAmount(value);
  const [rawInteger, rawFraction] = value.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction?.replace(/0+$/, "") ?? "";
  return fraction.length > 0 ? `${integer}.${fraction}` : integer;
}

function dropsToXrp(drops: string): string {
  if (!/^\d+$/.test(drops)) {
    throw new SettlementVerificationError("invalid_amount", "XRP drops amount must be an unsigned integer string");
  }

  const padded = drops.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "") || "0";
  const fractional = padded.slice(-6).replace(/0+$/, "");
  return fractional.length > 0 ? `${whole}.${fractional}` : whole;
}

function decodeMemoField(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return "";
  }

  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    try {
      return hexToUtf8(value);
    } catch {
      throw new SettlementVerificationError("invalid_memo", "memo field contains invalid hex");
    }
  }

  return value;
}

function utf8ToHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const parsed = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(parsed)) {
      throw new Error("Invalid hex");
    }
    bytes[i / 2] = parsed;
  }
  return new TextDecoder().decode(bytes);
}

function asciiToBase64(input: string): string {
  return btoa(input);
}

function base64ToAscii(input: string): string {
  return atob(input);
}
