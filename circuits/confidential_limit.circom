pragma circom 2.1.6;
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// Local experimental predicate. The commitment must be issuer-authenticated
// independently; this circuit proves opening/bound/context only.
template ConfidentialLimit() {
    signal input maxNotional;
    signal input salt;
    signal input commitment;
    signal input requiredExposure;
    signal input intentHi;
    signal input intentLo;
    signal input issuer;
    signal input chainId;
    signal input gate;
    signal input credentialEpoch;
    signal input policyEpoch;
    signal input expiry;

    component maxBits = Num2Bits(128);
    maxBits.in <== maxNotional;
    component exposureBits = Num2Bits(128);
    exposureBits.in <== requiredExposure;
    component saltBits = Num2Bits(250);
    saltBits.in <== salt;
    component hiBits = Num2Bits(128);
    hiBits.in <== intentHi;
    component loBits = Num2Bits(128);
    loBits.in <== intentLo;
    component issuerBits = Num2Bits(160);
    issuerBits.in <== issuer;
    component chainBits = Num2Bits(64);
    chainBits.in <== chainId;
    component gateBits = Num2Bits(160);
    gateBits.in <== gate;
    component credBits = Num2Bits(64);
    credBits.in <== credentialEpoch;
    component policyBits = Num2Bits(64);
    policyBits.in <== policyEpoch;
    component expiryBits = Num2Bits(64);
    expiryBits.in <== expiry;

    component within = LessEqThan(128);
    within.in[0] <== requiredExposure;
    within.in[1] <== maxNotional;
    within.out === 1;

    component hash = Poseidon(10);
    hash.inputs[0] <== maxNotional;
    hash.inputs[1] <== salt;
    hash.inputs[2] <== issuer;
    hash.inputs[3] <== chainId;
    hash.inputs[4] <== gate;
    hash.inputs[5] <== credentialEpoch;
    hash.inputs[6] <== policyEpoch;
    hash.inputs[7] <== expiry;
    hash.inputs[8] <== intentHi;
    hash.inputs[9] <== intentLo;
    hash.out === commitment;


}
component main {public [commitment, requiredExposure, intentHi, intentLo, issuer, chainId, gate, credentialEpoch, policyEpoch, expiry]} = ConfidentialLimit();
