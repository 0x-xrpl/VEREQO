// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Groth16Verifier} from "../src/LocalGroth16Verifier.sol";
import {LocalMandateVerifier} from "../src/LocalMandateVerifier.sol";
interface VmProof { function prank(address) external; function chainId(uint256) external; }
/// Real local Groth16 proof, SINGLE_MACHINE_UNTRUSTED setup. No live credential.
/// Fixture digest is synthetic: this is adapter verification, not signed transfer execution.
contract LocalMandateVerifierTest {
 VmProof constant vm=VmProof(address(uint160(uint256(keccak256("hevm cheat code")))));
 Groth16Verifier core; LocalMandateVerifier adapter;
 function setUp() external {vm.chainId(1439);core=new Groth16Verifier();adapter=new LocalMandateVerifier(core,address(123));}
 function proof() internal pure returns(bytes memory) {return abi.encode([uint256(10341088646540343397742684551100038168245503481123508531968671099362135184017),uint256(10741579396336205554951264016767033982289435868652877410742106485938093702644)],[[uint256(20730972558102230476344950304255231704483849548377137471467191269065292166168),uint256(1798178973508258726991974702383896152853811335221558247942330274359290668415)],[uint256(20941155011269018302166198712446328729478053387782287160266909197656865175160),uint256(1525326537776286508360894304139352198011524695347276702591655449636552393421)]],[uint256(15760127938398570248600240582540720874914253647499694972851727020683487624184),uint256(9066662160397907574548675468647542793633317819130655321681038829503462385846)]);}
 function context() internal pure returns(bytes32) {return bytes32((uint256(1234)<<128)|5678);}
 function verify(bytes memory p,bytes32 commitment,bytes32 digest,uint256 amount,uint256 ce,uint256 pe,uint64 expiry) internal view returns(bool) {return adapter.verify(p,commitment,digest,amount,ce,pe,expiry);}
 function testGenuineLocalProof() external {vm.prank(address(456));require(verify(proof(),COMMITMENT,context(),1000,1,1,2000000000),"real proof");}
 function testChangedCommitment() external {vm.prank(address(456));require(!verify(proof(),bytes32(uint256(COMMITMENT)+1),context(),1000,1,1,2000000000));}
 function testChangedExposure() external {vm.prank(address(456));require(!verify(proof(),COMMITMENT,context(),1001,1,1,2000000000));}
 function testChangedDigestHigh() external {vm.prank(address(456));require(!verify(proof(),COMMITMENT,bytes32(uint256(context())+(1<<128)),1000,1,1,2000000000));}
 function testChangedDigestLow() external {vm.prank(address(456));require(!verify(proof(),COMMITMENT,bytes32(uint256(context())+1),1000,1,1,2000000000));}
 function testChangedIssuer() external {LocalMandateVerifier other=new LocalMandateVerifier(core,address(124));vm.prank(address(456));require(!other.verify(proof(),COMMITMENT,context(),1000,1,1,2000000000));}
 function testChangedChain() external {vm.chainId(1440);vm.prank(address(456));require(!verify(proof(),COMMITMENT,context(),1000,1,1,2000000000));}
 function testChangedGate() external {vm.prank(address(457));require(!verify(proof(),COMMITMENT,context(),1000,1,1,2000000000));}
 function testChangedCredentialEpoch() external {vm.prank(address(456));require(!verify(proof(),COMMITMENT,context(),1000,2,1,2000000000));}
 function testChangedPolicyEpoch() external {vm.prank(address(456));require(!verify(proof(),COMMITMENT,context(),1000,1,2,2000000000));}
 function testChangedExpiry() external {vm.prank(address(456));require(!verify(proof(),COMMITMENT,context(),1000,1,1,2000000001));}
 function testMalformedProof() external {vm.prank(address(456));require(!verify(hex"00",COMMITMENT,context(),1000,1,1,2000000000));}
 bytes32 constant COMMITMENT=bytes32(uint256(5301581751028066800788815636535919463851190679174065960736307378189413073196));
}
