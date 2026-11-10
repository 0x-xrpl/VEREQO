import { describe,it,expect } from 'vitest';
import { Interface } from 'ethers';
import { readFileSync } from 'node:fs';
import { canonicalBusinessRequestId,decimalToApi18,parseNativeOrderIntent,prepareNativeOrder,nativeOrderDigest,matchesNativeOrderCalldata,SPOT_ORDER_ABI } from '../packages/domain/src/native-order';
const addr='0x1111111111111111111111111111111111111111';
const crossLayerFixture=JSON.parse(readFileSync('contracts/test/fixtures/financial-authorization.json','utf8')) as {intent:unknown;intentDigest:string};
const fixture=()=>({chainId:'1439',verifyingContract:addr,sender:addr,issuer:addr,principal:addr,agent:addr,credentialId:'0x'+'a'.repeat(64),marketId:'0x'+'b'.repeat(64),subaccountId:addr+'0'.repeat(23)+'1',marketConfigHash:'0x'+'c'.repeat(64),disclosureRequestId:canonicalBusinessRequestId('unit-request'),credentialEpoch:'1',policyEpoch:'1',price:'2000000000000000000',quantity:'3000000000000000000',priceTick:'1000000000000000000',quantityTick:'1000000000000000000',nonce:'0',deadline:'2000000000',maxNotional:'6000000000000000000',maxFeeRate:'1000000000000000',maxTotalExposure:'6006000000000000000',side:'BUY',orderType:'LIMIT'});
describe('pinned native codec, never authorization',()=>{
 it('uses exact decimal strings without float rounding',()=>{expect(decimalToApi18('1.000000000000000001')).toBe('1000000000000000001');expect(decimalToApi18('0')).toBe('0');for(const s of ['1e2','01','-1','.1','1.0000000000000000001','Infinity'])expect(()=>decimalToApi18(s)).toThrow();});
 it('encodes source ABI and fixes excluded fields',()=>{const p=prepareNativeOrder(fixture());expect(p.authorized).toBe(false);expect(p.exposure).toEqual({notional:'6000000000000000000',fee:'6000000000000000',total:'6006000000000000000'});const d=new Interface([SPOT_ORDER_ABI]).decodeFunctionData('createSpotLimitOrder',p.calldata);expect(d[0].toLowerCase()).toBe(addr);expect(d[1].feeRecipient).toBe('');expect(d[1].cid).toBe('');expect(d[1].triggerPrice).toBe(0n);});
 for(const [side,type,native] of [['BUY','LIMIT','buy'],['SELL','LIMIT','sell'],['BUY','POST_ONLY','buyPostOnly'],['SELL','POST_ONLY','sellPostOnly']])it(`maps ${native}`,()=>expect(prepareNativeOrder({...fixture(),side,orderType:type}).order.orderType).toBe(native));
 it('matches the shared off-chain and Solidity Groth16 order digest vector',()=>{expect(nativeOrderDigest(crossLayerFixture.intent)).toBe(crossLayerFixture.intentDigest);});
 it('binds every accepted Intent field into the canonical digest',()=>{
  const f=fixture(),d=nativeOrderDigest(f),other='0x2222222222222222222222222222222222222222';
  const changes=[
   {verifyingContract:other,sender:other,subaccountId:other+'0'.repeat(23)+'1'},
   {issuer:other},{principal:other},{agent:other},
   {credentialId:'0x'+'d'.repeat(64)},{disclosureRequestId:'0x'+'e'.repeat(64)},{marketId:'0x'+'e'.repeat(64)},
   {subaccountId:addr+'0'.repeat(23)+'2'},{marketConfigHash:'0x'+'d'.repeat(64)},
   {credentialEpoch:'2'},{policyEpoch:'2'},{price:'1000000000000000000'},
   {quantity:'2000000000000000000'},{priceTick:'2000000000000000000'},
   {quantityTick:'3000000000000000000'},{nonce:'1'},{deadline:'2000000001'},
   {maxNotional:'7000000000000000000'},
   {maxFeeRate:'2000000000000000',maxTotalExposure:'7000000000000000000'},
   {maxTotalExposure:'7000000000000000000'},{side:'SELL'},{orderType:'POST_ONLY'}
  ];
  for(const change of changes)expect(nativeOrderDigest({...f,...change})).not.toBe(d);
  expect(()=>nativeOrderDigest({...f,chainId:'1'})).toThrow();
 });
 it('rejects altered calldata and appended bytes',()=>{const f=fixture(),p=prepareNativeOrder(f);expect(matchesNativeOrderCalldata(f,p.calldata)).toBe(true);expect(matchesNativeOrderCalldata(f,p.calldata+'00')).toBe(false);expect(matchesNativeOrderCalldata({...f,side:'SELL'},p.calldata)).toBe(false);});
 it('rejects extra fields, getters, numeric quantities, malformed/overflow/ticks/caps and foreign subaccounts',()=>{for(const change of [{quantity:3},{quantity:'03'},{price:'0'},{price:(1n<<256n).toString()},{price:'1'},{maxTotalExposure:'1'},{maxNotional:'1'},{chainId:'1'},{feeRecipient:addr},{cid:'override'},{sender:'0x2222222222222222222222222222222222222222'},{subaccountId:'0x'+'3'.repeat(64)},{quantity:(1n<<200n).toString(),quantityTick:'1'}])expect(()=>parseNativeOrderIntent({...fixture(),...change})).toThrow();const getter={...fixture()};Object.defineProperty(getter,'price',{get(){throw Error('executed getter');}});expect(()=>parseNativeOrderIntent(getter)).toThrow('INVALID_NATIVE_ORDER');});
 it('rounds exposure and fees conservatively up',()=>{const p=prepareNativeOrder({...fixture(),price:'1',quantity:'1',priceTick:'1',quantityTick:'1'});expect(p.exposure).toEqual({notional:'1',fee:'1',total:'2'});});
});
