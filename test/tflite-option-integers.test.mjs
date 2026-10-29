import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tflite as schema} from '../vendor/netron/tflite-schema.js';
import {BinaryReader} from '../vendor/netron/flatbuffers.js';
import {FlatbufferWriter} from '../src/flatbuffer-writer.js';
import {builtinSettings} from '../src/tflite-new-ops.js';
const gather=schema.BuiltinOperator.STABLEHLO_GATHER;
test('OP int64 scalars and vectors reject unsafe numeric values before they become rounded BigInts',()=>{
 for(const value of [JSON.parse('9007199254740993'),JSON.parse('-9007199254740993'),1e18,NaN,Infinity,1.5]){
  assert.throws(()=>builtinSettings(gather,{index_vector_dim:value}),/安全.*(?:文字|字串)/);
  assert.throws(()=>builtinSettings(gather,{offset_dims:[value]}),/安全.*(?:文字|字串)/);
 }
});
test('safe JSON numbers remain compatible and decimal strings retain all signed int64 bits',()=>{
 const values=[Number.MIN_SAFE_INTEGER,0,Number.MAX_SAFE_INTEGER],options=builtinSettings(gather,{index_vector_dim:values[2],offset_dims:values}).options;assert.equal(options.index_vector_dim,BigInt(values[2]));assert.deepEqual(options.offset_dims,values.map(BigInt));
 const exact=builtinSettings(gather,{index_vector_dim:'9007199254740993',offset_dims:['-9223372036854775808','9223372036854775807']}).options;assert.equal(exact.index_vector_dim,9007199254740993n);assert.deepEqual(exact.offset_dims,[-9223372036854775808n,9223372036854775807n]);
});
test('int64 strings still reject out-of-range or nondecimal values',()=>{
 for(const value of ['9223372036854775808','-9223372036854775809','1e18','1.5','true']){assert.throws(()=>builtinSettings(gather,{index_vector_dim:value}));assert.throws(()=>builtinSettings(gather,{offset_dims:[value]}));}
});
test('accepted 64-bit parameter strings survive actual TFLite serialization and schema decoding exactly',async()=>{
 for(const [code,settings]of [[schema.BuiltinOperator.RANDOM_STANDARD_NORMAL,{seed:'9007199254740993',seed2:'-9223372036854775808'}],[gather,{index_vector_dim:'9007199254740993',offset_dims:['-9223372036854775808','9223372036854775807']}]]){
  const {info,options}=builtinSettings(code,settings),model={version:3,operator_codes:[{deprecated_builtin_code:Math.min(code,127),builtin_code:code,version:1}],subgraphs:[{tensors:[],inputs:new Int32Array(),outputs:new Int32Array(),operators:[{opcode_index:0,inputs:new Int32Array(),outputs:new Int32Array(),[info.group]:options}]}],buffers:[{data:new Uint8Array()}]};
  const bytes=new Uint8Array(await new FlatbufferWriter().finish(model,new Blob()).arrayBuffer()),raw=schema.Model.create(BinaryReader.open(bytes)),actual=raw.subgraphs[0].operators[0][info.group];
  for(const key of Object.keys(settings))assert.deepEqual(actual[key],options[key]);
 }
});
