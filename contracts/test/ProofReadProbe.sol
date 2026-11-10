// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.30;
import {Groth16Verifier} from '../src/LocalGroth16Verifier.sol';
/// @notice eth_call creation simulation only. Never broadcast/deploy this probe.
contract ProofReadProbe {
 constructor(uint256[2] memory a,uint256[2][2] memory b,uint256[2] memory c,uint256[10] memory inputs){
  Groth16Verifier v=new Groth16Verifier();
  bool valid=v.verifyProof(a,b,c,inputs);
  assembly { mstore(0,valid) return(0,32) }
 }
}
