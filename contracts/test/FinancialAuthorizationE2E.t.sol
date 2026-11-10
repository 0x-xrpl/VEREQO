// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ActionGate} from "../src/ActionGate.sol";
import {Groth16Verifier} from "../src/LocalGroth16Verifier.sol";
import {LocalMandateVerifier} from "../src/LocalMandateVerifier.sol";
import {GateToken} from "./ActionGate.t.sol";
import {MockExchangeSpotOrder} from "./SpotOrderGate.t.sol";
import {MockRiskEnabledActionGate} from "./MockRiskEnabledActionGate.sol";

interface VmFinancialAuthorization {
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

/// @notice Consumes the exact public proof/order vector used by the authenticated HTTP E2E.
/// The issuer registration is still performed as issuer, the principal signs the exact
/// EIP-712 digest, and only the exchange precompile boundary is mocked.
contract FinancialAuthorizationE2ETest {
    VmFinancialAuthorization constant vm = VmFinancialAuthorization(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant GATE_ADDRESS = address(456);
    address constant EXCHANGE_ADDRESS = address(0x65);
    address constant ASSET_ADDRESS = address(789);
    uint256 constant PRINCIPAL_KEY = 0xA11CE;
    string constant VECTOR_PATH = "test/fixtures/financial-authorization.json";

    ActionGate private gate;
    MockExchangeSpotOrder private exchange;
    ActionGate.SpotLimitOrderIntent private order;
    ActionGate.OrderMandateConfig private mandateConfig;
    bytes private proofBytes;
    bytes32 private expectedDigest;
    address private issuer;
    address private principal;
    address private agent;

    function setUp() external {
        vm.chainId(1439);
        vm.warp(1700000000);
        string memory vector = vm.readFile(VECTOR_PATH);
        issuer = vm.parseJsonAddress(vector, "$.issuer");
        principal = vm.parseJsonAddress(vector, "$.principal");
        agent = vm.parseJsonAddress(vector, "$.agent");
        require(principal == vm.addr(PRINCIPAL_KEY), "PRINCIPAL_VECTOR_MISMATCH");
        require(vm.parseJsonAddress(vector, "$.gate") == GATE_ADDRESS, "GATE_VECTOR_MISMATCH");
        order = abi.decode(vm.parseJsonBytes(vector, "$.solidity.intentAbi"), (ActionGate.SpotLimitOrderIntent));
        mandateConfig = abi.decode(vm.parseJsonBytes(vector, "$.solidity.mandateConfigAbi"), (ActionGate.OrderMandateConfig));
        proofBytes = vm.parseJsonBytes(vector, "$.solidity.proofAbi");
        expectedDigest = vm.parseJsonBytes32(vector, "$.intentDigest");

        GateToken tokenImplementation = new GateToken();
        vm.etch(ASSET_ADDRESS, address(tokenImplementation).code);
        Groth16Verifier core = new Groth16Verifier();
        LocalMandateVerifier adapter = new LocalMandateVerifier(core, issuer);
        ActionGate gateImplementation = new MockRiskEnabledActionGate(issuer, principal, ASSET_ADDRESS, adapter);
        vm.etch(GATE_ADDRESS, address(gateImplementation).code);
        vm.store(GATE_ADDRESS, bytes32(0), bytes32(uint256(1)));
        gate = ActionGate(GATE_ADDRESS);
        vm.prank(principal);
        gate.configureOrderBudget(order.marketId, keccak256("USDT"), 5000000000000000000);
        vm.prank(principal);
        gate.configureOrderDenoms("INJ", "USDT");

        MockExchangeSpotOrder exchangeImplementation = new MockExchangeSpotOrder();
        vm.etch(EXCHANGE_ADDRESS, address(exchangeImplementation).code);
        exchange = MockExchangeSpotOrder(EXCHANGE_ADDRESS);

        vm.prank(issuer);
        gate.setOrderMandate(order.credentialId, mandateConfig);
    }

    function principalSignature(ActionGate.SpotLimitOrderIntent memory value) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PRINCIPAL_KEY, gate.spotOrderDigest(value));
        return abi.encodePacked(r, s, v);
    }

    function submit(ActionGate.SpotLimitOrderIntent memory value, bytes memory signature, bytes memory proof) private {
        vm.prank(agent);
        gate.executeSpotLimitOrder(value, signature, proof);
    }

