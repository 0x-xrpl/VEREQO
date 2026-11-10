// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ActionGate, IMandateProofVerifier} from "../src/ActionGate.sol";
import {ActionGateExchangeWithdrawal} from "../src/ActionGateExchangeWithdrawal.sol";
import {IExchangeSpotOrderPrecompile} from "../src/IExchangeSpotOrderPrecompile.sol";
import {Groth16Verifier} from "../src/LocalGroth16Verifier.sol";
import {LocalMandateVerifier} from "../src/LocalMandateVerifier.sol";
import {GateToken} from "./ActionGate.t.sol";
import {MockRiskEnabledActionGate} from "./MockRiskEnabledActionGate.sol";

interface VmSpotOrder {
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function chainId(uint256) external;
    function warp(uint256) external;
    function etch(address, bytes calldata) external;
    function store(address, bytes32, bytes32) external;
    function expectRevert(bytes calldata) external;
    function readFile(string calldata) external view returns (string memory);
    function parseJsonAddress(string calldata, string calldata) external pure returns (address);
    function parseJsonBytes(string calldata, string calldata) external pure returns (bytes memory);
    function parseJsonBytes32(string calldata, string calldata) external pure returns (bytes32);
}

/// Local mock of the pinned createSpotLimitOrder ABI. It enforces the documented
/// Direct-mode actor rule: the sender argument must be the EVM caller.
contract MockExchangeSpotOrder is IExchangeSpotOrderPrecompile {
    bool public shouldRevert;
    uint8 public responseMode;
    bool public cancelShouldRevert;
    bool public cancelReturnsTrue = true;
    uint256 public cancellations;
    uint256 public calls;
    address public lastCaller;
    address public lastSender;
    string public lastMarketID;
    string public lastSubaccountID;
    uint256 public lastPrice;
    uint256 public lastQuantity;
    string public lastCid;
    string public lastOrderType;
    uint256 public lastTriggerPrice;
    address public lastCancelCaller;
    address public lastCancelSender;
    string public lastCancelMarketID;
    string public lastCancelSubaccountID;
    string public lastCancelOrderHash;
    string public lastCancelCid;
    address public reentryTarget;
    bytes private reentryCallData;
    bytes public lastReentryReturnData;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bool public depositShouldFail;
    address public depositToken;
    bool public withdrawShouldFail;
    bool public transferShouldFail;
    bool public transferNoop;
    bool public queryShouldRevert;
    bool public queryOrderPresent;
    uint8 public queryResponseMode;
    uint256 public queryFillable;
    uint256 public queryQuantity;
    uint256 public queryPrice;
    address public lastDepositSender;
    string public lastDepositSubaccount;
    string public lastDepositDenom;
    uint256 public lastDepositAmount;
    address public lastWithdrawSender;
    string public lastWithdrawSubaccount;
    string public lastWithdrawDenom;
    uint256 public lastWithdrawAmount;
    address public withdrawToken;
    address public lastTransferSender;
    string public lastTransferSource;
    string public lastTransferDestination;
    string public lastTransferDenom;
    uint256 public lastTransferAmount;
    mapping(bytes32 => uint256) private mockAvailable;
    mapping(bytes32 => uint256) private mockTotal;

    function setShouldRevert(bool value) external { shouldRevert = value; }
    function setResponseMode(uint8 value) external { responseMode = value; }
    function setCancelShouldRevert(bool value) external { cancelShouldRevert = value; }
    function setCancelReturnsTrue(bool value) external { cancelReturnsTrue = value; }
    function setDepositShouldFail(bool value) external { depositShouldFail = value; }
    function setDepositToken(address value) external { depositToken = value; }
    function setWithdrawShouldFail(bool value) external { withdrawShouldFail = value; }
    function setWithdrawToken(address value) external { withdrawToken = value; }
    function setTransferShouldFail(bool value) external { transferShouldFail = value; }
    function setTransferNoop(bool value) external { transferNoop = value; }
    function setQueryShouldRevert(bool value) external { queryShouldRevert = value; }
    function setQueryResponseMode(uint8 value) external { queryResponseMode = value; }
    function setQueryResult(bool present, uint256 fillable) external {
        queryOrderPresent = present;
        queryFillable = fillable;
    }
    function setBalance(string calldata subaccount, string calldata denom, uint256 available, uint256 total) external {
        bytes32 key = keccak256(abi.encode(subaccount, denom));
        mockAvailable[key] = available;
        mockTotal[key] = total;
    }
    function setReentry(address target, bytes calldata callData) external {
        reentryTarget = target;
        reentryCallData = callData;
        reentryAttempted = false;
        reentrySucceeded = false;
        delete lastReentryReturnData;
    }
    function callGateAsExchange(address target, bytes calldata callData) external returns (bool success, bytes memory result) {
        return target.call(callData);
    }

    function createSpotLimitOrder(address sender, SpotOrder calldata order)
        external
        returns (CreateSpotLimitOrderResponse memory response)
    {
        require(sender == msg.sender, "DIRECT_ACTOR");
        require(!shouldRevert, "MOCK_PRECOMPILE_FAILURE");
        calls++;
        lastCaller = msg.sender;
        lastSender = sender;
        lastMarketID = order.marketID;
        lastSubaccountID = order.subaccountID;
        lastPrice = order.price;
        lastQuantity = order.quantity;
        lastCid = order.cid;
        lastOrderType = order.orderType;
        lastTriggerPrice = order.triggerPrice;
        queryOrderPresent = true;
        queryFillable = order.quantity;
        queryQuantity = order.quantity;
        queryPrice = order.price;
        if (reentryTarget != address(0) && !reentryAttempted) {
            reentryAttempted = true;
            (reentrySucceeded, lastReentryReturnData) = reentryTarget.call(reentryCallData);
        }
        if (responseMode == 1) return CreateSpotLimitOrderResponse("", order.cid);
        if (responseMode == 2) return CreateSpotLimitOrderResponse("0xmock-order-hash", "wrong-cid");
        return CreateSpotLimitOrderResponse("0xmock-order-hash", order.cid);
    }

    function cancelSpotOrder(address sender, string calldata marketID, string calldata subaccountID, string calldata orderHash, string calldata cid)
        external
        returns (bool success)
    {
        require(sender == msg.sender, "DIRECT_ACTOR");
        require(!cancelShouldRevert, "MOCK_CANCEL_FAILURE");
        cancellations++;
        lastCancelCaller = msg.sender;
        lastCancelSender = sender;
        lastCancelMarketID = marketID;
        lastCancelSubaccountID = subaccountID;
        lastCancelOrderHash = orderHash;
        lastCancelCid = cid;
        if (cancelReturnsTrue) queryOrderPresent = false;
        return cancelReturnsTrue;
    }

    function subaccountDeposit(string calldata subaccountID, string calldata denom)
        external view override returns (uint256 availableBalance, uint256 totalBalance)
    {
        bytes32 key = keccak256(abi.encode(subaccountID, denom));
        return (mockAvailable[key], mockTotal[key]);
    }

    function deposit(address sender, string calldata subaccountID, string calldata denom, uint256 amount)
        external override returns (bool success)
    {
        require(sender == msg.sender, "DIRECT_ACTOR");
        if (depositShouldFail) return false;
        require(depositToken != address(0), "MOCK_DEPOSIT_TOKEN_UNSET");
        GateToken(depositToken).burn(sender, amount);
        lastDepositSender = sender;
        lastDepositSubaccount = subaccountID;
        lastDepositDenom = denom;
        lastDepositAmount = amount;
        bytes32 key = keccak256(abi.encode(subaccountID, denom));
        mockAvailable[key] += amount;
        mockTotal[key] += amount;
        return true;
    }

    function withdraw(address sender, string calldata subaccountID, string calldata denom, uint256 amount)
        external override returns (bool success)
    {
        require(sender == msg.sender, "DIRECT_ACTOR");
        if (withdrawShouldFail) return false;
        bytes32 key = keccak256(abi.encode(subaccountID, denom));
        if (mockAvailable[key] < amount || mockTotal[key] < amount) return false;
        lastWithdrawSender = sender;
        lastWithdrawSubaccount = subaccountID;
        lastWithdrawDenom = denom;
        lastWithdrawAmount = amount;
        mockAvailable[key] -= amount;
        mockTotal[key] -= amount;
        require(withdrawToken != address(0), "MOCK_WITHDRAW_TOKEN_UNSET");
        GateToken(withdrawToken).mint(sender, amount);
        if (reentryTarget != address(0) && !reentryAttempted) {
            reentryAttempted = true;
            (reentrySucceeded, lastReentryReturnData) = reentryTarget.call(reentryCallData);
        }
        return true;
    }

    function externalTransfer(
        address sender,
        string calldata sourceSubaccountID,
        string calldata destinationSubaccountID,
        string calldata denom,
        uint256 amount
    ) external override returns (bool success) {
        require(sender == msg.sender, "DIRECT_ACTOR");
        if (transferShouldFail) return false;
        if (transferNoop) return true;
        bytes32 sourceKey = keccak256(abi.encode(sourceSubaccountID, denom));
        bytes32 destinationKey = keccak256(abi.encode(destinationSubaccountID, denom));
        if (mockAvailable[sourceKey] < amount) return false;
        lastTransferSender = sender;
        lastTransferSource = sourceSubaccountID;
        lastTransferDestination = destinationSubaccountID;
        lastTransferDenom = denom;
        lastTransferAmount = amount;
        mockAvailable[sourceKey] -= amount;
        mockTotal[sourceKey] -= amount;
        mockAvailable[destinationKey] += amount;
        mockTotal[destinationKey] += amount;
        if (reentryTarget != address(0) && !reentryAttempted) {
            reentryAttempted = true;
            (reentrySucceeded, lastReentryReturnData) = reentryTarget.call(reentryCallData);
        }
        return true;
    }

    function spotOrdersByHashes(SpotOrdersRequest calldata request)
        external view override returns (TrimmedSpotLimitOrder[] memory orders)
    {
        require(!queryShouldRevert, "MOCK_ORDER_QUERY_FAILURE");
        require(keccak256(bytes(request.marketID)) == keccak256(bytes(lastMarketID)), "QUERY_MARKET_MISMATCH");
        require(keccak256(bytes(request.subaccountID)) == keccak256(bytes(lastSubaccountID)), "QUERY_SUBACCOUNT_MISMATCH");
        require(request.orderHashes.length == 1 && keccak256(bytes(request.orderHashes[0])) == keccak256(bytes("0xmock-order-hash")), "QUERY_HASH_MISMATCH");
        if (!queryOrderPresent) return new TrimmedSpotLimitOrder[](0);
        orders = new TrimmedSpotLimitOrder[](1);
        string memory returnedHash = queryResponseMode == 1 ? "0xwrong-order-hash" : "0xmock-order-hash";
        string memory returnedCid = queryResponseMode == 2 ? "0xwrong-cid" : lastCid;
        uint256 returnedPrice = queryPrice + (queryResponseMode == 3 ? 1 : 0);
        uint256 returnedQuantity = queryQuantity + (queryResponseMode == 4 ? 1 : 0);
        uint256 returnedFillable = queryResponseMode == 6 ? queryQuantity + 1 : queryFillable;
        orders[0] = TrimmedSpotLimitOrder({
            price: returnedPrice,
            quantity: returnedQuantity,
            fillable: returnedFillable,
            isBuy: queryResponseMode != 5,
            orderHash: returnedHash,
            cid: returnedCid
        });
    }
}

