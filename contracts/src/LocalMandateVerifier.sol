// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {IMandateProofVerifier} from "./ActionGate.sol";
import {Groth16Verifier} from "./LocalGroth16Verifier.sol";

/// @notice LOCAL EXPERIMENT ONLY. Single-machine ceremony is not a trusted setup.
/// This adapter binds every public signal to the invoking gate's enforced context.
/// Issuer authenticates the commitment separately through the gate registry.
contract LocalMandateVerifier is IMandateProofVerifier {
    Groth16Verifier public immutable groth16;
    address public immutable override issuer;
    constructor(Groth16Verifier verifier_, address issuer_) {
        require(address(verifier_).code.length > 0 && issuer_ != address(0), "CONFIG");
        groth16 = verifier_; issuer = issuer_;
    }
    function verify(bytes calldata proof, bytes32 commitment, bytes32 contextDigest, uint256 exposure, uint256 credentialEpoch, uint256 currentPolicyEpoch, uint64 credentialExpiry) external view returns (bool) {
        if (proof.length != 256) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = abi.decode(proof,(uint256[2],uint256[2][2],uint256[2]));
        uint256[10] memory inputs = [
            uint256(commitment), exposure,
            uint256(contextDigest) >> 128, uint256(uint128(uint256(contextDigest))),
            uint256(uint160(issuer)), block.chainid, uint256(uint160(msg.sender)),
            credentialEpoch, currentPolicyEpoch, uint256(credentialExpiry)
        ];
        // Bound malformed-curve-point cost in this LOCAL verifier. Live-chain gas
        // compatibility must be measured independently before any deployment.
        try groth16.verifyProof{gas: 400000}(a,b,c,inputs) returns (bool valid) { return valid; }
        catch { return false; }
    }
}
