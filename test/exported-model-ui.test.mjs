import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {exportedModelUI} from '../src/exported-model-ui.js';
import {parseModel} from '../src/model-engine.js';
import {parseMLIRFile} from '../src/mlir-engine.js';
import {exportTflite} from '../src/tflite-export.js';
import {exportMLIR} from '../src/mlir-export.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {customFixture} from './custom-fixture.mjs';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP} from './mlir-fixture.mjs';

const tfMetadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url)));
const mlMetadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
// The production Worker uses FileReaderSync for range reads. For these small
// synthetic fixtures, materialize the bytes here, outside the UI controller.
const tf=async blob=>{const bytes=new Uint8Array(await blob.slice().arrayBuffer());return parseModel((offset,length)=>bytes.subarray(offset,offset+length),bytes.length,tfMetadata);};
const ml=blob=>parseMLIRFile(blob,{metadata:mlMetadata});

test('latest local export opens once; replacement, closing and failures leave no stale action',async()=>{
    const button={},opened=[],errors=[];
    const ui=exportedModelUI({button,open:async file=>{assert.ok(button.hidden&&button.disabled);opened.push(file);},error:reason=>errors.push(reason)});
    assert.ok(button.hidden&&button.disabled);
    ui.remember(new Blob(['old']),'old.mlir');
    ui.remember(new Blob(['new']),'new.mlir');
    assert.ok(!button.hidden&&!button.disabled);
    await button.onclick();await button.onclick();
    assert.equal(opened.length,1);assert.equal(opened[0].name,'new.mlir');assert.equal(await opened[0].text(),'new');
    ui.remember(new Blob(['closed']),'closed.tflite');ui.clear();await button.onclick();assert.equal(opened.length,1);
    const failed=exportedModelUI({button,open:async()=>{throw Error('parse failed');},error:reason=>errors.push(reason)});
    failed.remember(new Blob(['bad']),'bad.mlir');await button.onclick();await button.onclick();
    assert.equal(errors.length,1);assert.match(errors[0].message,/parse failed/);assert.ok(button.hidden&&button.disabled);
    for(const [blob,name] of [[new Blob([]),'empty.mlir'],[new Blob(['x']),'x.json'],[{},'x.tflite']])assert.throws(()=>failed.remember(blob,name),/沒有可開啟/);
});
test('declining to discard an edit draft keeps the latest local export available',async()=>{
 const button={};let allow=false,opens=0;const ui=exportedModelUI({button,open:async()=>{opens++;return allow;},error:reason=>{throw reason;}});ui.remember(new Blob(['local']),'local.mlir');await button.onclick();assert.ok(!button.disabled&&!button.hidden);allow=true;await button.onclick();assert.equal(opens,2);assert.ok(button.disabled&&button.hidden);
});

test('directly opened TFLite preserves custom options, weights and original tensor numbering without whole-Blob reads',async()=>{
    const {bytes,weight,options}=await customFixture({external:true}),source=new File([bytes],'custom.tflite');
    const before=await tf(source),result=exportTflite(before,0,[1],source),button={};
    result.blob.arrayBuffer=()=>{throw Error('whole export read forbidden');};result.blob.text=result.blob.arrayBuffer;
    let reopened;
    const ui=exportedModelUI({button,open:async file=>{assert.equal(file.name,'cut.tflite');file.arrayBuffer=()=>{throw Error('whole File read forbidden');};file.text=file.arrayBuffer;reopened=await tf(file);},error:reason=>{throw reason;}});
    ui.remember(result.blob,'cut.tflite');await button.onclick();
    const op=reopened.raw.subgraphs[0].operators[0];
    assert.equal(reopened.raw.subgraphs[0].operators.length,1);
    assert.deepEqual([...op.inputs],[4,5,-1]);assert.deepEqual([...op.outputs],[7,8]);
    const copied=reopened.raw.buffers[3];
    assert.deepEqual(new Uint8Array(await result.blob.slice(Number(copied.offset),Number(copied.offset+copied.size)).arrayBuffer()),weight);
    assert.deepEqual(new Uint8Array(await result.blob.slice(Number(op.large_custom_options_offset),Number(op.large_custom_options_offset+op.large_custom_options_size)).arrayBuffer()),options);
});

for(const [name,text,selections] of [
    ['branch',MLIR_CFG_DIAMOND,[{graph:0,nodes:[0]},{graph:1,nodes:[0]},{graph:2,nodes:[0]}]],
    ['loop',MLIR_CFG_LOOP,[{graph:1,nodes:[0]}]]
])test(`directly opened ${name} MLIR validates SSA/control flow and finds the original pattern exactly once`,async()=>{
    const source=new File([text],name+'.mlir'),before=await ml(source),pattern=captureMLIRPattern(before,selections);
    const result=await exportMLIR(before,selections[0].graph,selections[0].nodes,{scope:'slice',selections}),button={};
    result.blob.arrayBuffer=()=>{throw Error('whole export read forbidden');};result.blob.text=result.blob.arrayBuffer;
    let reopened;
    const ui=exportedModelUI({button,open:async file=>{reopened=await ml(file);},error:reason=>{throw reason;}});
    ui.remember(result.blob,name+'-cut.mlir');await button.onclick();
    assert.deepEqual(validateMLIR(reopened).diagnostics,[]);
    assert.equal((await findMLIRPatterns(reopened,pattern)).items.length,1);
    assert.ok(button.hidden&&button.disabled);
});