/// Test-only verifier used solely to reach the external call while isolating
/// the Gate's reentrancy lock from proof-system behavior.
contract ReentrancyIsolationVerifier is IMandateProofVerifier {
    address public immutable override issuer;

    constructor(address issuer_) { issuer = issuer_; }

    function verify(bytes calldata, bytes32, bytes32, uint256, uint256, uint256, uint64)
        external pure override returns (bool)
    {
        return true;
    }
}

/// Uses an actual Groth16 proof for this exact EIP-712 spot-order digest,
/// the existing LocalMandateVerifier and a mock only at the Exchange Precompile.
/// The single-machine setup is untrusted and this test is not Testnet evidence.
contract SpotOrderGateTest {
    VmSpotOrder constant vm = VmSpotOrder(address(uint160(uint256(keccak256("hevm cheat code")))));
    string constant VECTOR_PATH = "test/fixtures/financial-authorization.json";
    address issuer;
    address constant GATE_ADDRESS = address(456);
    address constant EXCHANGE_ADDRESS = address(0x65);
    address principal;
    address agent;
    ActionGate gate;
    MockExchangeSpotOrder exchange;
    GateToken token;

    bytes32 constant CREDENTIAL_ID = bytes32(uint256(1));
    bytes32 constant MARKET_ID = 0xabababababababababababababababababababababababababababababababab;
    bytes32 constant SUBACCOUNT_ID = bytes32(uint256(uint160(GATE_ADDRESS)) << 96);
    bytes32 commitment;
    bytes32 configHash;
    bytes32 expectedDigest;
    ActionGate.SpotLimitOrderIntent baseIntent;
    ActionGate.OrderMandateConfig baseMandate;
    bytes proofBytes;

    struct ReentryFixture {
        ActionGate gate;
        ActionGate.SpotLimitOrderIntent outer;
        bytes outerSignature;
    }

    function setUp() external {
        vm.chainId(1439);
        vm.warp(1700000000);
        string memory vector = vm.readFile(VECTOR_PATH);
        issuer = vm.parseJsonAddress(vector, "$.issuer");
        baseIntent = abi.decode(vm.parseJsonBytes(vector, "$.solidity.intentAbi"), (ActionGate.SpotLimitOrderIntent));
        baseMandate = abi.decode(vm.parseJsonBytes(vector, "$.solidity.mandateConfigAbi"), (ActionGate.OrderMandateConfig));
        proofBytes = vm.parseJsonBytes(vector, "$.solidity.proofAbi");
        expectedDigest = vm.parseJsonBytes32(vector, "$.intentDigest");
        principal = baseIntent.principal;
        agent = baseIntent.agent;
        commitment = baseMandate.commitment;
        configHash = baseIntent.marketConfigHash;
        require(baseIntent.marketId == MARKET_ID && baseIntent.sender == GATE_ADDRESS, "VECTOR_CONTEXT_MISMATCH");

        GateToken tokenImplementation = new GateToken();
        vm.etch(address(789), address(tokenImplementation).code);
        token = GateToken(address(789));
        Groth16Verifier core = new Groth16Verifier();
        LocalMandateVerifier adapter = new LocalMandateVerifier(core, issuer);
        ActionGate implementation = new MockRiskEnabledActionGate(issuer, principal, address(token), adapter);
        vm.etch(GATE_ADDRESS, address(implementation).code);
        vm.store(GATE_ADDRESS, bytes32(0), bytes32(uint256(1)));
        gate = ActionGate(GATE_ADDRESS);

        MockExchangeSpotOrder mockImplementation = new MockExchangeSpotOrder();
        vm.etch(EXCHANGE_ADDRESS, address(mockImplementation).code);
        exchange = MockExchangeSpotOrder(EXCHANGE_ADDRESS);
        exchange.setDepositToken(address(token));
        exchange.setWithdrawToken(address(token));
        exchange.setCancelReturnsTrue(true);
        vm.prank(principal);
        gate.configureOrderBudget(MARKET_ID, keccak256("USDT"), 5000000000000000000);
        vm.prank(principal);
        gate.configureOrderDenoms("INJ", "USDT");
        issuerConfigure(true, 1);
    }

    function config(bool active, uint256 epoch) internal view returns (ActionGate.OrderMandateConfig memory) {
        ActionGate.OrderMandateConfig memory result = baseMandate;
        result.epoch = epoch;
        result.active = active;
        return result;
    }

    function issuerConfigure(bool active, uint256 epoch) internal {
        vm.prank(issuer);
        gate.setOrderMandate(CREDENTIAL_ID, config(active, epoch));
    }

    function intent() internal view returns (ActionGate.SpotLimitOrderIntent memory) {
        return baseIntent;
    }

    function hex32(bytes32 value) internal pure returns (string memory) {
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

    function signature(ActionGate.SpotLimitOrderIntent memory i, uint256 key) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, gate.spotOrderDigest(i));
        return abi.encodePacked(r, s, v);
    }

    function validSignature(ActionGate.SpotLimitOrderIntent memory i) internal returns (bytes memory) {
        return signature(i, 0xA11CE);
    }

    function reentrancyFixture() internal returns (ReentryFixture memory fixture) {
        ReentrancyIsolationVerifier permissiveVerifier = new ReentrancyIsolationVerifier(issuer);
        fixture.gate = new MockRiskEnabledActionGate(issuer, principal, address(789), permissiveVerifier);
        bytes32 subaccount = bytes32(uint256(uint160(address(fixture.gate))) << 96);
        vm.prank(principal);
        fixture.gate.configureOrderBudget(MARKET_ID, keccak256("USDT"), 5 ether);
        vm.prank(issuer);
        fixture.gate.setOrderMandate(CREDENTIAL_ID, ActionGate.OrderMandateConfig({
            commitment: commitment,
            agent: EXCHANGE_ADDRESS,
            epoch: 1,
            expiry: 2000000000,
            cap: 5 ether,
            marketId: MARKET_ID,
            subaccountId: subaccount,
            marketConfigHash: configHash,
            priceTick: 0.01 ether,
            quantityTick: 0.01 ether,
            maxFeeRate: 0.0005 ether,
            active: true
        }));
        fixture.outer = reentrancyIntent(fixture.gate, subaccount, 77);
        fixture.outerSignature = reentrancySignature(fixture.gate, fixture.outer);
    }

    function reentrancyIntent(ActionGate target, bytes32 subaccount, uint256 nonce)
        internal view returns (ActionGate.SpotLimitOrderIntent memory)
    {
        return ActionGate.SpotLimitOrderIntent({
            sender: address(target), issuer: issuer, principal: principal, agent: EXCHANGE_ADDRESS,
            credentialId: CREDENTIAL_ID, marketId: MARKET_ID, subaccountId: subaccount,
            marketConfigHash: configHash, disclosureRequestId: keccak256("test-business-request"), chainId: 1439, credentialEpoch: 1, policyEpoch: 1,
            price: 1 ether, quantity: 2 ether, priceTick: 0.01 ether, quantityTick: 0.01 ether,
            nonce: nonce, deadline: 1900000000, maxNotional: 3 ether, maxFeeRate: 0.0005 ether,
            maxTotalExposure: 3 ether, side: "BUY", orderType: "LIMIT"
        });
    }

    function reentrancySignature(ActionGate target, ActionGate.SpotLimitOrderIntent memory order)
        internal returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xA11CE, target.spotOrderDigest(order));
        return abi.encodePacked(r, s, v);
    }

    function proof() internal view returns (bytes memory) { return proofBytes; }

    function execute(ActionGate.SpotLimitOrderIntent memory i, bytes memory sig, bytes memory p) internal {
        vm.prank(agent);
        gate.executeSpotLimitOrder(i, sig, p);
    }

    function testPinnedSpotLimitOrderSelectorAndPrecompileAddress() external view {
        bytes4 expected = bytes4(keccak256(
            "createSpotLimitOrder(address,(string,string,string,uint256,uint256,string,string,uint256))"
        ));
        require(IExchangeSpotOrderPrecompile.createSpotLimitOrder.selector == expected, "PRECOMPILE_ABI_MISMATCH");
        require(IExchangeSpotOrderPrecompile.subaccountDeposit.selector == bytes4(keccak256("subaccountDeposit(string,string)")), "SUBACCOUNT_DEPOSIT_SELECTOR_MISMATCH");
        require(IExchangeSpotOrderPrecompile.deposit.selector == bytes4(keccak256("deposit(address,string,string,uint256)")), "DEPOSIT_SELECTOR_MISMATCH");
        require(IExchangeSpotOrderPrecompile.withdraw.selector == bytes4(keccak256("withdraw(address,string,string,uint256)")), "WITHDRAW_SELECTOR_MISMATCH");
        require(IExchangeSpotOrderPrecompile.externalTransfer.selector == bytes4(keccak256("externalTransfer(address,string,string,string,uint256)")), "EXTERNAL_TRANSFER_SELECTOR_MISMATCH");
        require(IExchangeSpotOrderPrecompile.spotOrdersByHashes.selector == bytes4(keccak256("spotOrdersByHashes((string,string,string[]))")), "SPOT_ORDERS_QUERY_SELECTOR_MISMATCH");
        require(gate.EXCHANGE_PRECOMPILE() == EXCHANGE_ADDRESS, "PRECOMPILE_ADDRESS_MISMATCH");
    }

    function testValidBoundOrderCallsMockAsGateActorWithoutProxyAuthz() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        require(gate.spotOrderDigest(i) == expectedDigest, "EIP712_CODEC_MISMATCH");
        execute(i, validSignature(i), proof());
        require(exchange.calls() == 1, "PRECOMPILE_NOT_CALLED");
        require(exchange.lastCaller() == GATE_ADDRESS && exchange.lastSender() == GATE_ADDRESS, "DIRECT_ACTOR_MISMATCH");
        require(exchange.lastPrice() == i.price && exchange.lastQuantity() == i.quantity, "ORDER_FIELDS_MISMATCH");
        require(keccak256(bytes(exchange.lastMarketID())) == keccak256(bytes(hex32(MARKET_ID))), "MARKET_ID_MISMATCH");
        require(keccak256(bytes(exchange.lastSubaccountID())) == keccak256(bytes(hex32(SUBACCOUNT_ID))), "SUBACCOUNT_ID_MISMATCH");
        require(keccak256(bytes(exchange.lastOrderType())) == keccak256(bytes("buy")), "SIDE_MISMATCH");
        require(exchange.lastTriggerPrice() == 0 && keccak256(bytes(exchange.lastCid())) == keccak256(bytes(hex32(expectedDigest))), "ORDER_CANONICALIZATION");
        require(gate.usedNonces(i.nonce), "NONCE_NOT_COMMITTED");
        uint256 spent = gate.orderMandateSpent(CREDENTIAL_ID);
        require(spent == 2001000000000000000, "EXPOSURE_NOT_COMMITTED");
        require(gate.orderTotalSpent() == spent, "GLOBAL_EXPOSURE_NOT_COMMITTED");
    }

    function testExchangeCallbackCannotReenterAsAuthorizedAgent() external {
        ReentryFixture memory fixture = reentrancyFixture();
        ActionGate.SpotLimitOrderIntent memory nested = reentrancyIntent(fixture.gate, fixture.outer.subaccountId, 78);
        bytes memory nestedCall = abi.encodeWithSelector(
            ActionGate.executeSpotLimitOrder.selector, nested,
            reentrancySignature(fixture.gate, nested), hex"01"
        );
        exchange.setReentry(address(fixture.gate), nestedCall);

        bytes memory outerCall = abi.encodeWithSelector(
            ActionGate.executeSpotLimitOrder.selector, fixture.outer, fixture.outerSignature, hex"01"
        );
        (bool outerSucceeded,) = exchange.callGateAsExchange(address(fixture.gate), outerCall);

        require(outerSucceeded, "OUTER_ORDER_FAILED");
        require(exchange.reentryAttempted() && !exchange.reentrySucceeded(), "REENTRANT_ORDER_SUCCEEDED");
        require(
            keccak256(exchange.lastReentryReturnData()) == keccak256(abi.encodeWithSignature("Error(string)", "REENTRANCY")),
            "REENTRANT_ORDER_WRONG_REJECTION"
        );
        require(exchange.calls() == 1, "REENTRANT_ORDER_REACHED_PRECOMPILE");
        require(fixture.gate.usedNonces(77) && !fixture.gate.usedNonces(78), "REENTRANT_NONCE_STATE");
        require(fixture.gate.orderTotalSpent() == 2001000000000000000, "REENTRANT_EXPOSURE_STATE");
    }

    function testUnissuedOrderAuthorityRejectedWithoutPrecompileCall() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.prank(issuer);
        gate.setOrderMandate(CREDENTIAL_ID, config(false, 2));
        vm.expectRevert(bytes("ORDER_AUTH"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "UNAUTHORIZED_PRECOMPILE_CALL");
    }

    function testChangedPriceWithFreshPrincipalSignatureFailsOrderBoundProof() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.price += i.priceTick;
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.expectRevert(bytes("PROOF"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "ALTERED_ORDER_REACHED_PRECOMPILE");
    }

    function testInvalidProofRejectedBeforePrecompile() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        vm.expectRevert(bytes("PROOF"));
        execute(i, sig, hex"01");
        require(exchange.calls() == 0, "INVALID_PROOF_REACHED_PRECOMPILE");
    }

    function testWrongChainRejectedBeforePrecompile() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.chainId(1);
        vm.expectRevert(bytes("CHAIN"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "WRONG_CHAIN_REACHED_PRECOMPILE");
    }

    function testWrongPrincipalAndWrongWalletSignatureRejected() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.principal = address(999);
        bytes memory wrongPrincipalSig = signature(i, 0xA11CE);
        bytes memory p = proof();
        vm.expectRevert(bytes("ACTOR"));
        execute(i, wrongPrincipalSig, p);
        require(exchange.calls() == 0, "WRONG_PRINCIPAL_REACHED_PRECOMPILE");

        i = intent();
        bytes memory wrongWalletSig = signature(i, 0xBAD);
        vm.expectRevert(bytes("SIGNATURE"));
        execute(i, wrongWalletSig, p);
        require(exchange.calls() == 0, "WRONG_WALLET_REACHED_PRECOMPILE");
    }

    function testWrongExecutionAgentRejected() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.expectRevert(bytes("ACTOR"));
        vm.prank(address(999));
        gate.executeSpotLimitOrder(i, sig, p);
        require(exchange.calls() == 0, "WRONG_AGENT_REACHED_PRECOMPILE");
    }

    function testMarketConfigSubaccountAndTickMismatchRejected() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.marketId = bytes32(uint256(99));
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.expectRevert(bytes("ORDER_BUDGET_MARKET"));
        execute(i, sig, p);

        i = intent();
        i.subaccountId = bytes32(uint256(100));
        sig = validSignature(i);
        vm.expectRevert(bytes("ORDER_CONFIG"));
        execute(i, sig, p);

        i = intent();
        i.priceTick = 1;
        sig = validSignature(i);
        vm.expectRevert(bytes("ORDER_TICK"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "MISMATCH_REACHED_PRECOMPILE");
    }

    function testQuantityAndMarketConfigurationAreBound() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.quantity += i.quantityTick;
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.expectRevert(bytes("PROOF"));
        execute(i, sig, p);

        i = intent();
        i.marketConfigHash = bytes32(uint256(88));
        sig = validSignature(i);
        vm.expectRevert(bytes("ORDER_CONFIG"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "SUBSTITUTED_ORDER_REACHED_PRECOMPILE");
    }

    function testIssuerFeeCeilingCannotBeRaisedByAgent() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.maxFeeRate = 600000000000000;
        bytes memory sig = validSignature(i);
        vm.expectRevert(bytes("ORDER_FEE_POLICY"));
        execute(i, sig, proof());
        require(exchange.calls() == 0, "RAISED_FEE_LIMIT_REACHED_PRECOMPILE");
    }

    function testUnderstatedFeeCeilingIsRejectedBeforeProofOrStateMutation() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.maxFeeRate = 0;
        bytes memory sig = validSignature(i);
        vm.expectRevert(bytes("ORDER_FEE_POLICY"));
        execute(i, sig, hex"");
        require(exchange.calls() == 0, "UNDERRESERVED_ORDER_REACHED_PRECOMPILE");
        require(!gate.usedNonces(i.nonce), "UNDERRESERVED_ORDER_CONSUMED_NONCE");
        require(gate.orderMandateSpent(CREDENTIAL_ID) == 0, "UNDERRESERVED_ORDER_CONSUMED_EXPOSURE");
    }

    function testExpiredOrderAndRevokedCredentialRejected() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.warp(1900000001);
        vm.expectRevert(bytes("EXPIRED"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "EXPIRED_REACHED_PRECOMPILE");

        vm.warp(1700000000);
        issuerConfigure(false, 2);
        vm.expectRevert(bytes("ORDER_AUTH"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "REVOKED_REACHED_PRECOMPILE");
    }

    function testReplayRejectedAfterSinglePrecompileCall() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        execute(i, sig, p);
        vm.expectRevert(bytes("REPLAY"));
        execute(i, sig, p);
        require(exchange.calls() == 1, "REPLAY_REACHED_PRECOMPILE");
    }

    function testPrecompileFailureRollsBackNonceAndExposure() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        exchange.setShouldRevert(true);
        vm.expectRevert(bytes("PRECOMPILE"));
        execute(i, sig, proof());
        require(!gate.usedNonces(i.nonce), "FAILED_CALL_CONSUMED_NONCE");
        uint256 spent = gate.orderMandateSpent(CREDENTIAL_ID);
        require(spent == 0, "FAILED_CALL_CONSUMED_EXPOSURE");
        require(gate.orderTotalSpent() == 0, "FAILED_CALL_CONSUMED_GLOBAL_BUDGET");

        exchange.setShouldRevert(false);
        execute(i, sig, proof());
        require(exchange.calls() == 1, "RETRY_DID_NOT_REACH_PRECOMPILE");
        require(gate.orderTotalSpent() == 2001000000000000000, "RETRY_GLOBAL_BUDGET_MISMATCH");
    }

    function testMalformedPrecompileResponsesRollbackAndAllowRetry() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes memory sig = validSignature(i);
        bytes memory p = proof();

        exchange.setResponseMode(1);
        vm.expectRevert(bytes("PRECOMPILE_RESPONSE"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "EMPTY_HASH_MOCK_STATE_NOT_ROLLED_BACK");
        require(!gate.usedNonces(i.nonce), "EMPTY_HASH_CONSUMED_NONCE");
        require(gate.orderMandateSpent(CREDENTIAL_ID) == 0, "EMPTY_HASH_CONSUMED_EXPOSURE");

        exchange.setResponseMode(2);
        vm.expectRevert(bytes("PRECOMPILE_RESPONSE"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "WRONG_CID_MOCK_STATE_NOT_ROLLED_BACK");
        require(!gate.usedNonces(i.nonce), "WRONG_CID_CONSUMED_NONCE");
        require(gate.orderMandateSpent(CREDENTIAL_ID) == 0, "WRONG_CID_CONSUMED_EXPOSURE");

        exchange.setResponseMode(0);
        execute(i, sig, p);
        require(exchange.calls() == 1, "RETRY_DID_NOT_REACH_PRECOMPILE");
        require(gate.usedNonces(i.nonce), "RETRY_DID_NOT_CONSUME_NONCE");
        require(gate.orderMandateSpent(CREDENTIAL_ID) == 2001000000000000000, "RETRY_EXPOSURE_MISMATCH");
    }

    function testAgentCannotCallPrecompileAsGateActorDirectly() external {
        IExchangeSpotOrderPrecompile.SpotOrder memory order = IExchangeSpotOrderPrecompile.SpotOrder({
            marketID: "0xabababababababababababababababababababababababababababababababab",
            subaccountID: "0x0000000000000000000000000000000000000456000000000000000000000000",
            feeRecipient: "",
            price: 1e18,
            quantity: 2e18,
            cid: "bypass",
            orderType: "buy",
            triggerPrice: 0
        });
        vm.expectRevert(bytes("DIRECT_ACTOR"));
        vm.prank(agent);
        exchange.createSpotLimitOrder(GATE_ADDRESS, order);
        require(exchange.calls() == 0, "DIRECT_BYPASS_SUCCEEDED");
    }

    function testSellAndOtherOrderTypesFailClosed() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.orderType = "POST_ONLY";
        bytes memory sig = validSignature(i);
        bytes memory p = proof();
        vm.expectRevert(bytes("ORDER_TYPE"));
        execute(i, sig, p);

        i = intent();
        i.side = "SELL";
        sig = validSignature(i);
        vm.expectRevert(bytes("ORDER_TYPE"));
        execute(i, sig, p);
        require(exchange.calls() == 0, "UNSUPPORTED_ORDER_REACHED_PRECOMPILE");
    }

    function testCredentialIdsCannotBypassTheGateWideOrderBudget() external {
        ActionGate.SpotLimitOrderIntent memory first = intent();
        execute(first, validSignature(first), proof());

        bytes32 secondCredential = bytes32(uint256(2));
        ActionGate.OrderMandateConfig memory other = config(true, 1);
        other.commitment = bytes32(uint256(999));
        vm.prank(issuer);
        gate.setOrderMandate(secondCredential, other);

        ActionGate.SpotLimitOrderIntent memory second = intent();
        second.credentialId = secondCredential;
        second.nonce = 78;
        second.quantity = 3e18;
        second.maxNotional = 4e18;
        second.maxTotalExposure = 4e18;
        bytes memory secondSignature = validSignature(second);
        vm.expectRevert(bytes("ORDER_CAP"));
        execute(second, secondSignature, hex"");
        require(exchange.calls() == 1, "AGGREGATE_BUDGET_BYPASS");
        require(gate.orderTotalSpent() == 2001000000000000000, "GLOBAL_BUDGET_CHANGED_ON_REJECT");
    }

    function testOrderOnlyGateRejectsLegacyErc20TransferAndBudgetMutation() external {
        ActionGate.TransferIntent memory transferIntent;
        vm.expectRevert(bytes("ORDER_ONLY"));
        vm.prank(agent);
        gate.execute(transferIntent, hex"", hex"");

        vm.expectRevert(bytes("PRINCIPAL"));
        vm.prank(agent);
        gate.increaseOrderBudgetCap(6e18);

        vm.expectRevert(bytes("ORDER_BUDGET"));
        vm.prank(principal);
        gate.configureOrderBudget(MARKET_ID, keccak256("OTHER"), 6e18);

        vm.prank(principal);
        gate.increaseOrderBudgetCap(6e18);
        require(gate.orderBudgetCap() == 6e18, "PRINCIPAL_CAP_INCREASE_FAILED");
        require(gate.orderBudgetMarketId() == MARKET_ID && gate.orderBudgetQuoteDenomHash() == keccak256("USDT"), "BUDGET_UNIT_CHANGED");
    }

    function testDeadlineAndCredentialExpiryMustBeStrictlyInTheFuture() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        vm.warp(i.deadline);
        bytes memory deadlineSignature = validSignature(i);
        vm.expectRevert(bytes("EXPIRED"));
        execute(i, deadlineSignature, hex"");

        vm.warp(1900000000);
        ActionGate.OrderMandateConfig memory expired = config(true, 2);
        expired.expiry = 1900000000;
        vm.prank(issuer);
        gate.setOrderMandate(CREDENTIAL_ID, expired);
        i.credentialEpoch = 2;
        i.deadline = expired.expiry;
        bytes memory expirySignature = validSignature(i);
        vm.expectRevert(bytes("EXPIRED"));
        execute(i, expirySignature, hex"");
    }

    function testIssuerCanCancelPreviouslyTrackedOrderAfterMandateRevocation() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        ActionGate.TrackedOrder memory tracked = gate.getTrackedOrder(digest);
        require(tracked.exists && !tracked.terminalAcknowledged && tracked.nonce == i.nonce, "ORDER_TRACKING_MISSING");

        issuerConfigure(false, 2);
        vm.prank(issuer);
        bool acknowledged = gate.cancelTrackedOrder(digest);
        require(acknowledged && exchange.cancellations() == 1, "REVOKED_ORDER_NOT_CANCELLED");
        require(exchange.lastCancelCaller() == GATE_ADDRESS && exchange.lastCancelSender() == GATE_ADDRESS, "CANCEL_ACTOR_MISMATCH");
        require(keccak256(bytes(exchange.lastCancelMarketID())) == keccak256(bytes(hex32(MARKET_ID))), "CANCEL_MARKET_MISMATCH");
        require(keccak256(bytes(exchange.lastCancelSubaccountID())) == keccak256(bytes(hex32(SUBACCOUNT_ID))), "CANCEL_SUBACCOUNT_MISMATCH");
        require(keccak256(bytes(exchange.lastCancelOrderHash())) == keccak256(bytes("0xmock-order-hash")), "CANCEL_HASH_MISMATCH");
        require(keccak256(bytes(exchange.lastCancelCid())) == keccak256(bytes(hex32(digest))), "CANCEL_CID_MISMATCH");
        tracked = gate.getTrackedOrder(digest);
        require(tracked.terminalAcknowledged, "CANCEL_ACK_NOT_RECORDED");
        require(gate.orderTotalSpent() == tracked.exposure, "CANCEL_REFUNDED_CUMULATIVE_BUDGET");
    }

    function testAgentCannotCancelAndUnknownOrderCannotTargetArbitraryHash() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        vm.expectRevert(bytes("CANCEL_AUTHORITY"));
        vm.prank(agent);
        gate.cancelTrackedOrder(digest);
        vm.expectRevert(bytes("UNKNOWN_OR_TERMINAL_ORDER"));
        vm.prank(principal);
        gate.cancelTrackedOrder(bytes32(uint256(99)));
        require(exchange.cancellations() == 0, "UNAUTHORIZED_CANCEL_REACHED_PRECOMPILE");
    }

    function testCancelFailureStaysUnknownAndCanBeRetriedWithoutReleasingBudget() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        uint256 spent = gate.orderTotalSpent();
        exchange.setCancelShouldRevert(true);
        vm.prank(principal);
        require(!gate.cancelTrackedOrder(digest), "FAILED_CANCEL_REPORTED_ACKNOWLEDGED");
        require(!gate.getTrackedOrder(digest).terminalAcknowledged, "FAILED_CANCEL_MARKED_COMPLETE");
        require(gate.orderTotalSpent() == spent, "FAILED_CANCEL_CHANGED_BUDGET");

        exchange.setCancelShouldRevert(false);
        exchange.setCancelReturnsTrue(false);
        vm.prank(principal);
        require(!gate.cancelTrackedOrder(digest), "FALSE_NATIVE_RESULT_ACCEPTED");
        require(!gate.getTrackedOrder(digest).terminalAcknowledged, "FALSE_NATIVE_RESULT_MARKED_COMPLETE");
        exchange.setCancelReturnsTrue(true);
        vm.prank(principal);
        require(gate.cancelTrackedOrder(digest), "CANCEL_RETRY_FAILED");
        require(gate.orderTotalSpent() == spent, "CANCEL_RETRY_RELEASED_BUDGET");
    }

    function testPauseBlocksNewOrdersButLeavesCancellationAvailable() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        vm.prank(issuer);
        gate.pauseOrders();
        i.nonce++;
        bytes memory orderSig = validSignature(i);
        vm.expectRevert(bytes("ORDERS_PAUSED"));
        execute(i, orderSig, proof());
        vm.prank(principal);
        require(gate.cancelTrackedOrder(digest), "PAUSE_BLOCKED_CANCEL");
        vm.expectRevert(bytes("PRINCIPAL"));
        vm.prank(issuer);
        gate.resumeOrders();
        vm.prank(principal);
        gate.resumeOrders();
        require(exchange.calls() == 1 && exchange.cancellations() == 1, "PAUSE_ORDER_LIFECYCLE");
    }
    function testPrincipalOnlyExchangeDepositUsesPinnedGateSubaccountAndDenoms() external {
        vm.expectRevert(bytes("DEPOSIT_AUTHORITY"));
        vm.prank(agent);
        gate.depositOrderAsset(true, 100);
        vm.expectRevert(bytes("DEPOSIT_QUOTE_ONLY"));
        vm.prank(principal);
        gate.depositOrderAsset(false, 100);
        vm.expectRevert(bytes("BANK_AVAILABLE_BALANCE"));
        vm.prank(principal);
        gate.depositOrderAsset(true, 100);

        token.mint(GATE_ADDRESS, 1000);
        vm.prank(principal);
        require(gate.depositOrderAsset(true, 100), "EXCHANGE_DEPOSIT_NOT_ACKNOWLEDGED");
        require(exchange.lastDepositSender() == GATE_ADDRESS, "DEPOSIT_ACTOR_MISMATCH");
        require(keccak256(bytes(exchange.lastDepositSubaccount())) == keccak256(bytes(hex32(SUBACCOUNT_ID))), "DEPOSIT_SUBACCOUNT_MISMATCH");
        require(keccak256(bytes(exchange.lastDepositDenom())) == keccak256(bytes("USDT")), "DEPOSIT_DENOM_MISMATCH");
        require(exchange.lastDepositAmount() == 100, "DEPOSIT_AMOUNT_MISMATCH");
        require(token.balanceOf(GATE_ADDRESS) == 900, "GATE_BANK_BALANCE_NOT_DEBITED");
        (uint256 available, uint256 total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 100 && total == 100, "EXCHANGE_DEPOSIT_NOT_CREDITED");

        exchange.setDepositShouldFail(true);
        vm.expectRevert(bytes("EXCHANGE_DEPOSIT_FAILED"));
        vm.prank(principal);
        gate.depositOrderAsset(true, 1);
        require(exchange.lastDepositAmount() == 100 && token.balanceOf(GATE_ADDRESS) == 900, "FAILED_DEPOSIT_CHANGED_MOCK_STATE");
        exchange.setDepositShouldFail(false);
        GateToken wrongAsset = new GateToken();
        wrongAsset.mint(GATE_ADDRESS, 10);
        exchange.setDepositToken(address(wrongAsset));
        vm.expectRevert(bytes("EXCHANGE_DEPOSIT_DEBIT_MISMATCH"));
        vm.prank(principal);
        gate.depositOrderAsset(true, 10);
        (available, total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 100 && total == 100 && token.balanceOf(GATE_ADDRESS) == 900 && wrongAsset.balanceOf(GATE_ADDRESS) == 10, "WRONG_ASSET_MAPPING_MUTATED_FUNDS");
    }

    function testDirectExchangeWithdrawReturnsOnlyQuoteFundsToGateThenOwnerRecoversErc20() external {
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 1000, 1000);
        vm.expectRevert(bytes("WITHDRAW_AUTHORITY"));
        vm.prank(agent);
        gate.withdrawQuoteExchangeAssetToGate(250);
        vm.expectRevert(bytes("WITHDRAW_STATE"));
        vm.prank(principal);
        gate.withdrawQuoteExchangeAssetToGate(250);

        vm.prank(principal);
        gate.pauseOrders();
        vm.prank(principal);
        require(gate.withdrawQuoteExchangeAssetToGate(250), "WITHDRAW_NOT_ACKNOWLEDGED");
        require(exchange.lastWithdrawSender() == GATE_ADDRESS, "WITHDRAW_ACTOR_MISMATCH");
        require(keccak256(bytes(exchange.lastWithdrawSubaccount())) == keccak256(bytes(hex32(SUBACCOUNT_ID))), "WITHDRAW_SUBACCOUNT_MISMATCH");
        require(keccak256(bytes(exchange.lastWithdrawDenom())) == keccak256(bytes("USDT")), "WITHDRAW_DENOM_MISMATCH");
        require(exchange.lastWithdrawAmount() == 250, "WITHDRAW_AMOUNT_MISMATCH");
        (uint256 available, uint256 total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 750 && total == 750, "EXCHANGE_BALANCE_NOT_DEBITED");
        require(token.balanceOf(GATE_ADDRESS) == 250 && token.balanceOf(principal) == 0, "WITHDRAW_DID_NOT_STOP_AT_GATE_BANK_ACCOUNT");

        vm.prank(principal);
        gate.recoverIdleAsset(250);
        require(token.balanceOf(GATE_ADDRESS) == 0 && token.balanceOf(principal) == 250, "GATE_ERC20_RECOVERY_NOT_SEPARATE");
        (available, total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 750 && total == 750, "ERC20_RECOVERY_CHANGED_EXCHANGE_BALANCE");
    }

    function testExchangeWithdrawFailsClosedOnOpenOrdersInsufficientFundsOrBadBankCredit() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 1000, 1000);
        vm.prank(principal);
        gate.pauseOrders();
        vm.expectRevert(bytes("WITHDRAW_STATE"));
        vm.prank(principal);
        gate.withdrawQuoteExchangeAssetToGate(100);
        exchange.setQueryResult(true, i.quantity);
        vm.prank(principal);
        gate.reconcileTrackedOrder(digest);
        vm.expectRevert(bytes("WITHDRAW_STATE"));
        vm.prank(principal);
        gate.withdrawQuoteExchangeAssetToGate(100);
        exchange.setQueryResult(false, 0);
        vm.prank(principal);
        require(gate.reconcileTrackedOrder(digest), "ORDER_NOT_RECONCILED");

        vm.expectRevert(bytes("EXCHANGE_AVAILABLE_BALANCE"));
        vm.prank(principal);
        gate.withdrawQuoteExchangeAssetToGate(1001);
        exchange.setWithdrawShouldFail(true);
        vm.expectRevert(bytes("EXCHANGE_WITHDRAW_FAILED"));
        vm.prank(principal);
        gate.withdrawQuoteExchangeAssetToGate(100);
        (uint256 available, uint256 total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 1000 && total == 1000 && token.balanceOf(GATE_ADDRESS) == 0, "FAILED_WITHDRAW_CHANGED_FUNDS");
        exchange.setWithdrawShouldFail(false);
        exchange.setWithdrawToken(address(new GateToken()));
        vm.expectRevert(bytes("EXCHANGE_WITHDRAW_CREDIT_MISMATCH"));
        vm.prank(principal);
        gate.withdrawQuoteExchangeAssetToGate(100);
        (available, total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 1000 && total == 1000 && token.balanceOf(GATE_ADDRESS) == 0, "BAD_ASSET_MAPPING_MUTATED_FUNDS");
    }

    function testExchangeWithdrawReentrancyAndZeroAmountAreRejected() external {
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 1000, 1000);
        vm.prank(principal);
        gate.pauseOrders();
        vm.expectRevert(bytes("WITHDRAW_STATE"));
        vm.prank(principal);
        gate.withdrawQuoteExchangeAssetToGate(0);
        exchange.setReentry(address(gate), abi.encodeCall(ActionGate.withdrawQuoteExchangeAssetToGate, (1)));
        vm.prank(principal);
        require(gate.withdrawQuoteExchangeAssetToGate(100), "WITHDRAW_REENTRY_OUTER_CALL_FAILED");
        require(exchange.reentryAttempted() && !exchange.reentrySucceeded(), "WITHDRAW_REENTRY_BYPASSED_LOCK");
        (uint256 available, uint256 total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 900 && total == 900 && token.balanceOf(GATE_ADDRESS) == 100, "REENTRANCY_CHANGED_WITHDRAW_AMOUNT");
    }

    function testWithdrawalHelperRejectsDirectCallsOutsideGateDelegateContext() external {
        ActionGateExchangeWithdrawal helper = new ActionGateExchangeWithdrawal();
        bytes32 helperSubaccount = bytes32(uint256(uint160(address(helper))) << 96);
        exchange.setBalance(hex32(helperSubaccount), "USDT", 1000, 1000);
        vm.expectRevert(bytes("DELEGATE_ONLY"));
        helper.withdrawQuote(address(token), hex32(helperSubaccount), "USDT", 100);
        vm.expectRevert(bytes("DELEGATE_ONLY"));
        helper.depositQuote(address(token), hex32(helperSubaccount), "USDT", 100);
        bytes32 principalSubaccount = bytes32(uint256(uint160(principal)) << 96);
        vm.expectRevert(bytes("DELEGATE_ONLY"));
        helper.transferToPrincipal(hex32(helperSubaccount), hex32(principalSubaccount), "USDT", 100);
        (uint256 available, uint256 total) = exchange.subaccountDeposit(hex32(helperSubaccount), "USDT");
        require(available == 1000 && total == 1000 && token.balanceOf(address(helper)) == 0, "DIRECT_HELPER_CALL_MOVED_FUNDS");
        (available, total) = exchange.subaccountDeposit(hex32(principalSubaccount), "USDT");
        require(available == 0 && total == 0, "DIRECT_HELPER_CALL_CREDITED_PRINCIPAL");
    }

    function testExchangeRecoveryFailsClosedUntilPausedAndAllOrdersAreTerminal() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        require(gate.activeTrackedOrderCount() == 1, "ACTIVE_ORDER_NOT_TRACKED");
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 1000, 1000);

        vm.expectRevert(bytes("RECOVERY_STATE"));
        vm.prank(principal);
        gate.recoverExchangeAsset(true, 100);

        vm.prank(principal);
        gate.pauseOrders();
        vm.expectRevert(bytes("RECOVERY_STATE"));
        vm.prank(principal);
        gate.recoverExchangeAsset(true, 100);

        exchange.setQueryResult(true, i.quantity);
        vm.prank(principal);
        require(!gate.reconcileTrackedOrder(digest), "OPEN_ORDER_RECONCILED_TERMINAL");
        require(gate.activeTrackedOrderCount() == 1, "OPEN_ORDER_REMOVED_FROM_LEDGER");
        vm.expectRevert(bytes("RECOVERY_STATE"));
        vm.prank(principal);
        gate.recoverExchangeAsset(true, 100);

        exchange.setQueryResult(true, 0);
        vm.prank(principal);
        require(gate.reconcileTrackedOrder(digest), "ZERO_FILLABLE_ORDER_NOT_TERMINAL");
        require(gate.activeTrackedOrderCount() == 0, "TERMINAL_ORDER_REMAINS_ACTIVE");
        require(gate.getTrackedOrder(digest).terminalAcknowledged, "TERMINAL_STATE_NOT_RECORDED");
        vm.prank(principal);
        require(gate.recoverExchangeAsset(true, 100), "EXCHANGE_RECOVERY_NOT_ACKNOWLEDGED");

        bytes32 principalDefault = bytes32(uint256(uint160(principal)) << 96);
        require(exchange.lastTransferSender() == GATE_ADDRESS, "RECOVERY_ACTOR_MISMATCH");
        require(keccak256(bytes(exchange.lastTransferSource())) == keccak256(bytes(hex32(SUBACCOUNT_ID))), "RECOVERY_SOURCE_MISMATCH");
        require(keccak256(bytes(exchange.lastTransferDestination())) == keccak256(bytes(hex32(principalDefault))), "RECOVERY_DESTINATION_MISMATCH");
        require(keccak256(bytes(exchange.lastTransferDenom())) == keccak256(bytes("USDT")), "RECOVERY_DENOM_MISMATCH");
        require(exchange.lastTransferAmount() == 100, "RECOVERY_AMOUNT_MISMATCH");
        (uint256 sourceAvailable, uint256 sourceTotal) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        (uint256 ownerAvailable, uint256 ownerTotal) = exchange.subaccountDeposit(hex32(principalDefault), "USDT");
        require(sourceAvailable == 900 && sourceTotal == 900, "SOURCE_BALANCE_NOT_DEBITED");
        require(ownerAvailable == 100 && ownerTotal == 100, "PRINCIPAL_BALANCE_NOT_CREDITED");
    }

    function testExchangeRecoveryRequiresAvailableBalanceAndReconciledQuery() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        vm.prank(principal);
        gate.pauseOrders();
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 9, 9);
        exchange.setQueryShouldRevert(true);
        vm.expectRevert(bytes("MOCK_ORDER_QUERY_FAILURE"));
        vm.prank(principal);
        gate.reconcileTrackedOrder(digest);
        require(gate.activeTrackedOrderCount() == 1, "QUERY_FAILURE_RELEASED_ORDER");

        exchange.setQueryShouldRevert(false);
        exchange.setQueryResult(false, 0);
        vm.prank(principal);
        require(gate.reconcileTrackedOrder(digest), "ABSENT_ORDER_NOT_TERMINAL");
        vm.expectRevert(bytes("EXCHANGE_AVAILABLE_BALANCE"));
        vm.prank(principal);
        gate.recoverExchangeAsset(true, 10);
        require(exchange.lastTransferAmount() == 0, "INSUFFICIENT_BALANCE_REACHED_TRANSFER");
    }

    function testMalformedExchangeOrderStateNeverReleasesTrackedOrder() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        vm.prank(principal);
        gate.pauseOrders();
        exchange.setQueryResult(true, i.quantity);
        for (uint8 mode = 1; mode <= 6; mode++) {
            exchange.setQueryResponseMode(mode);
            vm.expectRevert(bytes("ORDER_QUERY_MISMATCH"));
            vm.prank(principal);
            gate.reconcileTrackedOrder(digest);
            require(gate.activeTrackedOrderCount() == 1, "MALFORMED_QUERY_RELEASED_ORDER");
        }
        exchange.setQueryResponseMode(0);
        exchange.setQueryResult(false, 0);
        vm.prank(principal);
        require(gate.reconcileTrackedOrder(digest), "VALID_TERMINAL_QUERY_REJECTED");
        require(gate.activeTrackedOrderCount() == 0, "VALID_TERMINAL_QUERY_NOT_RECORDED");
    }

    function testFalseExchangeTransferDoesNotAcknowledgeRecovery() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        vm.prank(principal);
        gate.pauseOrders();
        exchange.setQueryResult(false, 0);
        vm.prank(principal);
        gate.reconcileTrackedOrder(digest);
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 100, 100);
        exchange.setTransferShouldFail(true);

        vm.expectRevert(bytes("EXCHANGE_RECOVERY_FAILED"));
        vm.prank(principal);
        gate.recoverExchangeAsset(true, 100);
        (uint256 available, uint256 total) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        require(available == 100 && total == 100, "FAILED_NATIVE_TRANSFER_CHANGED_BALANCE");
        require(exchange.lastTransferAmount() == 0, "FAILED_NATIVE_TRANSFER_ACKNOWLEDGED");

        exchange.setTransferShouldFail(false);
        vm.prank(principal);
        require(gate.recoverExchangeAsset(true, 100), "RECOVERY_RETRY_FAILED");
    }

    function testExchangeTransferTrueWithoutBalanceMovementFailsClosed() external {
        vm.prank(principal);
        gate.pauseOrders();
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 100, 100);
        exchange.setTransferNoop(true);
        vm.expectRevert(bytes("EXCHANGE_RECOVERY_BALANCE_MISMATCH"));
        vm.prank(principal);
        gate.recoverExchangeAsset(true, 100);
        (uint256 sourceAvailable, uint256 sourceTotal) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        bytes32 principalDefault = bytes32(uint256(uint160(principal)) << 96);
        (uint256 ownerAvailable, uint256 ownerTotal) = exchange.subaccountDeposit(hex32(principalDefault), "USDT");
        require(sourceAvailable == 100 && sourceTotal == 100 && ownerAvailable == 0 && ownerTotal == 0, "NOOP_RECOVERY_MUTATED_BALANCES");
    }

    function testExchangeRecoveryCallbackCannotReenterRecovery() external {
        vm.prank(principal);
        gate.pauseOrders();
        exchange.setBalance(hex32(SUBACCOUNT_ID), "USDT", 100, 100);
        exchange.setReentry(address(gate), abi.encodeCall(ActionGate.recoverExchangeAsset, (true, 1)));
        vm.prank(principal);
        require(gate.recoverExchangeAsset(true, 25), "RECOVERY_OUTER_CALL_FAILED");
        require(exchange.reentryAttempted() && !exchange.reentrySucceeded(), "RECOVERY_REENTRY_BYPASSED_LOCK");
        (uint256 sourceAvailable, uint256 sourceTotal) = exchange.subaccountDeposit(hex32(SUBACCOUNT_ID), "USDT");
        bytes32 principalDefault = bytes32(uint256(uint160(principal)) << 96);
        (uint256 ownerAvailable, uint256 ownerTotal) = exchange.subaccountDeposit(hex32(principalDefault), "USDT");
        require(sourceAvailable == 75 && sourceTotal == 75 && ownerAvailable == 25 && ownerTotal == 25, "RECOVERY_REENTRY_CHANGED_AMOUNT");
    }

    function testOnlyPrincipalCanReconcileOrReturnExchangeFunds() external {
        ActionGate.SpotLimitOrderIntent memory i = intent();
        bytes32 digest = gate.spotOrderDigest(i);
        execute(i, validSignature(i), proof());
        vm.expectRevert(bytes("RECONCILE_AUTHORITY"));
        vm.prank(agent);
        gate.reconcileTrackedOrder(digest);
        vm.expectRevert(bytes("RECOVERY_AUTHORITY"));
        vm.prank(agent);
        gate.recoverExchangeAsset(true, 1);
        require(gate.activeTrackedOrderCount() == 1 && exchange.lastTransferAmount() == 0, "AGENT_CHANGED_RECOVERY_STATE");
    }
    function testProductionGateFailsClosedWithoutVerifiedNativeMarketRisk() external {
        Groth16Verifier core = new Groth16Verifier();
        LocalMandateVerifier adapter = new LocalMandateVerifier(core, issuer);
        ActionGate productionGate = new ActionGate(issuer, principal, address(789), adapter, true);
        bytes32 subaccount = bytes32(uint256(uint160(address(productionGate))) << 96);
        vm.prank(principal);
        productionGate.configureOrderBudget(MARKET_ID, keccak256("USDT"), 5000000000000000000);
        vm.prank(principal);
        productionGate.configureOrderDenoms("INJ", "USDT");
        ActionGate.OrderMandateConfig memory c = config(true, 1);
        c.subaccountId = subaccount;
        vm.prank(issuer);
        productionGate.setOrderMandate(CREDENTIAL_ID, c);

        ActionGate.SpotLimitOrderIntent memory i = intent();
        i.sender = address(productionGate);
        i.subaccountId = subaccount;
        bytes32 digest = productionGate.spotOrderDigest(i);
        vm.expectRevert(bytes("MARKET_RISK_UNVERIFIED"));
        vm.prank(agent);
        productionGate.executeSpotLimitOrder(i, hex"", hex"");
        require(!productionGate.usedNonces(i.nonce), "UNKNOWN_MARKET_STATE_CONSUMED_NONCE");
        require(productionGate.orderMandateSpent(CREDENTIAL_ID) == 0, "UNKNOWN_MARKET_STATE_CONSUMED_MANDATE_CAP");
        require(productionGate.orderTotalSpent() == 0, "UNKNOWN_MARKET_STATE_CONSUMED_GATE_BUDGET");
        require(!productionGate.getTrackedOrder(digest).exists, "UNKNOWN_MARKET_STATE_TRACKED_ORDER");
        require(exchange.calls() == 0, "UNKNOWN_MARKET_STATE_REACHED_PRECOMPILE");
    }
}
