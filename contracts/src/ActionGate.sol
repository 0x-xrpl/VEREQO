// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IExchangeSpotOrderPrecompile} from "./IExchangeSpotOrderPrecompile.sol";
import {ActionGateExchangeWithdrawal} from "./ActionGateExchangeWithdrawal.sol";

/// @notice A production adapter must cryptographically verify ALL supplied inputs.
interface IMandateProofVerifier {
    function issuer() external view returns (address);
    function verify(bytes calldata proof, bytes32 commitment, bytes32 contextDigest, uint256 exposure, uint256 credentialEpoch, uint256 currentPolicyEpoch, uint64 credentialExpiry) external view returns (bool);
}

/// @notice Local/testnet-gated ActionGate. The ERC20 path remains separate from the
/// direct Injective spot-order path. This source has not been deployed or audited.
contract ActionGate {
    address public immutable issuer;
    address public immutable principal;
    address public immutable asset;
    address private immutable exchangeWithdrawalLogic;
    IMandateProofVerifier public immutable verifier;
    bytes32 public immutable verifierCodeHash;
    /// @notice Transfer-only deployments keep the historic ERC20 route; order deployments are isolated.
    bool public immutable orderOnlyMode;
    uint256 public policyEpoch = 1;
    bool public orderBudgetConfigured;
    bytes32 public orderBudgetMarketId;
    bytes32 public orderBudgetQuoteDenomHash;
    uint256 public orderBudgetCap;
    uint256 public orderTotalSpent;
    bool public ordersPaused;
    bool private entered;
    bool public orderDenomsConfigured;
    string private orderBaseDenom;
    string private orderQuoteDenom;
    bytes32 public orderBaseDenomHash;
    uint256 public activeTrackedOrderCount;
    struct Mandate { bytes32 commitment; address agent; uint256 epoch; uint64 expiry; uint256 cap; uint256 spent; bool active; }
    struct TransferIntent { address asset; address recipient; address agent; bytes32 credential; uint256 credentialEpoch; uint256 policyEpoch; uint256 amount; uint256 nonce; uint64 deadline; }
    struct OrderMandateConfig {
        bytes32 commitment; address agent; uint256 epoch; uint64 expiry; uint256 cap;
        bytes32 marketId; bytes32 subaccountId; bytes32 marketConfigHash;
        uint256 priceTick; uint256 quantityTick; uint256 maxFeeRate; bool active;
    }
    struct OrderMandate {
        bytes32 commitment; address agent; uint256 epoch; uint64 expiry; uint256 cap; uint256 spent;
        bytes32 marketId; bytes32 subaccountId; bytes32 marketConfigHash;
        uint256 priceTick; uint256 quantityTick; uint256 maxFeeRate; bool active;
    }
    struct TrackedOrder {
        bool exists;
        bool terminalAcknowledged;
        bytes32 credentialId;
        bytes32 marketId;
        bytes32 subaccountId;
        uint256 nonce;
        uint256 exposure;
        uint256 price;
        uint256 quantity;
        string orderHash;
        string cid;
    }
    /// EIP-712 field order matches packages/domain/src/native-order.ts.
    struct SpotLimitOrderIntent {
        address sender; address issuer; address principal; address agent;
        bytes32 credentialId; bytes32 marketId; bytes32 subaccountId; bytes32 marketConfigHash; bytes32 disclosureRequestId;
        uint256 chainId; uint256 credentialEpoch; uint256 policyEpoch;
        uint256 price; uint256 quantity; uint256 priceTick; uint256 quantityTick;
        uint256 nonce; uint256 deadline; uint256 maxNotional; uint256 maxFeeRate; uint256 maxTotalExposure;
        string side; string orderType;
    }
    mapping(bytes32 => Mandate) public mandates;
    mapping(uint256 => bool) public usedNonces;
    mapping(bytes32 => OrderMandate) private orderMandates;
    mapping(bytes32 => TrackedOrder) private trackedOrders;
    bytes32[] private activeOrderDigests;
    mapping(bytes32 => uint256) private activeOrderIndexPlusOne;
    bytes32 private constant TYPEHASH = keccak256("ProtectedTransfer(address asset,address recipient,address agent,bytes32 credential,uint256 credentialEpoch,uint256 policyEpoch,uint256 amount,uint256 nonce,uint64 deadline)");
    uint256 public constant INJECTIVE_TESTNET_EVM_CHAIN_ID = 1439;
    address public constant EXCHANGE_PRECOMPILE = address(0x65);
    uint256 private constant WAD = 1e18;
    uint256 public constant MAX_ACTIVE_TRACKED_ORDERS = 32;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ORDER_INTENT_TYPEHASH = keccak256("NativeOrderIntent(address sender,address issuer,address principal,address agent,bytes32 credentialId,bytes32 marketId,bytes32 subaccountId,bytes32 marketConfigHash,bytes32 disclosureRequestId,uint256 credentialEpoch,uint256 policyEpoch,uint256 price,uint256 quantity,uint256 priceTick,uint256 quantityTick,uint256 nonce,uint256 deadline,uint256 maxNotional,uint256 maxFeeRate,uint256 maxTotalExposure,string side,string orderType)");
    event TransferExecuted(bytes32 indexed digest, bytes32 indexed credential, uint256 nonce, address recipient, uint256 amount);
    event OrderMandateUpdated(bytes32 indexed credentialId, uint256 indexed epoch, bool active, uint256 cap);
    event OrderBudgetConfigured(bytes32 indexed marketId, bytes32 indexed quoteDenomHash, uint256 cap);
    event OrderBudgetCapIncreased(uint256 oldCap, uint256 newCap);
    event SpotLimitOrderCallSucceeded(bytes32 indexed intentDigest, bytes32 indexed credentialId, uint256 indexed nonce, uint256 exposure, string orderHash, string cid);
    event OrdersPaused(address indexed actor);
    event OrdersResumed(address indexed principal);
    event SpotOrderCancellationAttempted(bytes32 indexed intentDigest, string orderHash, string cid, bool acknowledged);
    event OrderDenomsConfigured(bytes32 indexed baseDenomHash, bytes32 indexed quoteDenomHash);
    event ExchangeDepositAttempted(address indexed principal, bytes32 indexed denomHash, uint256 amount, bool success);
    event SpotOrderReconciled(bytes32 indexed intentDigest, bool stillOpen, uint256 fillable);
    event ExchangeFundsReturnedToPrincipal(address indexed principal, bytes32 indexed denomHash, uint256 amount, uint256 availableBefore);
    event ExchangeQuoteWithdrawnToGate(address indexed principal, bytes32 indexed denomHash, uint256 amount, uint256 availableBefore, uint256 bankBalanceAfter);
    constructor(address issuer_, address principal_, address asset_, IMandateProofVerifier verifier_, bool orderOnlyMode_) {
        require(issuer_ != address(0) && principal_ != address(0) && asset_.code.length > 0 && address(verifier_).code.length > 0, "CONFIG");
        require(verifier_.issuer() == issuer_, "VERIFIER_ISSUER");
        issuer = issuer_; principal = principal_; asset = asset_; verifier = verifier_; verifierCodeHash = address(verifier_).codehash;
        exchangeWithdrawalLogic = address(new ActionGateExchangeWithdrawal());
        orderOnlyMode = orderOnlyMode_;
    }
    /// Issuer tx authenticates the commitment; never expose its private opening here.
    /// Cap is a PUBLIC conservative cumulative transfer ceiling, not the secret predicate.
    /// Used exposure survives credential updates, revocation and epoch changes.
    function setMandate(bytes32 id, bytes32 commitment, address agent, uint256 epoch, uint64 expiry, uint256 cap, bool active) external {
        require(msg.sender == issuer && !entered, "ISSUER");
        Mandate storage old = mandates[id];
        require(id != bytes32(0) && commitment != bytes32(0) && agent != address(0) && epoch > old.epoch && cap >= old.spent, "MANDATE");
        mandates[id] = Mandate(commitment, agent, epoch, expiry, cap, old.spent, active);
    }
    function orderMandateSpent(bytes32 id) external view returns (uint256) {
        return orderMandates[id].spent;
    }
    /// @notice Read-only full registration for issuer-side fail-closed reconciliation.
    function getOrderMandate(bytes32 id) external view returns (OrderMandate memory) {
        return orderMandates[id];
    }
    /// Issuer policy is scoped to this Gate-owned subaccount and one configured spot market.
    /// This Direct precompile mode needs no Exchange AuthZ grant from the principal's wallet.
    /// It does not control orders from the principal's personal subaccount; those are separate.
    /// Deposit and recovery are Direct calls from this Gate's own subaccount; they never use principal AuthZ.
    /// Market ticks, fee ceiling and config hash are issuer inputs, not a live market-state proof.
    function setOrderMandate(bytes32 id, OrderMandateConfig calldata c) external {
        require(orderOnlyMode && msg.sender == issuer && !entered && orderBudgetConfigured, "ISSUER");
        OrderMandate storage old = orderMandates[id];
        require(
            id != bytes32(0) && c.commitment != bytes32(0) && c.agent != address(0) &&
            c.epoch > old.epoch && c.expiry != 0 && c.cap >= old.spent && c.cap <= orderBudgetCap &&
            c.marketId == orderBudgetMarketId &&
            c.marketId != bytes32(0) && c.marketConfigHash != bytes32(0) &&
            c.subaccountId == _defaultSubaccountId(address(this)) &&
            c.priceTick != 0 && c.quantityTick != 0 && c.maxFeeRate <= WAD,
            "ORDER_MANDATE"
        );
        orderMandates[id] = OrderMandate(
            c.commitment, c.agent, c.epoch, c.expiry, c.cap, old.spent,
            c.marketId, c.subaccountId, c.marketConfigHash,
            c.priceTick, c.quantityTick, c.maxFeeRate, c.active
        );
        emit OrderMandateUpdated(id, c.epoch, c.active, c.cap);
    }
    /// @notice One market/quote unit per new order-only Gate; never mutable after initialization.
    function configureOrderBudget(bytes32 marketId, bytes32 quoteDenomHash, uint256 cap) external {
        require(orderOnlyMode && msg.sender == principal && !entered, "PRINCIPAL");
        require(!orderBudgetConfigured && marketId != bytes32(0) && quoteDenomHash != bytes32(0) && cap != 0, "ORDER_BUDGET");
        orderBudgetConfigured = true;
        orderBudgetMarketId = marketId;
        orderBudgetQuoteDenomHash = quoteDenomHash;
        orderBudgetCap = cap;
        emit OrderBudgetConfigured(marketId, quoteDenomHash, cap);
    }
    /// @notice Principal pins the only two Exchange denoms this Gate may deposit or recover.
    /// The quote hash must match the already-fixed order budget; values cannot later change.
    function configureOrderDenoms(string calldata baseDenom, string calldata quoteDenom) external {
        require(orderOnlyMode && msg.sender == principal && !entered, "PRINCIPAL");
        require(orderBudgetConfigured && !orderDenomsConfigured, "ORDER_DENOMS");
        require(_validDenom(baseDenom) && _validDenom(quoteDenom), "DENOM_FORMAT");
        require(keccak256(bytes(baseDenom)) != keccak256(bytes(quoteDenom)), "DENOM_DUPLICATE");
        require(keccak256(bytes(quoteDenom)) == orderBudgetQuoteDenomHash, "QUOTE_DENOM_MISMATCH");
        orderBaseDenom = baseDenom;
        orderQuoteDenom = quoteDenom;
        orderBaseDenomHash = keccak256(bytes(baseDenom));
        orderDenomsConfigured = true;
        emit OrderDenomsConfigured(orderBaseDenomHash, keccak256(bytes(quoteDenom)));
    }
    /// @notice Increases the aggregate ceiling only; it cannot change market or quote units.
    function increaseOrderBudgetCap(uint256 newCap) external {
        require(orderOnlyMode && msg.sender == principal && !entered, "PRINCIPAL");
        require(orderBudgetConfigured && newCap > orderBudgetCap && newCap >= orderTotalSpent, "ORDER_BUDGET");
        uint256 oldCap = orderBudgetCap;
        orderBudgetCap = newCap;
        emit OrderBudgetCapIncreased(oldCap, newCap);
    }
    function pauseOrders() external {
        require(orderOnlyMode && (msg.sender == principal || msg.sender == issuer) && !entered, "PAUSE_AUTHORITY");
        ordersPaused = true;
        emit OrdersPaused(msg.sender);
    }
    function resumeOrders() external {
        require(orderOnlyMode && msg.sender == principal && !entered, "PRINCIPAL");
        ordersPaused = false;
        emit OrdersResumed(msg.sender);
    }
    function getTrackedOrder(bytes32 intentDigest) external view returns (TrackedOrder memory) {
        return trackedOrders[intentDigest];
    }
    function activeOrderDigestAt(uint256 index) external view returns (bytes32) {
        require(index < activeOrderDigests.length, "ORDER_INDEX");
        return activeOrderDigests[index];
    }
    /// @notice Bounded one-order cancellation. It remains available after revocation or pause.
    function cancelTrackedOrder(bytes32 intentDigest) external returns (bool acknowledged) {
        require(orderOnlyMode && (msg.sender == principal || msg.sender == issuer) && !entered, "CANCEL_AUTHORITY");
        TrackedOrder storage tracked = trackedOrders[intentDigest];
        require(tracked.exists && !tracked.terminalAcknowledged, "UNKNOWN_OR_TERMINAL_ORDER");
        entered = true;
        try IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).cancelSpotOrder(
            address(this), _hexString(tracked.marketId), _hexString(tracked.subaccountId), tracked.orderHash, tracked.cid
        ) returns (bool success) {
            acknowledged = success;
        } catch { acknowledged = false; }
        if (acknowledged) _markOrderTerminal(intentDigest, tracked);
        emit SpotOrderCancellationAttempted(intentDigest, tracked.orderHash, tracked.cid, acknowledged);
        entered = false;
    }
    /// @notice Reconcile a tracked order using the pinned Exchange order query. Query failure or
    /// malformed output reverts and leaves the order active; absence/zero fillable is terminal.
    function reconcileTrackedOrder(bytes32 intentDigest) external returns (bool terminal) {
        require(orderOnlyMode && (msg.sender == principal || msg.sender == issuer) && !entered, "RECONCILE_AUTHORITY");
        TrackedOrder storage tracked = trackedOrders[intentDigest];
        require(tracked.exists && !tracked.terminalAcknowledged, "UNKNOWN_OR_TERMINAL_ORDER");
        entered = true;
        string[] memory hashes = new string[](1);
        hashes[0] = tracked.orderHash;
        IExchangeSpotOrderPrecompile.SpotOrdersRequest memory request = IExchangeSpotOrderPrecompile.SpotOrdersRequest({
            marketID: _hexString(tracked.marketId),
            subaccountID: _hexString(tracked.subaccountId),
            orderHashes: hashes
        });
        IExchangeSpotOrderPrecompile.TrimmedSpotLimitOrder[] memory orders =
            IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).spotOrdersByHashes(request);
        uint256 fillable;
        if (orders.length == 0) {
            terminal = true;
        } else {
            require(orders.length == 1, "ORDER_QUERY_CARDINALITY");
            require(
                keccak256(bytes(orders[0].orderHash)) == keccak256(bytes(tracked.orderHash)) &&
                keccak256(bytes(orders[0].cid)) == keccak256(bytes(tracked.cid)) &&
                orders[0].price == tracked.price && orders[0].quantity == tracked.quantity &&
                orders[0].isBuy && orders[0].quantity != 0 && orders[0].fillable <= orders[0].quantity,
                "ORDER_QUERY_MISMATCH"
            );
            fillable = orders[0].fillable;
            terminal = fillable == 0;
        }
        if (terminal) _markOrderTerminal(intentDigest, tracked);
        emit SpotOrderReconciled(intentDigest, !terminal, fillable);
        entered = false;
    }
    /// @notice Deposit only the configured quote denom from the Gate's matching Bank/ERC20 balance.
    /// Base-denom deposits are disabled because this Gate exposes only one immutable ERC20 asset mapping.
    function depositOrderAsset(bool quoteAsset, uint256 amount) external returns (bool success) {
        require(orderOnlyMode && msg.sender == principal && !entered, "DEPOSIT_AUTHORITY");
        require(quoteAsset, "DEPOSIT_QUOTE_ONLY");
        require(orderDenomsConfigured && amount != 0, "DEPOSIT_CONFIG");
        entered = true;
        string memory denom = orderQuoteDenom;
        (bool ok, bytes memory result) = exchangeWithdrawalLogic.delegatecall(abi.encodeWithSelector(
            ActionGateExchangeWithdrawal.depositQuote.selector,
            asset, _hexString(_defaultSubaccountId(address(this))), denom, amount
        ));
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        require(result.length == 96, "DEPOSIT_RETURN_INVALID");
        success = true;
        emit ExchangeDepositAttempted(principal, keccak256(bytes(denom)), amount, success);
        entered = false;
    }
    /// @notice Return only available Exchange funds to the principal's default Exchange subaccount.
    /// Requires paused order creation and no known active orders. This is NOT a bank/EVM withdrawal.
    function recoverExchangeAsset(bool quoteAsset, uint256 amount) external returns (bool success) {
        require(orderOnlyMode && msg.sender == principal && !entered, "RECOVERY_AUTHORITY");
        require(ordersPaused && orderDenomsConfigured && activeTrackedOrderCount == 0 && amount != 0, "RECOVERY_STATE");
        entered = true;
        string memory denom = quoteAsset ? orderQuoteDenom : orderBaseDenom;
        bytes32 sourceId = _defaultSubaccountId(address(this));
        (bool ok, bytes memory result) = exchangeWithdrawalLogic.delegatecall(abi.encodeWithSelector(
            ActionGateExchangeWithdrawal.transferToPrincipal.selector,
            _hexString(sourceId), _hexString(_defaultSubaccountId(principal)), denom, amount
        ));
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        require(result.length == 32, "RECOVERY_RETURN_INVALID");
        uint256 availableBalance = abi.decode(result, (uint256));
        success = true;
        emit ExchangeFundsReturnedToPrincipal(principal, keccak256(bytes(denom)), amount, availableBalance);
        entered = false;
    }
    /// @notice Withdraw only the configured quote denom from Exchange to this Gate's Bank/EVM account.
    /// This does not return funds to the principal. Call recoverIdleAsset separately after reconciliation.
    /// Exact BankERC20 balance delta is required so an unmapped/wrong token cannot strand funds silently.
    function withdrawQuoteExchangeAssetToGate(uint256 amount) external returns (bool success) {
        require(orderOnlyMode && msg.sender == principal && !entered, "WITHDRAW_AUTHORITY");
        require(ordersPaused && orderDenomsConfigured && orderBudgetConfigured && activeTrackedOrderCount == 0 && amount != 0, "WITHDRAW_STATE");
        require(keccak256(bytes(orderQuoteDenom)) == orderBudgetQuoteDenomHash, "QUOTE_DENOM_MISMATCH");
        entered = true;
        (bool ok, bytes memory result) = exchangeWithdrawalLogic.delegatecall(abi.encodeWithSelector(
            ActionGateExchangeWithdrawal.withdrawQuote.selector,
            asset, _hexString(_defaultSubaccountId(address(this))), orderQuoteDenom, amount
        ));
        if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        require(result.length == 64, "WITHDRAW_RETURN_INVALID");
        (uint256 availableBefore, uint256 bankBalanceAfter) = abi.decode(result, (uint256, uint256));
        success = true;
        emit ExchangeQuoteWithdrawnToGate(principal, orderBudgetQuoteDenomHash, amount, availableBefore, bankBalanceAfter);
        entered = false;
    }
    event IdleAssetRecovered(address indexed principal, address indexed asset, uint256 amount);
    /// @notice Recover only the configured ERC20 already held by this Gate.
    /// Does not withdraw Exchange subaccount funds, cancel orders, or release spent budget.
    /// Principal-only and available even after all mandates expire or are revoked.
    function recoverIdleAsset(uint256 amount) external {
        require(msg.sender == principal && !entered, "RECOVERY_AUTHORITY");
        require(amount != 0, "RECOVERY_AMOUNT");
        entered = true;
        uint256 gateBefore = _recoveryTokenBalance(address(this));
        uint256 principalBefore = _recoveryTokenBalance(principal);
        require(gateBefore >= amount, "RECOVERY_BALANCE");
        (bool ok, bytes memory result) = asset.call(abi.encodeWithSignature("transfer(address,uint256)", principal, amount));
        require(ok && (result.length == 0 || (result.length == 32 && abi.decode(result, (uint256)) == 1)), "TOKEN_TRANSFER");
        uint256 principalAfter = _recoveryTokenBalance(principal);
        require(
            _recoveryTokenBalance(address(this)) == gateBefore - amount &&
            principalAfter >= principalBefore && principalAfter - principalBefore == amount,
            "RECOVERY_BALANCE_MISMATCH"
        );
        emit IdleAssetRecovered(principal, asset, amount);
        entered = false;
    }
    /// Exact recovery is required; no-op, fee-on-transfer, and mismatched-credit tokens fail closed.
    function _recoveryTokenBalance(address account) private view returns (uint256) {
        (bool ok, bytes memory result) = asset.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        require(ok && result.length == 32, "RECOVERY_BALANCE_QUERY");
        return abi.decode(result, (uint256));
    }
    function advancePolicy() external { require(msg.sender == principal && !entered, "PRINCIPAL"); policyEpoch++; }
    function digest(TransferIntent memory i) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("VEREQO Protected Transfer"),keccak256("1"),block.chainid,address(this)));
        return keccak256(abi.encodePacked(hex"1901",domain,keccak256(abi.encode(TYPEHASH,i))));
    }
    /// Digest matches the public order-intent codec. Every order field is committed.
    function spotOrderDigest(SpotLimitOrderIntent memory i) public view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256(bytes("VEREQO Execution")),
            keccak256(bytes("2")),
            i.chainId,
            address(this)
        ));
        bytes32[23] memory words;
        words[0] = ORDER_INTENT_TYPEHASH;
        words[1] = bytes32(uint256(uint160(i.sender)));
        words[2] = bytes32(uint256(uint160(i.issuer)));
        words[3] = bytes32(uint256(uint160(i.principal)));
        words[4] = bytes32(uint256(uint160(i.agent)));
        words[5] = i.credentialId;
        words[6] = i.marketId;
        words[7] = i.subaccountId;
        words[8] = i.marketConfigHash;
        words[9] = i.disclosureRequestId;
        words[10] = bytes32(i.credentialEpoch);
        words[11] = bytes32(i.policyEpoch);
        words[12] = bytes32(i.price);
        words[13] = bytes32(i.quantity);
        words[14] = bytes32(i.priceTick);
        words[15] = bytes32(i.quantityTick);
        words[16] = bytes32(i.nonce);
        words[17] = bytes32(i.deadline);
        words[18] = bytes32(i.maxNotional);
        words[19] = bytes32(i.maxFeeRate);
        words[20] = bytes32(i.maxTotalExposure);
        words[21] = keccak256(bytes(i.side));
        words[22] = keccak256(bytes(i.orderType));
        bytes32 structHash = keccak256(abi.encodePacked(words));
        return keccak256(abi.encodePacked(hex"1901", domain, structHash));
    }
    function execute(TransferIntent calldata i, bytes calldata signature, bytes calldata proof) external {
        require(!orderOnlyMode, "ORDER_ONLY");
        require(!entered, "REENTRANCY"); entered = true;
        Mandate storage m = mandates[i.credential];
        require(msg.sender == i.agent && m.agent == i.agent && m.active, "AGENT");
        require(i.asset == asset && i.recipient != address(0) && i.recipient != address(this) && i.amount > 0, "TRANSFER");
        require(i.deadline >= block.timestamp && m.expiry >= block.timestamp, "EXPIRED");
        require(i.credentialEpoch == m.epoch && i.policyEpoch == policyEpoch, "EPOCH");
        require(!usedNonces[i.nonce], "REPLAY");
        require(i.amount <= m.cap - m.spent, "CUMULATIVE_CAP");
        bytes32 d = digest(i);
        require(recover(d, signature) == principal, "SIGNATURE");
        require(address(verifier).codehash == verifierCodeHash && verifier.verify(proof,m.commitment,d,i.amount,m.epoch,policyEpoch,m.expiry), "PROOF");
        usedNonces[i.nonce] = true; m.spent += i.amount;
        // Only this fixed token transfer is reachable; no arbitrary calldata/delegatecall.
        (bool ok, bytes memory result) = asset.call(abi.encodeWithSignature("transfer(address,uint256)",i.recipient,i.amount));
        require(ok && (result.length == 0 || (result.length == 32 && abi.decode(result,(uint256)) == 1)), "TOKEN_TRANSFER");
        emit TransferExecuted(d,i.credential,i.nonce,i.recipient,i.amount);
        entered = false;
    }
    /// One fixed Direct-mode Exchange Precompile operation. The Exchange actor is this
    /// contract and the configured subaccount is Gate-owned; no generic call/delegatecall exists.
    function executeSpotLimitOrder(
        SpotLimitOrderIntent calldata i,
        bytes calldata signature,
        bytes calldata proof
    ) external returns (string memory orderHash, string memory cid) {
        require(orderOnlyMode, "TRANSFER_ONLY");
        require(!ordersPaused, "ORDERS_PAUSED");
        require(!entered, "REENTRANCY");
        entered = true;
        uint256 exposure = _validateSpotOrder(i);
        bytes32 d = _authorizeSpotOrder(i, exposure, signature, proof);
        _reserveSpotOrder(i, exposure);
        (orderHash, cid) = _callSpotOrder(i, d);
        trackedOrders[d] = TrackedOrder(true, false, i.credentialId, i.marketId, i.subaccountId, i.nonce, exposure, i.price, i.quantity, orderHash, cid);
        _trackOrder(d);
        emit SpotLimitOrderCallSucceeded(d, i.credentialId, i.nonce, exposure, orderHash, cid);
        entered = false;
    }
    function _validateSpotOrder(SpotLimitOrderIntent calldata i) private view returns (uint256 exposure) {
        require(!ordersPaused, "ORDERS_PAUSED");
        require(orderBudgetConfigured && i.marketId == orderBudgetMarketId, "ORDER_BUDGET_MARKET");
        require(block.chainid == INJECTIVE_TESTNET_EVM_CHAIN_ID && i.chainId == block.chainid, "CHAIN");
        require(
            i.sender == address(this) && i.issuer == issuer &&
            i.principal == principal && i.agent != address(0) && msg.sender == i.agent,
            "ACTOR"
        );
        OrderMandate storage m = orderMandates[i.credentialId];
        require(m.active && m.commitment != bytes32(0) && m.agent == i.agent, "ORDER_AUTH");
        require(
            i.credentialEpoch == m.epoch && i.policyEpoch == policyEpoch &&
            i.credentialEpoch <= type(uint64).max && i.policyEpoch <= type(uint64).max,
            "EPOCH"
        );
        require(
            i.deadline <= type(uint64).max && i.deadline > block.timestamp &&
            m.expiry > block.timestamp && i.deadline <= m.expiry,
            "EXPIRED"
        );
        require(
            i.marketId == m.marketId && i.subaccountId == m.subaccountId &&
            i.marketConfigHash == m.marketConfigHash &&
            _subaccountOwner(i.subaccountId) == address(this),
            "ORDER_CONFIG"
        );
        require(
            i.priceTick == m.priceTick && i.quantityTick == m.quantityTick &&
            i.price != 0 && i.quantity != 0 &&
            i.price % m.priceTick == 0 && i.quantity % m.quantityTick == 0,
            "ORDER_TICK"
        );
        // This minimal executor supports BUY LIMIT only. SELL requires an independently
        // enforced base-inventory check against the configured subaccount balance.
        require(
            keccak256(bytes(i.side)) == keccak256(bytes("BUY")) &&
            keccak256(bytes(i.orderType)) == keccak256(bytes("LIMIT")),
            "ORDER_TYPE"
        );
        require(i.maxNotional != 0 && i.maxTotalExposure != 0 && i.disclosureRequestId != bytes32(0), "ORDER_LIMIT");
        // The Exchange order has no fee-cap field. Require the signed intent to
        // match the issuer's ceiling, and reserve against that ceiling so the
        // local exposure ledger cannot be reduced by choosing a lower intent fee.
        require(i.maxFeeRate == m.maxFeeRate && i.maxFeeRate <= WAD, "ORDER_FEE_POLICY");
        require(!usedNonces[i.nonce], "REPLAY");
        require(activeTrackedOrderCount < MAX_ACTIVE_TRACKED_ORDERS, "ACTIVE_ORDER_LIMIT");
        exposure = _spotOrderExposure(i, m.maxFeeRate);
        require(
            exposure <= i.maxTotalExposure &&
            i.maxTotalExposure <= m.cap - m.spent &&
            exposure <= orderBudgetCap - orderTotalSpent,
            "ORDER_CAP"
        );
        // No pinned native market-state reader or future-fee reservation is implemented.
        // The production Gate therefore rejects every new order until a reviewed
        // native risk implementation replaces this fail-closed hook.
        require(_marketRiskVerified(i.marketId, i.marketConfigHash), "MARKET_RISK_UNVERIFIED");
    }
    function _marketRiskVerified(bytes32, bytes32) internal pure virtual returns (bool) {
        return false;
    }
    function _authorizeSpotOrder(
        SpotLimitOrderIntent calldata i,
        uint256 exposure,
        bytes calldata signature,
        bytes calldata proof
    ) private view returns (bytes32 d) {
        OrderMandate storage m = orderMandates[i.credentialId];
        d = spotOrderDigest(i);
        require(recover(d, signature) == principal, "SIGNATURE");
        require(
            address(verifier).codehash == verifierCodeHash &&
            verifier.verify(proof, m.commitment, d, exposure, m.epoch, policyEpoch, m.expiry),
            "PROOF"
        );
    }
    function _reserveSpotOrder(SpotLimitOrderIntent calldata i, uint256 exposure) private {
        OrderMandate storage m = orderMandates[i.credentialId];
        usedNonces[i.nonce] = true;
        m.spent += exposure;
        orderTotalSpent += exposure;
    }
    function _callSpotOrder(
        SpotLimitOrderIntent calldata i,
        bytes32 d
    ) private returns (string memory orderHash, string memory cid) {
        string memory orderType = "buy";
        string memory orderCid = _hexString(d);
        IExchangeSpotOrderPrecompile.SpotOrder memory order = IExchangeSpotOrderPrecompile.SpotOrder({
            marketID: _hexString(i.marketId),
            subaccountID: _hexString(i.subaccountId),
            feeRecipient: "",
            price: i.price,
            quantity: i.quantity,
            cid: orderCid,
            orderType: orderType,
            triggerPrice: 0
        });
        IExchangeSpotOrderPrecompile.CreateSpotLimitOrderResponse memory response;
        try IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).createSpotLimitOrder(address(this), order)
            returns (IExchangeSpotOrderPrecompile.CreateSpotLimitOrderResponse memory created)
        {
            response = created;
        } catch {
            revert("PRECOMPILE");
        }
        require(
            bytes(response.orderHash).length != 0 &&
            keccak256(bytes(response.cid)) == keccak256(bytes(orderCid)),
            "PRECOMPILE_RESPONSE"
        );
        return (response.orderHash, response.cid);
    }
    function _spotOrderExposure(
        SpotLimitOrderIntent calldata i,
        uint256 issuerMaxFeeRate
    ) private pure returns (uint256) {
        require(i.price <= type(uint256).max / i.quantity, "ORDER_OVERFLOW");
        uint256 product = i.price * i.quantity;
        uint256 notional = _ceilDiv(product, WAD);
        require(notional <= i.maxNotional, "MAX_NOTIONAL");
        uint256 feeProduct;
        if (issuerMaxFeeRate != 0) {
            require(notional <= type(uint256).max / issuerMaxFeeRate, "ORDER_OVERFLOW");
            feeProduct = notional * issuerMaxFeeRate;
        }
        uint256 fee = _ceilDiv(feeProduct, WAD);
        require(notional <= type(uint256).max - fee, "ORDER_OVERFLOW");
        uint256 exposure = notional + fee;
        require(exposure < (uint256(1) << 128), "ORDER_RANGE");
        return exposure;
    }
    function _ceilDiv(uint256 n, uint256 d) private pure returns (uint256) {
        return n / d + (n % d == 0 ? 0 : 1);
    }
    function _subaccountOwner(bytes32 id) private pure returns (address) {
        return address(uint160(uint256(id) >> 96));
    }
    function _defaultSubaccountId(address owner) private pure returns (bytes32) {
        return bytes32(uint256(uint160(owner)) << 96);
    }
    function _validDenom(string calldata denom) private pure returns (bool) {
        bytes memory value = bytes(denom);
        if (value.length == 0 || value.length > 128) return false;
        for (uint256 index; index < value.length; index++) {
            uint8 ch = uint8(value[index]);
            bool alpha = (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
            bool digit = ch >= 48 && ch <= 57;
            if (!alpha && !digit && ch != 47 && ch != 46 && ch != 95 && ch != 45) return false;
        }
        return true;
    }
    function _trackOrder(bytes32 intentDigest) private {
        require(activeOrderIndexPlusOne[intentDigest] == 0, "ORDER_ALREADY_TRACKED");
        activeOrderDigests.push(intentDigest);
        activeOrderIndexPlusOne[intentDigest] = activeOrderDigests.length;
        activeTrackedOrderCount = activeOrderDigests.length;
    }
    function _markOrderTerminal(bytes32 intentDigest, TrackedOrder storage tracked) private {
        tracked.terminalAcknowledged = true;
        uint256 indexPlusOne = activeOrderIndexPlusOne[intentDigest];
        require(indexPlusOne != 0, "ORDER_TRACKING_STATE");
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = activeOrderDigests.length - 1;
        if (index != lastIndex) {
            bytes32 movedDigest = activeOrderDigests[lastIndex];
            activeOrderDigests[index] = movedDigest;
            activeOrderIndexPlusOne[movedDigest] = index + 1;
        }
        activeOrderDigests.pop();
        delete activeOrderIndexPlusOne[intentDigest];
        activeTrackedOrderCount = activeOrderDigests.length;
    }
    function _hexString(bytes32 value) private pure returns (string memory) {
        bytes16 symbols = "0123456789abcdef";
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < 32; i++) {
            uint8 b = uint8(value[i]);
            out[2 + i * 2] = symbols[b >> 4];
            out[3 + i * 2] = symbols[b & 0x0f];
        }
        return string(out);
    }
    function recover(bytes32 d, bytes calldata signature) private pure returns (address signer) {
        require(signature.length == 65, "SIGNATURE_LENGTH");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset,32)) v := byte(0,calldataload(add(signature.offset,64))) }
        require(uint256(s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 && (v == 27 || v == 28), "SIGNATURE_CANONICAL");
        signer = ecrecover(d,v,r,s); require(signer != address(0), "SIGNATURE_RECOVERY");
    }
}
