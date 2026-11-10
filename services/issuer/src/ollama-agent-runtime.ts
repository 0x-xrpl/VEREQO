import { randomBytes } from 'node:crypto';
import { getAddress } from 'ethers';
import { canonicalBusinessRequestId, decimalToApi18 } from '../../../packages/domain/src/native-order.js';
import { marketConfigurationHash } from '../../../packages/domain/src/agent-request.js';
import { formatSpotPrice, marketApiTicks, scaleChainDecimal } from '../../../packages/domain/src/live-injective.js';
import { SPOT_ORDERBOOKS_V2_METHOD, TESTNET_INDEXER_GRPC_WEB } from '../../../packages/domain/src/injective-indexer.js';
import { AgentRuntimeError, type AgentProposalRuntimeContext, type AgentRequestRuntime } from './agent-runtime.js';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
const SCALE = 10n ** 18n;
const outputSchema = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['PROPOSE', 'DECLINE'] },
    side: { type: 'string', enum: ['BUY'] },
    price: { type: 'string' },
    quantity: { type: 'string' },
  },
  required: ['decision', 'side', 'price', 'quantity'],
  additionalProperties: false,
};

export interface SyntheticProposalScenario {
  readonly dataClass: 'SYNTHETIC_REHEARSAL';
  readonly scenarioId: string;
  readonly objective: string;
  readonly market: {
    readonly label: string;
    readonly bestAsk: string;
    readonly visibleAskQuantity: string;
  };
  readonly limits: {
    readonly priceTick: string;
    readonly quantityTick: string;
    readonly minNotional: string;
    readonly maxNotional: string;
    readonly maxTotalExposure: string;
    readonly maxFeeRate: string;
    readonly maxSlippageBps: number;
  };
}

export interface SyntheticUnsignedProposal {
  readonly requestId: string;
  readonly dataClass: 'SYNTHETIC_REHEARSAL';
  readonly status: 'SYNTHETIC_UNSIGNED_PROPOSAL_READY';
  readonly decision: 'PROPOSE';
  readonly order: { readonly side: 'BUY'; readonly orderType: 'LIMIT'; readonly price: string; readonly quantity: string };
  readonly estimatedNotional: string;
  readonly authorized: false;
  readonly execution: 'NOT_IMPLEMENTED';
}

function invalid(code: string): never { throw new AgentRuntimeError(code); }
function loopbackEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return invalid('AGENT_RUNTIME_ENDPOINT_INVALID'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return invalid('AGENT_RUNTIME_LOOPBACK_REQUIRED');
  }
  return url.origin;
}

function strictModelOutput(value: unknown): { decision: string; side: string; price: string; quantity: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
  }
  const keys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = ['decision', 'price', 'quantity', 'side'];
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key) || !Object.hasOwn(descriptors[key]!, 'value'))) {
    return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
  }
  const out = value as Record<string, unknown>;
  if (typeof out.decision !== 'string' || typeof out.side !== 'string' ||
      typeof out.price !== 'string' || typeof out.quantity !== 'string') return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
  return { decision: out.decision, side: out.side, price: out.price, quantity: out.quantity };
}

function decimal18(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value)) {
    return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
  }
  try { return decimalToApi18(value); } catch { return invalid('AGENT_RUNTIME_OUTPUT_INVALID'); }
}

function human18(value: string): string {
  const n = BigInt(value);
  const whole = n / SCALE;
  const fraction = (n % SCALE).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? whole.toString() + '.' + fraction : whole.toString();
}

/**
 * Optional local Ollama adapter. It is loopback-only and emits an unsigned
 * BUY-LIMIT candidate. The model never receives an owner token or signing key.
 */
export class OllamaAgentRuntime implements AgentRequestRuntime {
  private readonly endpoint: string;
  constructor(
    private readonly model: string,
    endpoint = 'http://127.0.0.1:11434',
    private readonly fetcher: Fetcher = fetch,
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw Error('AGENT_RUNTIME_MODEL_INVALID');
    this.endpoint = loopbackEndpoint(endpoint);
  }

