import assert from 'node:assert/strict';
import path from 'node:path';

// Hold one real layout request after text measurement. The graph data, worker
// algorithm and response are unchanged; all other messages pass through.
export function installFontRenderBarrier(){
    const native=Worker.prototype.postMessage;
    const barrier=globalThis.__fontRenderRace={armed:false,held:false,release:null};
    Worker.prototype.postMessage=function(message,...rest){
        if(barrier.armed&&message?.type==='dagre.layout'){
            barrier.armed=false;barrier.held=true;barrier.measuredNodes=message.nodes.map(n=>({width:n.width,height:n.height}));
            barrier.heldAt=performance.now();barrier.release=()=>{barrier.releasedAt=performance.now();barrier.held=false;barrier.release=null;native.call(this,message,...rest);};
        }else native.call(this,message,...rest);
    };
}

export async function fontRenderFlow({page,read,until,directory,check}){
    const result={cases:[],layoutRequestDelayed:true,geometryModified:false};
    const ready=()=>until(()=>document.querySelector('#target').getAttribute('aria-busy')==='false'&&document.querySelectorAll('#target .node-item-type text').length>0);
    const bounds=()=>read(()=>{
        const rectangle=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
        const pairs=[...document.querySelectorAll('#target .node-item-type')].map(g=>({kind:'operator',text:g.querySelector('text'),frame:g.querySelector('path')}));
        for(const g of document.querySelectorAll('#target .node-argument'))pairs.push({kind:'argument',text:g.querySelector(':scope > text'),frame:g.querySelector(':scope > rect')});
        return pairs.filter(p=>p.text&&p.frame).map(p=>({kind:p.kind,label:p.text.textContent,fontPx:parseFloat(getComputedStyle(p.text).fontSize),text:rectangle(p.text),frame:rectangle(p.frame)}));
    });
    const fit=rows=>{
        assert.ok(rows.some(r=>r.kind==='operator'));
        for(const r of rows){assert.equal(r.fontPx,32);assert.ok(r.frame.width>0&&r.frame.height>0);assert.ok(r.text.left>=r.frame.left-1&&r.text.right<=r.frame.right+1&&r.text.top>=r.frame.top-1&&r.text.bottom<=r.frame.bottom+1,`${r.kind} ${r.label} exceeds its measured frame at32px: ${JSON.stringify(r)}`);}
    };
    const originalFont=await page.locator('#graph-font-size').inputValue();let directionChanged=false;
    try{
        await page.locator('#graph-font-size').selectOption('14');await ready();
        await read(()=>{globalThis.__fontRenderRace.armed=true;return true;});
        await page.locator('#direction').click();directionChanged=true;
        await until(()=>globalThis.__fontRenderRace.held);
        await page.locator('#graph-font-size').selectOption('20');await page.locator('#graph-font-size').selectOption('32');
        result.barrier=await read(()=>({held:globalThis.__fontRenderRace.held,busy:document.querySelector('#target').getAttribute('aria-busy'),measuredNodes:globalThis.__fontRenderRace.measuredNodes}));
        assert.equal(result.barrier.held,true);assert.equal(result.barrier.busy,'true');
        await read(()=>{globalThis.__fontRenderRace.release();return true;});await ready();
        result.cases.push({kind:'font-changed-during-layout',rows:await bounds()});
        if(directory)await page.screenshot({path:path.join(directory,'font-reflow-32px.png')});
        fit(result.cases[0].rows);
        check?.('font changes during real SVG layout keep operator and argument text inside measured32px frames');
        return result;
    }catch(error){error.fontRender=result;throw error;}
    finally{
        await read(()=>{if(globalThis.__fontRenderRace.release)globalThis.__fontRenderRace.release();return true;}).catch(()=>{});
        if(directionChanged){await page.locator('#direction').click();await ready();}
        await page.locator('#graph-font-size').selectOption(originalFont);await ready();
    }
}
