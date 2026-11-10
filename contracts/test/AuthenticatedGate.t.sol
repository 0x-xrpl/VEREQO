// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ActionGate} from "../src/ActionGate.sol";
import {Groth16Verifier} from "../src/LocalGroth16Verifier.sol";
import {LocalMandateVerifier} from "../src/LocalMandateVerifier.sol";
import {GateToken} from "./ActionGate.t.sol";
interface VmAuthenticatedGate {
 function addr(uint256) external returns(address);
 function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);
 function prank(address) external;
 function chainId(uint256) external;
 function warp(uint256) external;
 function etch(address,bytes calldata) external;
 function store(address,bytes32,bytes32) external;
 function expectRevert() external;
 function expectRevert(bytes calldata) external;
}
/// Actual issuer registration + principal signature + genuine Groth16 + local transfer.
/// Fixed-address local test harness and untrusted setup. Not an Injective transaction.
contract AuthenticatedGateTest {
 VmAuthenticatedGate constant vm=VmAuthenticatedGate(address(uint160(uint256(keccak256("hevm cheat code")))));
 ActionGate gate; GateToken token; address agent;
 bytes32 constant COMMITMENT=bytes32(uint256(6907565480619340901874625502157799812126965375053307107039225360920007431488));
 bytes32 constant EXPECTED_DIGEST=bytes32(uint256(0x95df0f75cd66422b6884a6456f8599cf51ddc01e590314cc87790ab498711d9a));
 function setUp() external {
  vm.chainId(1439);vm.warp(1700000000);agent=vm.addr(0xB0B);
  GateToken implementation=new GateToken();vm.etch(address(789),address(implementation).code);token=GateToken(address(789));
  Groth16Verifier core=new Groth16Verifier();LocalMandateVerifier adapter=new LocalMandateVerifier(core,address(123));
  ActionGate implementationGate=new ActionGate(address(123),vm.addr(0xA11CE),address(token),adapter,false);
  vm.etch(address(456),address(implementationGate).code);vm.store(address(456),bytes32(0),bytes32(uint256(1)));gate=ActionGate(address(456));
  token.mint(address(gate),1000000);
  vm.prank(address(123));gate.setMandate(bytes32(uint256(1)),COMMITMENT,agent,1,2000000000,10000,true);
 }
 function intent() internal view returns(ActionGate.TransferIntent memory) {
  return ActionGate.TransferIntent(address(token),address(0xBEEF),agent,bytes32(uint256(1)),1,1,1000,0,1900000000);
 }
 function signature(ActionGate.TransferIntent memory i) internal returns(bytes memory) {
  (uint8 v,bytes32 r,bytes32 s)=vm.sign(0xA11CE,gate.digest(i));return abi.encodePacked(r,s,v);
 }
 function proof() internal pure returns(bytes memory) {return abi.encode([uint256(16046331194815301568176926696491459373313677560458932574980992452204488164810),uint256(17491105007842137688241416446380017481997993939486200769468465078805722181890)],[[uint256(10667022664732187254131264995544863215807225476300934725654746302818940012204),uint256(14385256105323004166424335782157311538940629604597294966340182305787601409218)],[uint256(2425263881052573132724741838379626679209263205197012804882006130045935298296),uint256(15751231888707673584339405412193258710914344235793907554879758812866566705234)]],[uint256(2622016247149964986082348249682317284454352862293685546156088279022691583145),uint256(20465458812018898654139930623367836647628206651953423001023311664920256847077)]);}
 function execute(ActionGate.TransferIntent memory i,bytes memory sig,bytes memory p) internal {vm.prank(agent);gate.execute(i,sig,p);}
 function testIssuerSignedGenuineProofTransfer() external {
  ActionGate.TransferIntent memory i=intent();require(gate.digest(i)==EXPECTED_DIGEST,"independent JS digest vector");
  execute(i,signature(i),proof());require(token.balanceOf(address(0xBEEF))==1000 && gate.usedNonces(0),"real local execution");
 }
 function testGenuineProofReplayDenied() external {
  ActionGate.TransferIntent memory i=intent();bytes memory s=signature(i);execute(i,s,proof());vm.expectRevert(bytes("REPLAY"));execute(i,s,proof());
 }
 function testGenuineProofSubstitutedSignedIntentDenied() external {
  ActionGate.TransferIntent memory i=intent();i.amount=1001;bytes memory s=signature(i);vm.expectRevert(bytes("PROOF"));execute(i,s,proof());
 }
 function testGenuineProofForgedIssuerRegistrationDenied() external {
  vm.prank(agent);vm.expectRevert(bytes("ISSUER"));gate.setMandate(bytes32(uint256(1)),bytes32(uint256(COMMITMENT)+1),agent,2,2000000000,10000,true);
 }
 function testGenuineProofStaleCredentialDenied() external {
  vm.prank(address(123));gate.setMandate(bytes32(uint256(1)),COMMITMENT,agent,2,2000000000,10000,true);
  ActionGate.TransferIntent memory i=intent();i.credentialEpoch=2;bytes memory s=signature(i);vm.expectRevert(bytes("PROOF"));execute(i,s,proof());
 }
 function testGenuineProofExpiredCredentialDenied() external {
  ActionGate.TransferIntent memory i=intent();bytes memory s=signature(i);vm.warp(2000000001);vm.expectRevert(bytes("EXPIRED"));execute(i,s,proof());
 }
 function testGenuineProofCorruptedBytesDenied() external {
  ActionGate.TransferIntent memory i=intent();bytes memory s=signature(i);bytes memory p=proof();p[0]=bytes1(uint8(p[0])^1);vm.expectRevert(bytes("PROOF"));execute(i,s,p);
 }
}