    function testSameWalletIntentMandateAndGroth16ProofReachLocalGate() external {
        ActionGate.OrderMandate memory registered = gate.getOrderMandate(order.credentialId);
        require(registered.commitment == mandateConfig.commitment, "GETTER_COMMITMENT_MISMATCH");
        require(registered.agent == mandateConfig.agent && registered.epoch == mandateConfig.epoch, "GETTER_AUTH_MISMATCH");
        require(registered.expiry == mandateConfig.expiry && registered.cap == mandateConfig.cap, "GETTER_LIMIT_MISMATCH");
        require(registered.marketId == mandateConfig.marketId && registered.subaccountId == mandateConfig.subaccountId, "GETTER_MARKET_MISMATCH");
        require(registered.marketConfigHash == mandateConfig.marketConfigHash && registered.active, "GETTER_STATE_MISMATCH");
        require(gate.spotOrderDigest(order) == expectedDigest, "HTTP_GATE_DIGEST_MISMATCH");
        submit(order, principalSignature(order), proofBytes);
        require(exchange.calls() == 1, "MOCK_PRECOMPILE_NOT_REACHED");
        require(exchange.lastCaller() == GATE_ADDRESS && exchange.lastSender() == GATE_ADDRESS, "GATE_ACTOR_MISMATCH");
        require(exchange.lastPrice() == order.price && exchange.lastQuantity() == order.quantity, "ORDER_MISMATCH");
        require(gate.usedNonces(order.nonce), "NONCE_NOT_COMMITTED");
        require(gate.orderMandateSpent(order.credentialId) == 2001000000000000000, "EXPOSURE_MISMATCH");
    }

    function testChangedOrderWithFreshWalletSignatureFailsProofBinding() external {
        ActionGate.SpotLimitOrderIntent memory changed = order;
        changed.price += changed.priceTick;
        bytes memory signature = principalSignature(changed);
        vm.expectRevert(bytes("PROOF"));
        submit(changed, signature, proofBytes);
        require(exchange.calls() == 0, "ALTERED_ORDER_REACHED_PRECOMPILE");
        require(!gate.usedNonces(order.nonce), "ALTERED_ORDER_CONSUMED_NONCE");
    }

    function testChangedBusinessRequestIdWithFreshSignatureFailsProofBinding() external {
        ActionGate.SpotLimitOrderIntent memory changed = order;
        changed.disclosureRequestId = keccak256("different-business-request");
        bytes memory signature = principalSignature(changed);
        vm.expectRevert(bytes("PROOF"));
        submit(changed, signature, proofBytes);
        require(exchange.calls() == 0, "SUBSTITUTED_REQUEST_REACHED_PRECOMPILE");
        require(!gate.usedNonces(order.nonce), "SUBSTITUTED_REQUEST_CONSUMED_NONCE");
    }

    function testIssuerRevocationFailsBeforePrecompile() external {
        ActionGate.OrderMandateConfig memory revoked = mandateConfig;
        revoked.active = false;
        revoked.epoch += 1;
        vm.prank(issuer);
        gate.setOrderMandate(order.credentialId, revoked);
        bytes memory signature = principalSignature(order);
        vm.expectRevert(bytes("ORDER_AUTH"));
        submit(order, signature, proofBytes);
        require(exchange.calls() == 0, "REVOKED_ORDER_REACHED_PRECOMPILE");
    }

    function testExpiredOrderFailsBeforePrecompile() external {
        bytes memory signature = principalSignature(order);
        vm.warp(1700000301);
        vm.expectRevert(bytes("EXPIRED"));
        submit(order, signature, proofBytes);
        require(exchange.calls() == 0, "EXPIRED_ORDER_REACHED_PRECOMPILE");
    }

    function testWrongExecutionActorFailsBeforePrecompile() external {
        bytes memory signature = principalSignature(order);
        vm.expectRevert(bytes("ACTOR"));
        vm.prank(address(999));
        gate.executeSpotLimitOrder(order, signature, proofBytes);
        require(exchange.calls() == 0, "WRONG_ACTOR_REACHED_PRECOMPILE");
    }

    function testReplayIsRejectedAfterOneCall() external {
        bytes memory signature = principalSignature(order);
        submit(order, signature, proofBytes);
        vm.expectRevert(bytes("REPLAY"));
        submit(order, signature, proofBytes);
        require(exchange.calls() == 1, "REPLAY_REACHED_PRECOMPILE");
    }

    function testPrecompileFailureRollsBackNonceAndMandateExposure() external {
        exchange.setShouldRevert(true);
        bytes memory signature = principalSignature(order);
        vm.expectRevert(bytes("PRECOMPILE"));
        submit(order, signature, proofBytes);
        require(!gate.usedNonces(order.nonce), "FAILED_PRECOMPILE_CONSUMED_NONCE");
        require(gate.orderMandateSpent(order.credentialId) == 0, "FAILED_PRECOMPILE_CONSUMED_EXPOSURE");
        require(exchange.calls() == 0, "FAILED_PRECOMPILE_RECORDED_CALL");
    }
}
