import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {runtimeFixture} from '../runtime-fixture.mjs';
import {FlatbufferWriter} from '../../src/flatbuffer-writer.js';
import {parseModel} from '../../src/model-engine.js';
import {verifyExportFiles} from '../../scripts/verify-export.mjs';

async function fixture(kind) {
    const {model}=await runtimeFixture({
        inputShapes:kind==='valid'?[[2,1],[1,3]]:[[2,2],[3]],
        outputShape:[2,3]
    });
    const graph=model.subgraphs[0];
    if(kind==='dynamic')graph.tensors[0].shape_signature=Int32Array.of(2,-1);
    const bias=new Uint8Array(12),view=new DataView(bias.buffer);
    [10,20,30].forEach((value,axis)=>view.setFloat32(4*axis,value,true));
    graph.tensors[1].buffer=model.buffers.length;
    graph.inputs=Int32Array.of(0);
    model.buffers.push({data:bias,offset:0n,size:0n});
    const output=graph.tensors[2];
    graph.tensors.push(Object.assign(Object.create(Object.getPrototypeOf(output)),output,{name:'d'}));
    const add=graph.operators[0];
    graph.operators.push(Object.assign(Object.create(Object.getPrototypeOf(add)),add,{
        inputs:Int32Array.of(2,1),outputs:Int32Array.of(3)
    }));
    graph.outputs=Int32Array.of(3);
    return new Uint8Array(await new FlatbufferWriter().finish(model,new Blob()).arrayBuffer());
}

