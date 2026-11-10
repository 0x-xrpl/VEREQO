// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ActionGate, IMandateProofVerifier} from "../src/ActionGate.sol";
interface VmGate { function addr(uint256) external returns(address); function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32); function prank(address) external; function expectRevert() external; function expectRevert(bytes calldata) external; function warp(uint256) external; function chainId(uint256) external; }
/// Deliberately NOT cryptography: tests enforcement around verifier boundary only.
contract MockMandateVerifier is IMandateProofVerifier {
    address public immutable override issuer = msg.sender;
    bool public valid = true;
    function setValid(bool v) external { valid = v; }
    function verify(bytes calldata,bytes32,bytes32,uint256,uint256,uint256,uint64) external view returns(bool) { return valid; }
}
contract GateToken {
    mapping(address=>uint256) public balanceOf;
    bool public fail;
    uint8 public recoveryMode;
    function setRecoveryMode(uint8 mode) external { recoveryMode=mode; }
    address public callback;
    bytes public callbackData;
    bool public bypassSucceeded;
    function mint(address a,uint256 n) external { balanceOf[a]+=n; }
    function burn(address a,uint256 n) external { require(balanceOf[a]>=n,"BALANCE");balanceOf[a]-=n; }
    function callGate(ActionGate g, ActionGate.TransferIntent calldata i, bytes calldata s) external { g.execute(i,s,hex"00"); }
    function configure(bool f,address c,bytes calldata d) external {fail=f;callback=c;callbackData=d;}
    function transfer(address to,uint256 n) external returns(bool) {
        require(!fail,"FAIL"); require(balanceOf[msg.sender]>=n,"BALANCE");
        if(callback!=address(0)) { (bypassSucceeded,) = callback.call(callbackData); }
        if (recoveryMode == 1) return true; // dishonest success, no movement
        if (recoveryMode != 3) balanceOf[msg.sender]-=n;
        if (recoveryMode != 2) balanceOf[to]+= recoveryMode == 4 ? n-1 : n;
        return true;
    }
}
contract ActionGateTest {
    VmGate constant vm = VmGate(address(uint160(uint256(keccak256("hevm cheat code")))));
    ActionGate gate; GateToken token; MockMandateVerifier verifier; address owner; address agent=address(22); bytes32 constant ID=bytes32(uint256(7));
    function setUp() external {
        owner=vm.addr(123); token=new GateToken();verifier=new MockMandateVerifier();
        gate=new ActionGate(address(this),owner,address(token),verifier,false);token.mint(address(gate),1000);
        gate.setMandate(ID,bytes32(uint256(9)),agent,1,10000,100,true);
    }
    function intent() internal view returns(ActionGate.TransferIntent memory) { return ActionGate.TransferIntent(address(token),address(33),agent,ID,1,1,60,1,9999); }
    function sig(ActionGate.TransferIntent memory i) internal returns(bytes memory) { (uint8 v,bytes32 r,bytes32 s)=vm.sign(123,gate.digest(i));return abi.encodePacked(r,s,v); }
    function run(ActionGate.TransferIntent memory i,bytes memory s) internal {vm.prank(agent);gate.execute(i,s,hex"00");}
    function testOwnerRecoveryAfterRevocationPreservesSpentAndNonce() external {
        ActionGate.TransferIntent memory i=intent();run(i,sig(i));
        gate.setMandate(ID,bytes32(uint256(9)),agent,2,10000,100,false);
        vm.warp(10001);uint256 remaining=token.balanceOf(address(gate));
        vm.prank(owner);gate.recoverIdleAsset(remaining);
        require(token.balanceOf(owner)==remaining && token.balanceOf(address(gate))==0);
        (,,,,,uint256 spent,)=gate.mandates(ID);require(spent==60 && gate.usedNonces(1));
    }
    function testRecoveryRejectsAgentAndIssuer() external {
        vm.expectRevert(bytes("RECOVERY_AUTHORITY"));vm.prank(agent);gate.recoverIdleAsset(1);
        vm.expectRevert(bytes("RECOVERY_AUTHORITY"));gate.recoverIdleAsset(1);
    }
    function testRecoveryFailureCanRetryWithoutLatchingLock() external {
        token.configure(true,address(0),hex"");
        vm.expectRevert(bytes("TOKEN_TRANSFER"));vm.prank(owner);gate.recoverIdleAsset(1);
        token.configure(false,address(0),hex"");vm.prank(owner);gate.recoverIdleAsset(1);
        require(token.balanceOf(owner)==1);
    }
    function testRecoveryRejectsNoopAndMismatchedBalanceDeltas() external {
        for (uint8 mode=1; mode<=4; mode++) {
            token.setRecoveryMode(mode);
            vm.expectRevert(bytes("RECOVERY_BALANCE_MISMATCH"));
            vm.prank(owner);gate.recoverIdleAsset(10);
            require(token.balanceOf(address(gate))==1000 && token.balanceOf(owner)==0,"FAILED_RECOVERY_MUTATED_BALANCES");
        }
        token.setRecoveryMode(0);
        vm.prank(owner);gate.recoverIdleAsset(10);
        require(token.balanceOf(address(gate))==990 && token.balanceOf(owner)==10,"RECOVERY_RETRY_FAILED");
    }
    function testRecoveryRejectsReentryEvenWhenTokenIsPrincipal() external {
        ActionGate recovery=new ActionGate(address(this),address(token),address(token),verifier,false);
        token.mint(address(recovery),10);
        token.configure(false,address(recovery),abi.encodeCall(ActionGate.recoverIdleAsset,(1)));
        vm.prank(address(token));recovery.recoverIdleAsset(2);
        require(!token.bypassSucceeded() && token.balanceOf(address(recovery))==8);
    }
    function testTransferAndReplay() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);run(i,s);require(token.balanceOf(address(33))==60);vm.expectRevert(bytes("REPLAY"));run(i,s);}
    function testAggregateCap() external {ActionGate.TransferIntent memory i=intent();run(i,sig(i));i.nonce=2;bytes memory s=sig(i);vm.expectRevert(bytes("CUMULATIVE_CAP"));run(i,s);}
    function testForgedSignatureAndAlteredAmount() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);i.amount=61;vm.expectRevert(bytes("SIGNATURE"));run(i,s);}
    function testAlteredRecipient() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);i.recipient=address(44);vm.expectRevert(bytes("SIGNATURE"));run(i,s);}
    function testWrongChainSignature() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);vm.chainId(block.chainid+1);vm.expectRevert(bytes("SIGNATURE"));run(i,s);}
    function testWrongContractSignature() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);ActionGate other=new ActionGate(address(this),owner,address(token),verifier,false);other.setMandate(ID,bytes32(uint256(9)),agent,1,10000,100,true);vm.expectRevert(bytes("SIGNATURE"));vm.prank(agent);other.execute(i,s,hex"00");}
    function testStaleEpochAndRevocation() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);gate.setMandate(ID,bytes32(uint256(9)),agent,2,10000,100,false);vm.expectRevert(bytes("AGENT"));run(i,s);}
    function testStalePolicy() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);vm.prank(owner);gate.advancePolicy();vm.expectRevert(bytes("EPOCH"));run(i,s);}
    function testExpired() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);vm.warp(10001);vm.expectRevert(bytes("EXPIRED"));run(i,s);}
    function testInvalidProof() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);verifier.setValid(false);vm.expectRevert(bytes("PROOF"));run(i,s);}
    function testDirectBypass() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);vm.expectRevert(bytes("AGENT"));gate.execute(i,s,hex"00");vm.expectRevert(bytes("ISSUER"));vm.prank(agent);gate.setMandate(ID,bytes32(uint256(8)),agent,2,10000,100,true);}
    function testLegacyTransferGateCannotExecuteSpotOrders() external {ActionGate.SpotLimitOrderIntent memory i;vm.expectRevert(bytes("TRANSFER_ONLY"));vm.prank(agent);gate.executeSpotLimitOrder(i,hex"",hex"");}
    function testTransferRevertRollsBack() external {ActionGate.TransferIntent memory i=intent();bytes memory s=sig(i);token.configure(true,address(0),hex"");vm.expectRevert(bytes("TOKEN_TRANSFER"));run(i,s);require(!gate.usedNonces(1));token.configure(false,address(0),hex"");run(i,s);}
    function testReentrancyFails() external {
        gate.setMandate(ID,bytes32(uint256(9)),address(token),2,10000,1000,true);
        ActionGate.TransferIntent memory outer=intent();outer.agent=address(token);outer.credentialEpoch=2;
        ActionGate.TransferIntent memory inner=intent();inner.agent=address(token);inner.credentialEpoch=2;inner.nonce=2;inner.amount=10;
        bytes memory innerSig=sig(inner);bytes memory outerSig=sig(outer);
        token.configure(false,address(gate),abi.encodeCall(ActionGate.execute,(inner,innerSig,hex"00")));
        token.callGate(gate,outer,outerSig);
        require(!token.bypassSucceeded() && !gate.usedNonces(2),"valid alternate intent callback blocked");
        require(token.balanceOf(address(33))==60,"outer transfer only");
    }
    function testRejectsMismatchedIssuerVerifierConfig() external {
        vm.expectRevert(bytes("VERIFIER_ISSUER"));
        new ActionGate(address(44),owner,address(token),verifier,false);
    }
    function testCredentialExpiryIndependentOfIntentDeadline() external {
        ActionGate.TransferIntent memory i=intent();i.deadline=20000;
        bytes memory s=sig(i);vm.warp(10001);
        vm.expectRevert(bytes("EXPIRED"));run(i,s);
    }
    function testCredentialCapsAreIndependentNotPortfolioLimit() external {
        ActionGate.TransferIntent memory i=intent();run(i,sig(i));
        bytes32 other=bytes32(uint256(8));gate.setMandate(other,bytes32(uint256(11)),agent,1,10000,100,true);
        i.credential=other;i.nonce=2;run(i,sig(i));
        require(token.balanceOf(address(33))==120,"two independently issuer-approved caps");
    }
    function testFalseTokenReturnRollsBackNonceAndExposure() external { invalidTokenReturn(0); }
    function testShortTokenReturnRollsBackNonceAndExposure() external { invalidTokenReturn(1); }
    function testNonBooleanTokenReturnRollsBackNonceAndExposure() external { invalidTokenReturn(2); }
    function testLongTokenReturnRollsBackNonceAndExposure() external { invalidTokenReturn(3); }
    function invalidTokenReturn(uint256 mode) internal {
        BadReturnToken bad=new BadReturnToken(mode);
        ActionGate target=new ActionGate(address(this),owner,address(bad),verifier,false);
        target.setMandate(ID,bytes32(uint256(9)),agent,1,10000,100,true);
        ActionGate.TransferIntent memory i=intent();i.asset=address(bad);
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(123,target.digest(i));
        vm.expectRevert(bytes("TOKEN_TRANSFER"));vm.prank(agent);target.execute(i,abi.encodePacked(r,s,v),hex"00");
        (,,,,,uint256 spent,)=target.mandates(ID);
        require(!target.usedNonces(i.nonce)&&spent==0,"failed transfer must roll back all effects");
    }
    function testEpochChangeDoesNotResetExposure() external {ActionGate.TransferIntent memory i=intent();run(i,sig(i));gate.setMandate(ID,bytes32(uint256(10)),agent,2,10000,100,true);i.credentialEpoch=2;i.nonce=2;bytes memory s=sig(i);vm.expectRevert(bytes("CUMULATIVE_CAP"));run(i,s);}
}

/// Adversarial ERC20 return data. No actual production token behavior is asserted.
contract BadReturnToken {
 uint256 immutable mode;
 constructor(uint256 m) { mode=m; }
 function transfer(address,uint256) external view returns(bool) {
  uint256 m=mode;
  assembly { switch m case 0 { mstore(0,0) return(0,32) } case 1 { return(0,1) } case 2 { mstore(0,2) return(0,32) } default { mstore(0,1) return(0,64) } }
 }
}
