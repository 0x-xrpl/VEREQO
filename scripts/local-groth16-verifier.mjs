import * as snarkjs from 'snarkjs';

/** Local cryptographic verification only; callers supply a separately pinned verification key. */
export function verifyLocalGroth16(verificationKey, publicSignals, proof) {
  return snarkjs.groth16.verify(verificationKey, [...publicSignals], proof);
}
