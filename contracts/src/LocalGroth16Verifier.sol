// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 3129897500067935782476415233287834595543668545492130623983785021489922308502;
    uint256 constant alphay  = 14789908286286717834628784713405242631539392780106946536130387275191717988746;
    uint256 constant betax1  = 18251186078532646935660719068658678373706444684096284321469450066877649753778;
    uint256 constant betax2  = 4383229251245062664122152777464264424593263554875964692523453193351746056364;
    uint256 constant betay1  = 13600794560389005343717342896672384554481039083885117100758158037744882111548;
    uint256 constant betay2  = 12813983547562102186237637681200857853549904808698045865623231193994453550754;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 7007909568163462709450179724633118381614990713610866962813852155482206173869;
    uint256 constant deltax2 = 12696166833960727521515890108233430400472079829180508097118567294215687379556;
    uint256 constant deltay1 = 8320392015706752074416228036526167478527840421500723684848153115751125484262;
    uint256 constant deltay2 = 9222401567806511064090120104555363566404527414996841410079131752099499478762;


    uint256 constant IC0x = 11646790236359069278117469088720938155224550116944039791402649379143619917734;
    uint256 constant IC0y = 14432875808217628997813965819603004802674009515897961329725974480163009583207;

    uint256 constant IC1x = 21040625163092787278007020155440888255773623370427703085520173773133988750624;
    uint256 constant IC1y = 7100500387737328564418517074873219852709369555345220060592311910734692019997;

    uint256 constant IC2x = 16248215735590114514832631995728787330218625959782339111821646548624560123467;
    uint256 constant IC2y = 989380998637306836952501200963412362833239507392528624980010913386126402310;

    uint256 constant IC3x = 3056961707535630404253390239500387946489355119752814010085150061111318029760;
    uint256 constant IC3y = 14602685357105362927646646071821624867209216522520355979731316989115920295629;

    uint256 constant IC4x = 5007353688153418454403546857768922577785572400913498156595257675058404246913;
    uint256 constant IC4y = 9837614280947094353071142620649439794451531510808703976217718358389861192974;

    uint256 constant IC5x = 10194840068038645067268200295473159957958950316506184134424874208516357651575;
    uint256 constant IC5y = 1864283187456670290978187131751219352734818516921804390786066772441602819015;

    uint256 constant IC6x = 4639296037993270173663829439259947116164692957881235919346619236472911810405;
    uint256 constant IC6y = 15866823210577612680265096671632832383409540660182615499468495607028878404898;

    uint256 constant IC7x = 727508575301392249421459513335231929095879893504408790823161125094433883338;
    uint256 constant IC7y = 19703276427942184928644379613965361621944087158146385481638008252896606121648;

    uint256 constant IC8x = 9128190901405612272329290980718492312584421950072762944703819008329780228606;
    uint256 constant IC8y = 15951812945995837836496418879542270009356553740582517878307234541137331459546;

    uint256 constant IC9x = 8455142071138804383401556130784550482810201106760736657666143521433899797458;
    uint256 constant IC9y = 19943739389751617267845975507160869623729766615648185084710398737112704231258;

    uint256 constant IC10x = 20975737360366590561203589956042436395082010124561811803088328608096638499352;
    uint256 constant IC10y = 8645913309237162659263169115008293357733676129865387242332794524091225670015;


    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[10] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x

                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))

                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))

                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))

                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))

                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))

                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))

                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))

                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))

                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))

                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))


                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F

            checkField(calldataload(add(_pubSignals, 0)))

            checkField(calldataload(add(_pubSignals, 32)))

            checkField(calldataload(add(_pubSignals, 64)))

            checkField(calldataload(add(_pubSignals, 96)))

            checkField(calldataload(add(_pubSignals, 128)))

            checkField(calldataload(add(_pubSignals, 160)))

            checkField(calldataload(add(_pubSignals, 192)))

            checkField(calldataload(add(_pubSignals, 224)))

            checkField(calldataload(add(_pubSignals, 256)))

            checkField(calldataload(add(_pubSignals, 288)))


            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
