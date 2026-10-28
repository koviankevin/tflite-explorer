// Native actions against synthetic public models. No browser-side state writes.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import {customFixture} from '../custom-fixture.mjs';
import {MLIR_CFG_DIAMOND,MLIR_CFG_LOOP} from '../mlir-fixture.mjs';
import {parseModel} from '../../src/model-engine.js';
import {parseMLIR} from '../../src/mlir-engine.js';
import {validateMLIR} from '../../src/mlir-validate.js';
import {captureMLIRPattern,findMLIRPatterns} from '../../src/mlir-pattern.js';
import {captureGraphPattern} from '../../src/subgraph-pattern.js';
import {reusablePattern,exportPatterns} from '../../src/pattern-library.js';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';
const tfMetadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url)));
const mlMetadata=await readFile(new URL('../../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
const tf=bytes=>parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,tfMetadata);
const ml=text=>parseMLIR(new TextEncoder().encode(text),{metadata:mlMetadata});

export async function modelEditFlow({page,read,base,directory,check,allowMlir=true}){
    const report={cases:[],modelWorkers:0,layouts:[],multiSelection:[],tfliteParserRequests:[],receipts:[]};let downloads=0,serial=0,tflitePhase=true,activeSourcePath,lastOutputPath;
    const parserRequest=request=>{if(tflitePhase&&/\/(?:mlir-engine|mlir)\.js(?:\?|$)/.test(request.url()))report.tfliteParserRequests.push(request.url());};page.context().on('request',parserRequest);
    const downloaded=()=>downloads++,intercept=()=>{};page.on('download',downloaded);page.on('filechooser',intercept);
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(fn,...args){const end=Date.now()+30000;while(!await read(fn,...args)){if(Date.now()>end)throw Error('Model edit DOM timeout: '+fn);await wait(100);}}
    async function ready(count){await until(()=>document.querySelector('#loading-card').hidden&&document.querySelector('#layer-count').textContent!=='—'&&document.querySelector('#target').getAttribute('aria-busy')==='false');if(count!==undefined)assert.equal(await read(()=>document.querySelector('#layer-count').textContent),String(count));}
    async function choose(filename){const event=page.waitForEvent('filechooser');await page.locator('#open-model').click();await(await event).setFiles(filename);report.modelWorkers++;activeSourcePath=filename;await ready();}
    async function closed(action){const worker=page.workers().find(w=>/\/model-worker\.js(?:\?|$)/.test(w.url()));assert.ok(worker);let timer;try{const ended=Promise.race([once(worker,'close'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Model-edit worker retained.')),5000);})]);await action();await ended;}finally{clearTimeout(timer);}}
    async function openResult(count){await closed(()=>page.locator('#open-edited-model').click());report.modelWorkers++;activeSourcePath=lastOutputPath;await ready(count);assert.equal(await read(()=>document.querySelector('#model-file').files.length),0);}
    async function locate(query){await page.locator('[data-kind="layers"]').click();await page.locator('#scope').selectOption('all');await page.locator('#query').fill(query);await until(q=>document.querySelector('#results').dataset.searchQuery===q&&document.querySelector('#results').getAttribute('aria-busy')==='false'&&document.querySelector('#result-count').textContent==='1 筆結果',query);await page.locator('.result-item').first().click();await ready();}
    async function editor(){await page.locator('#open-model-editor').click();await until(()=>document.querySelector('#model-edit-dialog').open&&!document.querySelector('#export-edited-model').disabled);}
    async function picker(button='#open-model-editor'){
        await page.locator(button).click();await until(()=>document.querySelector('#model-edit-dialog').open&&!document.querySelector('#model-edit-target-picker')?.hidden&&document.querySelectorAll('[data-model-edit-target]').length>1);
        assert.equal(await read(()=>document.querySelector('#export-edited-model').disabled),true);
        return read(()=>[...document.querySelectorAll('[data-model-edit-target]')].map(b=>({key:b.dataset.modelEditTarget,label:b.textContent})));
    }
    async function pickTarget(key){await page.locator(`[data-model-edit-target="${key}"]`).click();await until(()=>!document.querySelector('#export-edited-model').disabled&&!document.querySelector('#model-edit-form').hidden);}
    async function marquee(){
        await page.locator('#pick-pattern').click();await wait(150);
        const fits=()=>read(()=>{const t=document.querySelector('#target').getBoundingClientRect(),nodes=[...document.querySelectorAll('#target .node[data-model-node]')].map(n=>n.getBoundingClientRect());return nodes.length===3&&nodes.every(r=>r.left>t.left+20&&r.right<t.right-20&&r.top>t.top+20&&r.bottom<t.bottom-20);});
        for(let i=0;i<16&&!await fits();i++){await page.locator('#zoom-out').click();await wait(100);}assert.ok(await fits(),'Three source OPs must fit before native marquee.');
        const r=await read(()=>{const t=document.querySelector('#target').getBoundingClientRect();return {left:t.left,top:t.top,right:t.right,bottom:t.bottom};});
        assert.ok(await read((x,y)=>!!document.elementFromPoint(x,y)?.closest('#target'),r.left+16,r.top+16),'Marquee must start on the graph, beyond the sidebar resize handle.');
        await page.mouse.move(r.left+16,r.top+16);await page.mouse.down();await page.mouse.move(r.right-16,r.bottom-16,{steps:12});await page.mouse.up();
        await until(()=>document.querySelector('#capture-count').textContent==='已選取 3 個 layers');
    }
    const saved=new Set();
    async function patternMatches(structure,name,total){
        await page.locator('[data-kind="patterns"]').click();
        if(!saved.has(name)){const filename=path.join(directory,`edit-pattern-${saved.size}.json`);await writeFile(filename,exportPatterns([reusablePattern(name,structure)]),{flag:'wx'});await page.locator('#open-import').click();const event=page.waitForEvent('filechooser');await page.locator('#choose-pattern-file').click();await(await event).setFiles(filename);await page.locator('#confirm-import').click();saved.add(name);}
        await page.locator('#saved-pattern').selectOption(name);await until(expected=>document.querySelector('#result-count').textContent===expected,`${total} 筆匹配路徑`);
    }
    async function exportFile(extension){let event=page.waitForEvent('download');await page.locator('#export-edited-model').click();let download=await event;assert.equal(await download.failure(),null);const filename=path.join(directory,`model-edit-${++serial}.${extension}`);await download.saveAs(filename);await download.delete();await until(()=>!document.querySelector('#open-edited-model').disabled);assert.equal(await read(()=>document.querySelector('#download-model-edit-report').disabled),false);event=page.waitForEvent('download');await page.locator('#download-model-edit-report').click();download=await event;assert.equal(await download.failure(),null);const reportFile=filename+'.report.json';await download.saveAs(reportFile);await download.delete();const record=JSON.parse(await readFile(reportFile,'utf8'));assert.equal(record.provenance.mode,'model-edit');assert.equal(record.checks.find(c=>c.id==='serialized-roundtrip').status,'passed');const receipt=await verifyExportFiles({report:record,source:activeSourcePath,output:filename});assert.ok(['passed','not-applicable'].includes(receipt.byteComparison.status));report.receipts.push({output:path.basename(filename),sha256:receipt.outputSHA256,byteRanges:receipt.byteComparison.ranges.length,byteStatus:receipt.byteComparison.status,nativeCompiler:receipt.nativeCompiler.status});lastOutputPath=filename;return filename;}
    async function errorExport(pattern){const before=downloads;await page.locator('#export-edited-model').click();await until(()=>!document.querySelector('#export-edited-model').disabled&&document.querySelector('#model-edit-result').textContent.length>0);assert.match(await read(()=>document.querySelector('#model-edit-result').textContent),pattern);assert.equal(downloads,before);assert.equal(await read(()=>document.querySelector('#open-edited-model').disabled),true);}
    async function layout(){for(const viewport of [{width:1366,height:640},{width:390,height:844}]){await page.setViewportSize(viewport);await wait(100);const bounds=await read(()=>{const d=document.querySelector('#model-edit-dialog'),r=d.getBoundingClientRect();return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollWidth,client:d.clientWidth};});assert.ok(bounds.documentWidth<=bounds.width+1&&bounds.left>=0&&bounds.right<=bounds.width+1&&bounds.top>=0&&bounds.bottom<=bounds.height+1&&bounds.scroll<=bounds.client+1,JSON.stringify(bounds));report.layouts.push(bounds);}await page.setViewportSize({width:1366,height:640});}
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});await until(()=>typeof document.querySelector('#autosave-enabled').onchange==='function');
        const original=await customFixture({external:true}),input=path.join(directory,'model-edit-custom.tflite'),sourceIndex=await tf(original.bytes),tfPattern=captureGraphPattern(sourceIndex.graphs[0],[0,1,2]);await writeFile(input,original.bytes,{flag:'wx'});await choose(input);await ready(3);await locate('#0');
        await marquee();await page.locator('#target .node[data-model-node="0"]').press('Space');await until(()=>document.querySelector('#capture-count').textContent==='已選取 2 個 layers');
        const positions=()=>read(()=>[...document.querySelectorAll('#target .node[data-model-node]')].map(n=>{const r=n.getBoundingClientRect();return {id:n.dataset.modelNode,x:r.x,y:r.y};}));
        const before=await positions(),targets=await picker();assert.deepEqual(targets.map(t=>t.key),['0:1','0:2']);assert.ok(targets[0].label.includes('InternalSplitFoo'));await pickTarget('0:1');assert.match(await read(()=>document.querySelector('#model-edit-target').textContent),/OP #1 · InternalSplitFoo/);
        await page.locator('#model-edit-back').click();await until(()=>!document.querySelector('#model-edit-target-picker').hidden);await pickTarget('0:2');assert.match(await read(()=>document.querySelector('#model-edit-target').textContent),/OP #2/);await page.keyboard.press('Escape');await until(()=>!document.querySelector('#model-edit-dialog').open);
        assert.equal(await read(()=>document.querySelector('#capture-count').textContent),'已選取 2 個 layers');assert.deepEqual(await positions(),before);report.multiSelection.push({format:'tflite',nativeMarquee:true,targets,staleTargetExcluded:true,selectionPreserved:true,cameraPreserved:true});
        await page.locator('#target .node[data-model-node="0"]').press('Space');await picker('#edit-capture-model');await layout();await pickTarget('0:0');
        assert.match(await read(()=>document.querySelector('#model-edit-target').textContent),/OP #0/);await layout();
        for(let i=0;i<80&&await read(()=>document.activeElement.id!=='close-model-edit');i++)await page.keyboard.press('Tab');
        assert.equal(await read(()=>document.activeElement.id),'close-model-edit');await page.keyboard.press('Shift+Tab');assert.equal(await read(()=>document.activeElement.id),'export-edited-model');await page.keyboard.press('Tab');assert.equal(await read(()=>document.activeElement.id),'close-model-edit');await page.keyboard.press('Escape');await until(()=>!document.querySelector('#model-edit-dialog').open);assert.equal(await read(()=>document.activeElement.id),'edit-capture-model');await ready(3);await picker();await pickTarget('0:0');
        await page.locator('#model-edit-mode').selectOption('add-after');let filename=await exportFile('tflite');let bytes=new Uint8Array(await readFile(filename)),index=await tf(bytes);
        assert.equal(index.raw.subgraphs[0].operators.length,4);assert.deepEqual([...index.raw.subgraphs[0].outputs],[9,10]);
        const custom=index.raw.subgraphs[0].operators[2],buffer=index.raw.buffers[3];assert.deepEqual(bytes.subarray(Number(custom.large_custom_options_offset),Number(custom.large_custom_options_offset+custom.large_custom_options_size)),original.options);assert.deepEqual(bytes.subarray(Number(buffer.offset),Number(buffer.offset+buffer.size)),original.weight);
        await ready(3);await openResult(4);await patternMatches(tfPattern,'Actual-model custom branch',1);await locate('#0');await editor();await page.locator('[data-model-port="0"]').fill('7');await errorExport(/dtype/);await ready(4);
        await page.locator('[data-model-port="0"]').fill('1');await page.locator('[data-model-parameter="fused_activation_function"]').fill('3');filename=await exportFile('tflite');index=await tf(new Uint8Array(await readFile(filename)));assert.equal(index.raw.subgraphs[0].operators[0].builtin_options.fused_activation_function,3);await openResult(4);
        // Pause a real candidate metadata request, then close the dialog. Its
        // eventual completion must not publish an obsolete download/action.
        await locate('#0');await editor();let release,observed;const hold=new Promise(r=>{release=r;}),seen=new Promise(r=>{observed=r;});
        const holdMetadata=async route=>{observed();await hold;await route.fallback();};await page.context().route('**/tflite-metadata.json',holdMetadata);
        let metadataTimer;try{const before=downloads;await page.locator('#export-edited-model').click();await Promise.race([seen,new Promise((_,reject)=>{metadataTimer=setTimeout(()=>reject(Error('Candidate verification metadata request was not observed.')),10000);})]);await page.locator('#close-model-edit').click();release();await until(()=>document.querySelector('#model-edit-dialog').dataset.pendingExports==='0');assert.equal(downloads,before);await ready(4);assert.equal(await read(()=>document.querySelector('#open-export-model').hidden),true);}finally{clearTimeout(metadataTimer);release();await page.context().unroute('**/tflite-metadata.json',holdMetadata);}
        await locate('InternalSplitFoo');await editor();assert.match(await read(()=>document.querySelector('#model-edit-target').textContent),/OP #2 · InternalSplitFoo/);await page.locator('#model-edit-mode').selectOption('remove');await errorExport(/缺少先前/);await page.locator('#model-edit-delete-mode').selectOption('boundary');filename=await exportFile('tflite');index=await tf(new Uint8Array(await readFile(filename)));assert.equal(index.raw.subgraphs[0].operators.length,3);assert.deepEqual([...index.raw.subgraphs[0].inputs],[1,2,7,8]);assert.equal(index.raw.subgraphs[0].tensors[7].quantization.scale[0],.25);await openResult(3);await patternMatches(tfPattern,'Actual-model custom branch',0);await closed(()=>page.locator('#close-model').click());
        report.cases.push({format:'tflite',added:1,removed:1,parameter:3,weights:'identical',customOptions:'identical',invalidRewire:'rejected',danglingRemoval:'rejected',cancelledCandidate:'discarded',newBoundary:[1,2,7,8]});check('actual TFLite OP add/parameter edit/delete, real custom bytes, invalid wiring and cancelled candidate, direct reopen and worker closure');
        assert.deepEqual(report.tfliteParserRequests,[],'TFLite-only editing must not load the MLIR parser.');tflitePhase=false;if(!allowMlir)return report;

        for(const [name,text,count,operator] of [['branch',MLIR_CFG_DIAMOND,7,'company.custom_long_name_with_attributes'],['loop',MLIR_CFG_LOOP,4,'company.step']]){
            const input=path.join(directory,`model-edit-${name}.mlir`);await writeFile(input,text,{flag:'wx'});await choose(input);await ready(count);await locate(operator);await editor();await layout();
            if(name==='loop'){await page.locator('[data-model-port="0"]').fill('%answer');await errorExport(/SSA|dominance/);await page.locator('[data-model-port="0"]').fill('%iteration');}
            const renamed=`company.changed_${name}`;await page.locator('#model-edit-name').fill(renamed);filename=await exportFile('mlir');let edited=await ml(await readFile(filename,'utf8'));assert.deepEqual(validateMLIR(edited).diagnostics,[]);assert.ok(edited.graphs.some(g=>g.graph.nodes.some(n=>n.type.name===renamed)));if(name==='branch')assert.ok((await readFile(filename,'utf8')).includes('9223372036854775807 : i64'));
            const pattern=captureMLIRPattern(edited,edited.mlir.graphs.map((g,graph)=>({graph,nodes:g.operations.map((_,node)=>node)})));await openResult(count);await patternMatches(pattern,`Actual-model ${name}`,1);await page.locator('.result-item').first().click();await ready(count);await page.locator('#pick-pattern').click();await page.locator('#add-visible-layers').click();
            const picked=await read(()=>document.querySelector('#capture-count').textContent),targets=await picker('#edit-capture-model');assert.equal(targets.length,count);const target=targets.find(t=>t.label.endsWith(' · '+renamed));assert.ok(target);await page.keyboard.press('Escape');await until(()=>!document.querySelector('#model-edit-dialog').open);assert.equal(await read(()=>document.querySelector('#capture-count').textContent),picked);await picker();await pickTarget(target.key);assert.ok((await read(()=>document.querySelector('#model-edit-target').textContent)).includes(renamed));report.multiSelection.push({format:'mlir',name,targets:targets.length,blocks:new Set(targets.map(t=>t.key.split(':')[0])).size,selectionPreserved:true});
            if(name==='branch'){
                await page.locator('#model-edit-mode').selectOption('add-after');await page.locator('#model-edit-name').fill('company.extra');await page.locator('#model-edit-advanced').check();await until(()=>!document.querySelector('#export-edited-model').disabled);assert.ok((await read(()=>document.querySelector('#model-edit-ir').value)).includes('company.extra'));
                filename=await exportFile('mlir');edited=await ml(await readFile(filename,'utf8'));assert.equal((await findMLIRPatterns(edited,pattern)).items.length,1);await openResult(count+1);await patternMatches(pattern,`Actual-model ${name}`,1);await locate('company.extra');await editor();
            }
            await page.locator('#model-edit-mode').selectOption('remove');if(name==='loop')await page.locator('[data-model-port="0"]').fill('%iteration');filename=await exportFile('mlir');edited=await ml(await readFile(filename,'utf8'));assert.deepEqual(validateMLIR(edited).diagnostics,[]);assert.equal((await findMLIRPatterns(edited,pattern)).items.length,name==='branch'?1:0);
            await openResult(name==='branch'?count:count-1);await patternMatches(pattern,`Actual-model ${name}`,name==='branch'?1:0);await closed(()=>page.locator('#close-model').click());
            report.cases.push({format:'mlir',name,renamed,added:name==='branch'?1:0,removed:1,ssa:'passed',controlFlow:'passed',patternAfterRemoval:name==='branch'?1:0,dominanceNegative:name==='loop'?'rejected':'not-applicable'});check(`actual ${name} MLIR model edit, custom attributes, SSA/control validation, pattern positive/negative, export/direct reopen and worker closure`);
        }
    }finally{page.off('download',downloaded);page.off('filechooser',intercept);page.context().off('request',parserRequest);}
    return report;
}
