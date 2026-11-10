// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ActionGate, IMandateProofVerifier} from "../src/ActionGate.sol";

/// @notice Test-only harness: bypasses only the unimplemented native-market risk hook.
/// It must never be deployed or used as Testnet evidence.
contract MockRiskEnabledActionGate is ActionGate {
    constructor(address issuer_, address principal_, address asset_, IMandateProofVerifier verifier_)
        ActionGate(issuer_, principal_, asset_, verifier_, true) {}

    function _marketRiskVerified(bytes32, bytes32) internal pure override returns (bool) {
        return true;
    }
}