  private async infer(promptData: unknown, system: string, signal: AbortSignal, keepAlive?: string) {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint + '/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: this.model,
          system,
          prompt: JSON.stringify(promptData),
          format: outputSchema,
          stream: false,
          options: { temperature: 0, num_predict: 256 },
          ...(keepAlive === undefined ? {} : { keep_alive: keepAlive }),
        }),
      });
    } catch { return invalid('AGENT_RUNTIME_UNAVAILABLE'); }
    // Keep only the numeric status for diagnosis; response bodies may contain model
    // output or local runtime details and are never retained or surfaced.
    if (!response.ok) return invalid(`AGENT_RUNTIME_HTTP_${response.status}`);
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > 65_536) return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
    let envelope: unknown;
    try {
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 65_536) return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
      envelope = JSON.parse(raw) as unknown;
    } catch { return invalid('AGENT_RUNTIME_OUTPUT_INVALID'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
        typeof (envelope as Record<string, unknown>).response !== 'string') return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
    let generated: unknown;
    try { generated = JSON.parse((envelope as { response: string }).response) as unknown; }
    catch { return invalid('AGENT_RUNTIME_OUTPUT_INVALID'); }
    return strictModelOutput(generated);
  }

  async generateProposal(context: AgentProposalRuntimeContext): Promise<unknown> {
    const snapshot = context.snapshot;
    const book = snapshot.spotOrderbook;
    const observedMs = Date.parse(snapshot.observedAt);
    const nowMs = Number(BigInt(context.now) * 1000n);
    const fetchedAt = Number(book?.fetchedAtMs ?? '0');
    const updatedAt = Number(book?.timestampMs ?? '0');
    if (snapshot.status !== 'LIVE_READ_ONLY' || snapshot.chainId !== '1439' ||
        snapshot.market.marketId.toLowerCase() !== context.policy.marketId.toLowerCase() ||
        !Number.isSafeInteger(observedMs) || observedMs > nowMs + 30_000 || nowMs - observedMs > 60_000 ||
        !book || book.marketId.toLowerCase() !== context.policy.marketId.toLowerCase() ||
        book.consistency !== 'UNPINNED_INDEXER_REPORT' || book.source !== TESTNET_INDEXER_GRPC_WEB + SPOT_ORDERBOOKS_V2_METHOD || !book.sells.length ||
        !Number.isSafeInteger(fetchedAt) || fetchedAt <= 0 || fetchedAt > nowMs + 1_000 || nowMs - fetchedAt > 10_000 ||
        !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > nowMs + 2_000 || nowMs - updatedAt > 10_000) {
      return invalid('AGENT_RUNTIME_MARKET_STATE_UNAVAILABLE');
    }

    const ticks = marketApiTicks(snapshot.market);
    // Indexer levels use chain units; the model's prices, quantities and caps
    // must use the same human units. Preserve update times, never refresh them.
    const modelLevels = (levels: typeof book.sells) => levels.slice(0, 5).map(level => ({
      price: formatSpotPrice(level.price, snapshot.market),
      quantity: human18(scaleChainDecimal(level.quantity, 18 - snapshot.market.baseDecimals)),
      timestampMs: level.timestampMs,
    }));
    const promptData = {
      objective: context.objective,
      market: {
        marketId: snapshot.market.marketId,
        ticker: snapshot.market.ticker,
        baseDenom: snapshot.market.baseDenom,
        quoteDenom: snapshot.market.quoteDenom,
        observedAt: snapshot.observedAt,
        blockHeight: snapshot.blockNumber,
        orderbookFetchedAtMs: book.fetchedAtMs,
        orderbookUpdatedAtMs: book.timestampMs,
        levelUnits: 'HUMAN_BASE_QUANTITY_AND_QUOTE_PER_BASE_PRICE',
        topBids: modelLevels(book.buys),
        topAsks: modelLevels(book.sells),
      },
      permission: {
        maxNotional: human18(context.policy.maxNotional),
        maxTotalExposure: human18(context.policy.maxTotalExposure),
        maxFeeRate: human18(context.policy.maxFeeRate),
        minimumNotional: human18(ticks.minimumNotional),
        priceTick: human18(ticks.priceTick),
        quantityTick: human18(ticks.quantityTick),
      },
    };
    const system = 'You are a local read-only proposal agent. Use only the supplied objective, fresh Injective Testnet orderbook, and permission limits. Never claim execution or approval. Only a BUY LIMIT proposal is supported. If the objective, market data, or limits do not support a conservative proposal, return decision DECLINE. Return only the required JSON object. All price and quantity strings are human decimal values and must satisfy the supplied ticks and caps.';
    const choice = await this.infer(promptData, system, context.signal);
    if (choice.decision === 'DECLINE') return invalid('AGENT_PROPOSAL_DECLINED');
    if (choice.decision !== 'PROPOSE' || choice.side !== 'BUY') return invalid('AGENT_RUNTIME_OUTPUT_INVALID');

    const gate = getAddress(context.policy.gate);
    const intent = {
      verifyingContract: gate,
      sender: gate,
      issuer: getAddress(context.policy.issuer),
      principal: getAddress(context.principal),
      agent: getAddress(context.policy.agent),
      credentialId: context.policy.credentialId,
      marketId: context.policy.marketId,
      subaccountId: context.policy.subaccountId,
      marketConfigHash: marketConfigurationHash(snapshot),
      disclosureRequestId: canonicalBusinessRequestId(context.requestId),
      chainId: '1439',
      credentialEpoch: context.policy.credentialEpoch,
      policyEpoch: context.policy.policyEpoch,
      price: decimal18(choice.price),
      quantity: decimal18(choice.quantity),
      priceTick: ticks.priceTick,
      quantityTick: ticks.quantityTick,
      nonce: BigInt('0x' + randomBytes(32).toString('hex')).toString(),
      deadline: (BigInt(context.now) + 120n).toString(),
      maxNotional: context.policy.maxNotional,
      maxFeeRate: context.policy.maxFeeRate,
      maxTotalExposure: context.policy.maxTotalExposure,
      side: 'BUY',
      orderType: 'LIMIT',
    };
    return { requestId: context.requestId, source: 'LIVE_PROVIDER', intent };
  }

  /**
   * Explicitly synthetic, local-only inference. It returns a bounded rehearsal
   * candidate and deliberately never creates a chain Intent or LIVE_PROVIDER result.
   */
  async generateSyntheticProposal(scenario: SyntheticProposalScenario): Promise<SyntheticUnsignedProposal> {
    if (!scenario || scenario.dataClass !== 'SYNTHETIC_REHEARSAL' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(scenario.scenarioId) ||
        typeof scenario.objective !== 'string' || scenario.objective.trim().length < 1 || scenario.objective.length > 512 ||
        !scenario.market || typeof scenario.market.label !== 'string' || scenario.market.label.length < 1 || scenario.market.label.length > 80 ||
        !scenario.limits || !Number.isSafeInteger(scenario.limits.maxSlippageBps) || scenario.limits.maxSlippageBps < 0 || scenario.limits.maxSlippageBps > 1_000) {
      return invalid('AGENT_SYNTHETIC_SCENARIO_INVALID');
    }
    let bestAsk: bigint, visibleAskQuantity: bigint, priceTick: bigint, quantityTick: bigint;
    let minNotional: bigint, maxNotional: bigint, maxTotalExposure: bigint, feeRate: bigint;
    try {
      bestAsk = BigInt(decimal18(scenario.market.bestAsk));
      visibleAskQuantity = BigInt(decimal18(scenario.market.visibleAskQuantity));
      priceTick = BigInt(decimal18(scenario.limits.priceTick));
      quantityTick = BigInt(decimal18(scenario.limits.quantityTick));
      minNotional = BigInt(decimal18(scenario.limits.minNotional));
      maxNotional = BigInt(decimal18(scenario.limits.maxNotional));
      maxTotalExposure = BigInt(decimal18(scenario.limits.maxTotalExposure));
      feeRate = BigInt(decimal18(scenario.limits.maxFeeRate));
    } catch { return invalid('AGENT_SYNTHETIC_SCENARIO_INVALID'); }
    if (bestAsk <= 0n || visibleAskQuantity <= 0n || priceTick <= 0n || quantityTick <= 0n ||
        minNotional <= 0n || maxNotional < minNotional || maxTotalExposure < maxNotional || feeRate > SCALE) {
      return invalid('AGENT_SYNTHETIC_SCENARIO_INVALID');
    }
    const promptData = {
      dataClass: 'SYNTHETIC_REHEARSAL',
      scenarioId: scenario.scenarioId,
      objective: scenario.objective.trim(),
      market: { label: scenario.market.label, bestAsk: human18(bestAsk.toString()), visibleAskQuantity: human18(visibleAskQuantity.toString()) },
      limits: {
        priceTick: human18(priceTick.toString()), quantityTick: human18(quantityTick.toString()), minNotional: human18(minNotional.toString()),
        maxNotional: human18(maxNotional.toString()), maxTotalExposure: human18(maxTotalExposure.toString()),
        maxFeeRate: human18(feeRate.toString()), maxSlippageBps: scenario.limits.maxSlippageBps,
      },
      restrictions: ['SYNTHETIC_ONLY', 'NO_CHAIN_ID', 'NO_MARKET_ID', 'NO_WALLET', 'NO_SIGNATURE', 'NO_ORDER_SUBMISSION'],
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    timer.unref();
    let choice: ReturnType<typeof strictModelOutput>;
    try {
      choice = await this.infer(
        promptData,
        "Evaluate the SYNTHETIC_REHEARSAL objective, market and limits. Only an unsigned paper proposal is requested; no Wallet, signature, real market or execution is requested or permitted. The absence of execution authority is not itself a reason to decline a paper proposal. Calculate notional = price * quantity and exposure = notional * (1 + maxFeeRate). Check requested quantity against visible liquidity, price and quantity ticks, minNotional, maxNotional, maxTotalExposure and maxSlippageBps. If all constraints allow the requested candidate, return decision PROPOSE. If any constraint fails, return decision DECLINE. Return only the required JSON object; price and quantity are human decimal strings. Never claim approval or execution.",
        controller.signal,
        '0',
      );
    } finally { clearTimeout(timer); }
    if (choice.decision === 'DECLINE') return invalid('AGENT_PROPOSAL_DECLINED');
    if (choice.decision !== 'PROPOSE' || choice.side !== 'BUY') return invalid('AGENT_RUNTIME_OUTPUT_INVALID');
    const price = BigInt(decimal18(choice.price)), quantity = BigInt(decimal18(choice.quantity));
    const slippageCap = (bestAsk * BigInt(10_000 + scenario.limits.maxSlippageBps)) / 10_000n;
    if (price <= 0n || quantity <= 0n || price % priceTick !== 0n || quantity % quantityTick !== 0n ||
        price > slippageCap || quantity > visibleAskQuantity) return invalid('AGENT_SYNTHETIC_PROPOSAL_OUT_OF_BOUNDS');
    const notional = (price * quantity + SCALE - 1n) / SCALE;
    const fee = (notional * feeRate + SCALE - 1n) / SCALE;
    if (notional < minNotional || notional > maxNotional || notional + fee > maxTotalExposure) {
      return invalid('AGENT_SYNTHETIC_PROPOSAL_OUT_OF_BOUNDS');
    }
    return Object.freeze({
      requestId: scenario.scenarioId,
      dataClass: 'SYNTHETIC_REHEARSAL',
      status: 'SYNTHETIC_UNSIGNED_PROPOSAL_READY',
      decision: 'PROPOSE',
      order: Object.freeze({ side: 'BUY', orderType: 'LIMIT', price: human18(price.toString()), quantity: human18(quantity.toString()) }),
      estimatedNotional: human18(notional.toString()),
      authorized: false,
      execution: 'NOT_IMPLEMENTED',
    });
  }
}
