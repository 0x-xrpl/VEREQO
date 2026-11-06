// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Schema/digest only. No proof verifier, signature gate, nonce store or executor exists here.
library IntentTypes {
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant INTENT_TYPEHASH = keccak256("FinancialIntent(address issuer,address subject,address agent,bytes32 credentialId,uint256 credentialEpoch,uint256 policyEpoch,bytes32 disclosureRequestId,bytes32 marketId,bytes32 subaccountId,uint8 orderType,uint8 side,uint256 price,uint256 quantity,uint256 nonce,uint64 deadline)");

    struct FinancialIntent {
        address issuer;
        address subject;
        address agent;
        bytes32 credentialId;
        uint256 credentialEpoch;
        uint256 policyEpoch;
        bytes32 disclosureRequestId;
        bytes32 marketId;
        bytes32 subaccountId;
        uint8 orderType;
        uint8 side;
        uint256 price;
        uint256 quantity;
        uint256 nonce;
        uint64 deadline;
    }

    function hashStruct(FinancialIntent memory intent) internal pure returns (bytes32) {
        // Every field is static, so the struct tuple has no ABI offset or dynamic content.
        return keccak256(abi.encode(INTENT_TYPEHASH, intent));
    }

    function digest(uint256 chainId, address verifyingContract, FinancialIntent memory intent) internal pure returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("VEREQO"), keccak256("1"), chainId, verifyingContract));
        return keccak256(abi.encodePacked(hex"1901", domain, hashStruct(intent)));
    }
}
