import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getAddress, Interface, formatEther, formatUnits } from 'ethers';
import { formatSpotPrice, marketApiTicks, parseSpotMarket } from '../packages/domain/src/live-injective.ts';

const RPC = 'https://k8s.testnet.json-rpc.injective.network/';
const LCD = 'https://testnet.sentry.lcd.injective.network';
const EXCHANGE_PRECOMPILE = '0x0000000000000000000000000000000000000065';
const ADDRESS = process.argv[2];
const OUTPUT = process.env.VEREQO_TESTNET_EVIDENCE_OUTPUT ?? 'docs/evidence/operation-62/testnet-wallet-market-read.json';
if (!ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(ADDRESS)) {
  console.error('Usage: node --import tsx scripts/operation62-testnet-read.mjs <public-evm-address>');
  process.exit(2);
}
const address = getAddress(ADDRESS);
const addressLabel = address.slice(0, 6) + '…' + address.slice(-4);
const addressSha256 = createHash('sha256').update(address.toLowerCase()).digest('hex');
const observedAtStart = new Date().toISOString();
const api18 = (value) => {
  const n = BigInt(value), scale = 10n ** 18n;
  const whole = n / scale;
  const fraction = (n % scale).toString().padStart(18, '0').replace(/0+$/, '');
  return fraction ? whole + '.' + fraction : whole.toString();
};
const rpc = async (method, params) => {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('RPC_HTTP_' + response.status);
  const data = await response.json();
  if (data.jsonrpc !== '2.0' || data.id !== 1 || data.error || !Object.hasOwn(data, 'result')) {
    throw new Error('RPC_INVALID_RESPONSE');
  }
  return data.result;
};
const lcd = async (path) => {
  const response = await fetch(LCD + path, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('LCD_HTTP_' + response.status);
  const text = await response.text();
  if (text.length > 12_000_000) throw new Error('LCD_RESPONSE_TOO_LARGE');
  return JSON.parse(text);
};
const asText = (value) => typeof value === 'string' ? value : '';
const safeSnapshot = {};
const errors = [];

try {
  const chainId = await rpc('eth_chainId', []);
  if (typeof chainId !== 'string' || BigInt(chainId) !== 1439n) throw new Error('WRONG_EVM_CHAIN');
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block || typeof block.number !== 'string' || typeof block.hash !== 'string' || typeof block.timestamp !== 'string') {
    throw new Error('INVALID_EVM_BLOCK');
  }
  const blockTag = block.number;
  const evmTimestamp = Number(BigInt(block.timestamp));
  const [nativeRaw, cosmosLatest, marketResponse, nodeInfo] = await Promise.all([
    rpc('eth_getBalance', [address, blockTag]),
    lcd('/cosmos/base/tendermint/v1beta1/blocks/latest'),
    lcd('/injective/exchange/v1beta1/spot/markets'),
    lcd('/cosmos/base/tendermint/v1beta1/node_info'),
  ]);
  const header = cosmosLatest.sdk_block?.header ?? cosmosLatest.block?.header ?? null;
  const cosmosTime = asText(header?.time);
  const cosmosHeight = asText(header?.height);
  const cosmosHash = asText(cosmosLatest.block_id?.hash ?? cosmosLatest.blockId?.hash);
  const markets = Array.isArray(marketResponse.markets) ? marketResponse.markets : null;
  if (!markets) throw new Error('INVALID_SPOT_MARKET_RESPONSE');
  const cosmosChainId = asText(nodeInfo.default_node_info?.network);
  if (cosmosChainId !== 'injective-888') throw new Error('WRONG_COSMOS_CHAIN');
  const active = markets.filter((market) => market?.status === 'Active');
  const candidates = active.filter((market) => {
    const ticker = asText(market.ticker).toUpperCase();
    return ticker === 'INJ/USDT' || ticker.includes('INJ/USDC') || ticker.includes('USDT/USDC');
  }).map((market) => {
    const parsed = parseSpotMarket(market);
    const ticks = marketApiTicks(parsed);
    return {
      ticker: asText(market.ticker),
      marketId: asText(market.market_id),
      baseDenom: asText(market.base_denom),
      quoteDenom: asText(market.quote_denom),
      baseDecimals: market.base_decimals ?? null,
      quoteDecimals: market.quote_decimals ?? null,
      priceTickChain: parsed.priceTickChain,
      quantityTickChain: parsed.quantityTickChain,
      minimumNotionalChain: parsed.minimumNotionalChain,
      priceTick: api18(ticks.priceTick),
      quantityTick: api18(ticks.quantityTick),
      minimumNotional: api18(ticks.minimumNotional),
      takerFeeRate: parsed.takerFeeRate,
      status: asText(market.status),
    };
  });
  const subaccountId = '0x' + address.slice(2).toLowerCase() + '0'.repeat(24);
  const subaccountIdSha256 = createHash('sha256').update(subaccountId).digest('hex');
  const exchangeAbi = new Interface([
    'function subaccountDeposit(string subaccountID,string denom) view returns (uint256 availableBalance,uint256 totalBalance)',
  ]);
  const denomDecimals = new Map();
  for (const market of candidates) {
    denomDecimals.set(market.baseDenom, market.baseDecimals);
    denomDecimals.set(market.quoteDenom, market.quoteDecimals);
  }
  const exchangeSubaccountBalances = [];
  for (const denom of denomDecimals.keys()) {
    try {
      const data = exchangeAbi.encodeFunctionData('subaccountDeposit', [subaccountId, denom]);
      const result = await rpc('eth_call', [{ to: EXCHANGE_PRECOMPILE, data }, blockTag]);
      const [available, total] = exchangeAbi.decodeFunctionResult('subaccountDeposit', result);
      const decimals = denomDecimals.get(denom);
      exchangeSubaccountBalances.push({
        denom,
        status: 'READ_ONLY_PASS',
        availableBalanceChain: BigInt(available).toString(),
        totalBalanceChain: BigInt(total).toString(),
        decimals,
        availableBalance: formatUnits(BigInt(available), decimals),
        totalBalance: formatUnits(BigInt(total), decimals),
      });
    } catch {
      exchangeSubaccountBalances.push({ denom, status: 'UNKNOWN', reason: 'EXCHANGE_PRECOMPILE_READ_FAILED' });
    }
  }
  const usdcContracts = [...new Set(candidates
    .map((market) => market.quoteDenom.match(/^erc20:(0x[0-9a-fA-F]{40})$/i)?.[1])
    .filter(Boolean)
    .map((contract) => getAddress(contract)))];
  const abi = new Interface([
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ]);
  const erc20 = [];
  for (const contract of usdcContracts) {
    const code = await rpc('eth_getCode', [contract, blockTag]);
    const call = async (signature, args = []) => rpc('eth_call', [{
      to: contract,
      data: abi.encodeFunctionData(signature, args),
    }, blockTag]);
    let symbol = 'UNKNOWN';
    try { symbol = abi.decodeFunctionResult('symbol', await call('symbol'))[0]; } catch { errors.push('ERC20_SYMBOL_UNAVAILABLE'); }
    let decimals = null;
    try { decimals = Number(abi.decodeFunctionResult('decimals', await call('decimals'))[0]); } catch { errors.push('ERC20_DECIMALS_UNAVAILABLE'); }
    let rawBalance = null;
    let balance = null;
    if (decimals !== null) {
      try {
        rawBalance = abi.decodeFunctionResult('balanceOf', await call('balanceOf', [address]))[0].toString();
        balance = formatUnits(BigInt(rawBalance), decimals);
      } catch { errors.push('ERC20_BALANCE_UNAVAILABLE'); }
    }
    erc20.push({
      contract,
      contractCodePresent: code !== '0x',
      symbol,
      decimals,
      rawBalance,
      balance,
      balanceScope: 'EVM_WALLET_ONLY_NOT_EXCHANGE_SUBACCOUNT',
    });
  }
  const orderBooks = [];
  for (const market of candidates) {
    try {
      const quote = await lcd('/injective/exchange/v1beta1/spot/mid_price_and_tob/' + market.marketId);
      const marketMetadata = candidates.find((candidate) => candidate.marketId === market.marketId);
      if (!marketMetadata) throw new Error('MARKET_METADATA_MISSING');
      const priceMarket = { baseDecimals: marketMetadata.baseDecimals, quoteDecimals: marketMetadata.quoteDecimals };
      const humanPrice = (value) => typeof value === 'string' ? formatSpotPrice(value, priceMarket) : null;
      orderBooks.push({
        marketId: market.marketId,
        midPrice: quote.mid_price ?? null,
        bestBuyPrice: quote.best_buy_price ?? null,
        bestSellPrice: quote.best_sell_price ?? null,
        midPriceHuman: humanPrice(quote.mid_price),
        bestBuyPriceHuman: humanPrice(quote.best_buy_price),
        bestSellPriceHuman: humanPrice(quote.best_sell_price),
      });
    } catch {
      orderBooks.push({ marketId: market.marketId, midPrice: null, bestBuyPrice: null, bestSellPrice: null, status: 'UNKNOWN' });
      errors.push('SPOT_ORDERBOOK_UNAVAILABLE');
    }
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cosmosTimestamp = cosmosTime ? Math.floor(Date.parse(cosmosTime) / 1000) : null;
  const crossChainDelta = cosmosTimestamp === null ? null : Math.abs(evmTimestamp - cosmosTimestamp);
  Object.assign(safeSnapshot, {
    operation: '62',
    status: Number(BigInt(chainId)) === 1439 && cosmosChainId === 'injective-888' ? 'READ_ONLY_PASS' : 'FAIL',
    observedAtStart,
    observedAtEnd: new Date().toISOString(),
    account: { addressLabel, addressSha256, nativeINJ: formatEther(BigInt(nativeRaw)), nativeINJWei: BigInt(nativeRaw).toString(), erc20 },
    exchangeSubaccount: {
      scope: 'OWNER_DEFAULT_SUBACCOUNT_NONCE_ZERO',
      subaccountIdSha256,
      blockNumber: BigInt(blockTag).toString(),
      balances: exchangeSubaccountBalances,
      note: 'Read-only subaccountDeposit precompile calls. This is the wallet owner default subaccount, not a Gate-owned subaccount.',
    },
    evm: {
      chainId: Number(BigInt(chainId)),
      blockNumber: BigInt(blockTag).toString(),
      blockHash: block.hash.toLowerCase(),
      blockTimestamp: new Date(evmTimestamp * 1000).toISOString(),
      wallClockAgeSeconds: nowSeconds - evmTimestamp,
      source: RPC,
    },
    cosmos: {
      chainId: cosmosChainId,
      latestHeight: cosmosHeight || 'UNKNOWN',
      blockHash: cosmosHash || 'UNKNOWN',
      blockTime: cosmosTime || 'UNKNOWN',
      evmCosmosBlockTimeDeltaSeconds: crossChainDelta,
      consistency: 'INDEPENDENT_UNPINNED_RPC_AND_LCD_READS',
      source: LCD + '/cosmos/base/tendermint/v1beta1/blocks/latest',
    },
    spotMarkets: {
      activeMarketCount: active.length,
      source: LCD + '/injective/exchange/v1beta1/spot/markets',
      marketMetadataConsistency: 'UNPINNED_LCD_READ',
      candidates,
      orderBooks,
    },
    execution: 'NOT_IMPLEMENTED',
    authorized: false,
    subaccountBalance: 'OWNER_DEFAULT_SUBACCOUNT_READ_ONLY_PROBE',
    orderSubmission: 'NOT_REQUESTED',
    errors: [...new Set(errors)],
    note: 'Read-only public EVM/LCD observations. EVM balances are not Injective Exchange subaccount balances. LCD market reads are independent and not pinned to the EVM block; the block-time delta is observational only.',
  });
  const body = JSON.stringify(safeSnapshot, null, 2) + '\n';
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, body, { mode: 0o600 });
  console.log(JSON.stringify({
    status: safeSnapshot.status,
    address: addressLabel,
    evmBlock: safeSnapshot.evm.blockNumber,
    nativeINJ: safeSnapshot.account.nativeINJ,
    erc20: safeSnapshot.account.erc20.map(({ contract, symbol, balance, decimals, contractCodePresent }) => ({ contract, symbol, balance, decimals, contractCodePresent })),
    exchangeSubaccount: safeSnapshot.exchangeSubaccount.balances,
    activeSpotMarkets: active.length,
    candidateMarkets: candidates.map(({ ticker, marketId, quoteDenom, priceTick, quantityTick, minimumNotional, takerFeeRate }) => ({ ticker, marketId, quoteDenom, priceTick, quantityTick, minimumNotional, takerFeeRate })),
    orderBooks,
    cosmosHeight: cosmosHeight || 'UNKNOWN',
    crossChainBlockTimeDeltaSeconds: crossChainDelta,
    execution: safeSnapshot.execution,
    output: OUTPUT,
  }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : 'READ_FAILED';
  console.error(JSON.stringify({ status: 'READ_FAILED', reason: message, source: [RPC, LCD] }));
  process.exitCode = 1;
}