export async function addFlow({page,read,base,directory,check}) {
    const cases=[],workers=[];
    let downloads=0;
    const onDownload=()=>downloads++;
    const onWorker=worker=>{
        const record={url:worker.url(),closed:false};
        workers.push(record);
        worker.once('close',()=>record.closed=true);
    };
    const until=async(fn,...args)=>{
        const end=Date.now()+20000;
        while(!await read(fn,...args)){
            assert.ok(Date.now()<end,'ADD UI timeout: '+fn);
            await new Promise(resolve=>setTimeout(resolve,60));
        }
    };
    const ready=()=>until(()=>document.querySelector('#model-tabs').getAttribute('aria-busy')==='false'&&
        document.querySelector('#loading-card').hidden&&document.querySelector('#target').getAttribute('aria-busy')==='false');
    const choose=async file=>{
        const event=page.waitForEvent('filechooser');
        await page.locator('#open-model').click();
        await(await event).setFiles(file);
        await until(name=>document.querySelector('#file-name').textContent===name,path.basename(file));
        await ready();
    };
    const save=async(selector,name)=>{
        const event=page.waitForEvent('download');
        await page.locator(selector).click();
        const item=await event;
        assert.equal(await item.failure(),null);
        const output=path.join(directory,name);
        await item.saveAs(output);
        await item.delete();
        return output;
    };
    const close=async(discard=false)=>{
        if(discard)page.once('dialog',dialog=>dialog.accept());
        const count=await page.locator('#model-tabs [role="tab"]').count();
        await page.locator('#explore-mode').click();
        await page.locator('#close-model').click();
        await until(n=>document.querySelectorAll('#model-tabs [role="tab"]').length===n,count-1);
        await ready();
    };
    const metadata=JSON.parse(await readFile(new URL('../../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    page.on('worker',onWorker);
    page.on('download',onDownload);
    try{
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await until(()=>!document.querySelector('#open-model').disabled);
        for(const kind of ['invalid','valid','dynamic']){
            const source=path.join(directory,kind+'-source.tflite');
            await writeFile(source,await fixture(kind),{flag:'wx'});
            await choose(source);
            await page.locator('#layers-tab').click();
            await page.locator('#query').fill('#1');
            await until(()=>document.querySelector('#results').dataset.searchQuery==='#1'&&document.querySelector('#result-count').textContent==='1 筆結果');
            await page.locator('.result-item').click();
            await ready();
            await page.locator('#graph-font-size').selectOption('32');
            await ready();
            await page.locator('#edit-mode').click();
            await until(()=>document.body.classList.contains('editing-model')&&document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false');
            await page.locator('#edit-font').selectOption('32');
            await page.locator('[data-edit-node="op:0:1"] .edit-node-title').click();
            await page.locator('#edit-add-after').click();
            await until(()=>document.querySelectorAll('.edit-node.added').length===1);
            await page.locator('#edit-expose').check();
            if(kind==='invalid'){
                const before=downloads;
                await page.locator('#edit-export').click();
                await until(()=>document.querySelector('#edit-workspace').getAttribute('aria-busy')==='false'&&
                    document.querySelector('#edit-message').textContent.includes('無法 broadcast'));
                const reason=await page.locator('#edit-message').textContent();
                assert.match(reason,/Subgraph #0.*OP #0.*inputs \[0, 1\].*outputs \[2\].*ADD.*無法 broadcast/);
                assert.equal(downloads,before);
                await page.screenshot({path:path.join(directory,'invalid-32px.png')});
                cases.push({kind,status:'rejected',reason,downloads:0});
                await close(true);
                continue;
            }
            const output=await save('#edit-export',kind+'-edited.tflite');
            await until(()=>!document.querySelector('#edit-download-report').disabled);
            const record=await save('#edit-download-report',kind+'.report.json');
            const report=JSON.parse(await readFile(record,'utf8'));
            const statuses=kind==='dynamic'?['not-run','passed','passed']:['passed','passed','passed'];
            assert.deepEqual(report.operatorValidation.map(({type,status})=>[type,status]),statuses.map(status=>['ADD',status]));
            assert.equal(report.operatorSummary.unchecked,kind==='dynamic'?1:0);
            assert.ok(report.checks.filter(c=>c.id.startsWith('runtime')).every(c=>c.status==='not-run'));
            const audit=await verifyExportFiles({report,source,output});
            assert.equal(audit.byteComparison.status,'passed');
            const bytes=new Uint8Array(await readFile(output)),model=await parseModel((o,n)=>bytes.subarray(o,o+n),bytes.length,metadata);
            assert.equal(model.raw.subgraphs[0].operators.length,3);
            if(kind==='dynamic')assert.deepEqual(Array.from(model.raw.subgraphs[0].tensors[0].shape_signature),[2,-1]);
            await page.locator('#edit-view-report').click();
            await until(()=>document.querySelector('#export-report-dialog').open);
            const layout=await read(()=>{
                const d=document.querySelector('#export-report-dialog'),r=d.getBoundingClientRect();
                return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:d.clientWidth,scroll:d.scrollWidth};
            });
            assert.ok(layout.left>=0&&layout.right<=layout.width+1&&layout.top>=0&&layout.bottom<=layout.height+1&&layout.scroll<=layout.client+1);
            await page.screenshot({path:path.join(directory,kind+'-32px.png')});
            await page.locator('#close-export-report').click();
            await page.locator('#explore-mode').click();
            await choose(output);
            await page.locator('#layers-tab').click();
            await page.locator('#query').fill('Add');
            await until(()=>document.querySelector('#results').dataset.searchQuery==='Add'&&document.querySelector('#result-count').textContent==='3 筆結果');
            cases.push({kind,status:'passed',statuses,layout,outputSHA256:audit.outputSHA256,reopenedOperators:3});
            while(await page.locator('#model-tabs [role="tab"]').count())await close();
        }
        await until(()=>document.querySelector('#model-tabs').hidden);
        const deadline=Date.now()+5000;
        while(workers.some(w=>!w.closed)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
        assert.ok(workers.length>0&&workers.every(w=>w.closed));
        assert.equal(workers.filter(w=>w.url.includes('/tflite-runtime-worker.js')).length,0);
        assert.equal(downloads,4);
        check('ADD invalid input broadcast rejected before download; float32 and dynamic ADD report and reopen at 32px');
        return {status:'passed',cases,workers,downloads,modelWorkers:workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w.url)).length};
    }catch(error){
        error.addValidation={status:'failed',cases,workers,downloads};
        throw error;
    }finally{
        page.off('worker',onWorker);
        page.off('download',onDownload);
    }
}
