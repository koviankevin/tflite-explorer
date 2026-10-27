// Internal child of accept-performance: each sample owns a fresh Node process.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fixture} from '../test/fixture.mjs';
import {performanceMLIR} from '../test/performance-fixtures.mjs';
import {parseModel,search,snapshot} from '../src/model-engine.js';
import {prepareGraphPattern,findSubgraphPatterns} from '../src/subgraph-pattern.js';
import {preparePatternOverview,patternOverviewSnapshot} from '../src/pattern-overview.js';
import {parseMLIR} from '../src/mlir-engine.js';
import {captureMLIRPattern,findMLIRPatterns,mlirSliceSnapshot} from '../src/mlir-pattern.js';
import {exportMLIR} from '../src/mlir-export.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {validatePerformancePolicy} from './lib/performance-policy.mjs';

const policy=validatePerformancePolicy(JSON.parse(await readFile(new URL('../test/performance-policy.json',import.meta.url),'utf8'))),c=policy.cases.find(c=>c.id===process.argv[2]);
if(!c)throw Error('Unknown performance case.');
const metrics={},checks={};let actualFixture;
const measure=async(name,action)=>{const start=performance.now(),result=await action();metrics[name]=performance.now()-start;return result;};
const blobHash=async blob=>{const hash=createHash('sha256');for await(const chunk of blob.stream())hash.update(chunk);return hash.digest('hex');};
if(c.fixture.kind==='virtual-tflite') {
    const source=fixture({graphCount:1,repeats:c.fixture.repeats,weightBytes:c.fixture.weightBytes});
    actualFixture={...c.fixture,bytes:source.totalBytes,headerSHA256:createHash('sha256').update(source.data).digest('hex')};
    let bytesRead=0,maxReadBytes=0;
    const readAt=(offset,length)=>{
        // Guard before allocating, so a whole-file regression fails safely.
        if(length>1048576 || bytesRead+length>33554432)throw Error('Range-read guard exceeded.');
        bytesRead+=length;maxReadBytes=Math.max(maxReadBytes,length);
        const data=new Uint8Array(length);if(offset<source.data.length)data.set(source.data.subarray(offset,offset+length));return data;
    };
    const metadata=JSON.parse(await readFile(new URL('../vendor/netron/tflite-metadata.json',import.meta.url),'utf8'));
    const index=await measure('parseMs',()=>parseModel(readAt,source.totalBytes,metadata));
    checks.layers=index.graphs[0].graph.nodes.length;
    const times=[];checks.searchExact=true;
    for(let n=0;n<5;n++){const start=performance.now();const result=search(index,'layers',`#${n}`,'all');times.push(performance.now()-start);checks.searchExact &&= result.length===1 && result[0].index===n;}
    metrics.searchMsMax=Math.max(...times);
    const spec=prepareGraphPattern([{alias:'a',type:'Reshape'},{alias:'b',type:'Transpose'},{alias:'c',type:'Reshape'}],[{from:'a',to:'b'},{from:'b',to:'c'}]);
    const result=await measure('patternMs',()=>findSubgraphPatterns(index,spec));
    checks.matches=result.items.length;checks.truncated=!!result.truncated;
    let requested=false;const timer=setTimeout(()=>requested=true,0),start=performance.now();let cancelled;
    try{cancelled=await findSubgraphPatterns(index,spec,'all',()=>requested);}finally{clearTimeout(timer);}
    metrics.cancelMs=performance.now()-start;checks.cancelResponsive=cancelled===null || metrics.cancelMs<=50;
    const dto=snapshot(index,0,result.items[0]?.path || [0]);metrics.localNodes=dto.graph.nodes.length;
    const plan=await measure('overviewMs',()=>preparePatternOverview(index,result.items)),overview=patternOverviewSnapshot(plan);
    checks.overviewNodes=overview.graph.nodes.length;checks.virtual=!!overview.virtual;
    metrics.bytesRead=bytesRead;metrics.maxReadBytes=maxReadBytes;
} else {
    const text=performanceMLIR(c.fixture.hidden),bytes=new TextEncoder().encode(text),metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
    actualFixture={...c.fixture,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    const parse=text=>parseMLIR(typeof text==='string'?new TextEncoder().encode(text):text,{metadata,identifier:'performance.mlir'});
    let index=await measure('parseMs',()=>parse(bytes));checks.layers=index.graphs.reduce((n,g)=>n+g.graph.nodes.length,0);checks.blocks=index.graphs.length;
    const selections=[0,1,2,3,4].map(graph=>({graph,nodes:[0]}));
    const patternStart=performance.now(),pattern=captureMLIRPattern(index,selections),found=await findMLIRPatterns(index,pattern);metrics.patternMs=performance.now()-patternStart;checks.matches=found.items.length;
    checks.ssaValid=validateMLIR(index).diagnostics.length===0;
    let exported=await measure('exportMs',()=>exportMLIR(index,0,[0],{scope:'slice',selections}));metrics.outputBytes=exported.blob.size;
    const blob=exported.blob;
    // Match close/reopen ownership: keep the file bytes and saved pattern, not
    // both live model indexes or the exporter's transient provenance maps.
    index=null;exported=null;
    const reopened=await measure('reopenMs',async()=>parse(await blob.text()));checks.reopenedMatches=(await findMLIRPatterns(reopened,pattern)).items.length;
    checks.ssaValid &&= validateMLIR(reopened).diagnostics.length===0;
    const graph=found.items[0]?.blocks[0].graph || 0,base=mlirSliceSnapshot(reopened,graph);
    const connection=base.sliceConnections.find(c=>c.from===c.to);if(!connection)throw Error('Expected actual loop connection.');
    const chosen=base.item.blocks.map(b=>({graph:b.graph,nodes:b.path}));
    const reExport=()=>exportMLIR(reopened,chosen[0].graph,chosen[0].nodes,{scope:'slice',selections:chosen});
    const beforePaging=await blobHash((await reExport()).blob);
    const key=connection.key,started=performance.now();let page,pathWorkMax=0,displayHelpersMax=0;
    for(let n=0;n<50;n++) {
        page=mlirSliceSnapshot(reopened,graph,{expandedConnections:[key]});pathWorkMax=Math.max(pathWorkMax,page.slicePathStats.work);displayHelpersMax=Math.max(displayHelpersMax,page.sliceHelperCount);
        if(!page.sliceConnections.find(c=>c.key===key).pending)break;
    }
    metrics.discoveryMs=performance.now()-started;const corridor=page.sliceConnections.find(c=>c.key===key);checks.pathResolved=!corridor.pending && corridor.pages>100;
    const indexes=[...reopened.mlir.connectionIndexes.values()],materializations=()=>indexes.reduce((n,index)=>n+index.materializations,0);
    const show=part=>mlirSliceSnapshot(reopened,graph,{expandedConnections:[key],connectionPages:{[key]:part}});
    show(0);show(corridor.pages-1);const baseline=materializations(),times=[];checks.cachedPageWork=0;checks.cachedPageHits=1;
    for(let n=0;n<20;n++) {
        const start=performance.now(),dto=show(n%2?0:corridor.pages-1);times.push(performance.now()-start);
        checks.cachedPageWork=Math.max(checks.cachedPageWork,dto.slicePathStats.work);checks.cachedPageHits=Math.min(checks.cachedPageHits,dto.slicePathStats.cacheHits);
        displayHelpersMax=Math.max(displayHelpersMax,dto.sliceHelperCount);
        mlirSliceSnapshot(reopened,graph); // Collapse between page switches.
    }
    metrics.pageMsMax=Math.max(...times);metrics.newMaterializationsAfterWarmup=materializations()-baseline;
    metrics.pathWorkMax=pathWorkMax;metrics.displayHelpersMax=displayHelpersMax;
    checks.exportStableAfterPaging=beforePaging===await measure('repeatExportMs',async()=>blobHash((await reExport()).blob));
}
metrics.maxRSSBytes=process.resourceUsage().maxRSS*1024;
console.log(JSON.stringify({caseId:c.id,status:'measured',fixture:actualFixture,metrics,checks}));
