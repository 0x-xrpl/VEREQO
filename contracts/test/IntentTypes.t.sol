// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IntentTypes} from "../src/IntentTypes.sol";

/// @notice Local digest tests only; does not test Injective or proof verification.
contract IntentTypesTest {
    function fixture() internal pure returns (IntentTypes.FinancialIntent memory) {
        return IntentTypes.FinancialIntent({
            issuer: 0x2222222222222222222222222222222222222222,
            subject: 0x3333333333333333333333333333333333333333,
            agent: 0x4444444444444444444444444444444444444444,
            credentialId: bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111)),
            credentialEpoch: 1,
            policyEpoch: 1,
            disclosureRequestId: bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222)),
            marketId: bytes32(uint256(0x3333333333333333333333333333333333333333333333333333333333333333)),
            subaccountId: bytes32(uint256(0x4444444444444444444444444444444444444444444444444444444444444444)),
            orderType: 0,
            side: 0,
            price: 1050000000000000000,
            quantity: 2000000000000000000,
            nonce: 7,
            deadline: 2000000000
        });
    }

    function testMatchesTypeScriptVector() external pure {
        require(
            IntentTypes.digest(1439, 0x1111111111111111111111111111111111111111, fixture()) ==
                0xa4888972dbc6be8cb387ebde56b65799614e7753b54628d1fc31e41ea7c19a48,
            "TypeScript EIP-712 vector"
        );
    }

    function testDomainAndStructAreBound() external pure {
        IntentTypes.FinancialIntent memory intent = fixture();
        address verifier = 0x1111111111111111111111111111111111111111;
        bytes32 original = IntentTypes.digest(1439, verifier, intent);
        require(original != IntentTypes.digest(1440, verifier, intent), "chain binding");
        require(original != IntentTypes.digest(1439, address(5), intent), "contract binding");
        intent.credentialEpoch = 2;
        require(original != IntentTypes.digest(1439, verifier, intent), "credential epoch binding");
        intent = fixture();
        intent.policyEpoch = 2;
        require(original != IntentTypes.digest(1439, verifier, intent), "policy epoch binding");
        intent = fixture();
        intent.quantity++;
        require(original != IntentTypes.digest(1439, verifier, intent), "quantity binding");
    }

    function testStructTupleEqualsFlatStaticEncoding() external pure {
        IntentTypes.FinancialIntent memory intent = fixture();
        bytes32 typeHash = keccak256("FinancialIntent(address issuer,address subject,address agent,bytes32 credentialId,uint256 credentialEpoch,uint256 policyEpoch,bytes32 disclosureRequestId,bytes32 marketId,bytes32 subaccountId,uint8 orderType,uint8 side,uint256 price,uint256 quantity,uint256 nonce,uint64 deadline)");
        bytes memory flatFirst = abi.encode(typeHash, intent.issuer, intent.subject, intent.agent, intent.credentialId, intent.credentialEpoch, intent.policyEpoch, intent.disclosureRequestId);
        bytes memory flatSecond = abi.encode(intent.marketId, intent.subaccountId, intent.orderType, intent.side, intent.price, intent.quantity, intent.nonce, intent.deadline);
        require(IntentTypes.hashStruct(intent) == keccak256(bytes.concat(flatFirst, flatSecond)), "flat static encoding");
    }
}
