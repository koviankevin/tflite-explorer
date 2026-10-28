import {readFile} from 'node:fs/promises';
import {MLIR_BRANCH,MLIR_CFG_DIAMOND,MLIR_CFG_LOOP} from './mlir-fixture.mjs';
import {parseMLIR} from '../src/mlir-engine.js';
import {validateMLIR} from '../src/mlir-validate.js';
import {captureMLIRPattern,findMLIRPatterns} from '../src/mlir-pattern.js';
import {preparePatternOverview,patternOverviewSnapshot} from '../src/pattern-overview.js';
import {reusablePattern} from '../src/pattern-library.js';
const metadata=await readFile(new URL('../vendor/netron/mlir-metadata.json',import.meta.url),'utf8');
export const parseKeyboardMLIR=text=>parseMLIR(new TextEncoder().encode(text),{metadata});
export const invalidKeyboardMLIR=MLIR_BRANCH.replace('"acme.reshape"(%split#0)','"acme.reshape"(%missing)');
export async function mlirKeyboardFixture(kind){
    const original=kind==='diamond'?MLIR_CFG_DIAMOND:kind==='loop'?MLIR_CFG_LOOP:null;if(!original)throw Error('Unknown public keyboard fixture');
    const reference=await parseKeyboardMLIR(original),structure=captureMLIRPattern(reference,reference.mlir.graphs.map((g,graph)=>({graph,nodes:g.operations.map((_,i)=>i)}))),pattern=reusablePattern(`Keyboard CFG ${kind}`,structure);
    const input=kind==='diamond'?'%input':'%initial',marker=kind==='diamond'?'    "cf.cond_br"(%cond)':'  "cf.br"(%initial)',padding=Array.from({length:1601},(_,i)=>`    %pad_${i} = "public.padding"(${input}) {ordinal = ${i} : i32} : (i32) -> i32`).join('\n');
    const text=original.replace(marker,padding+'\n'+marker),index=await parseKeyboardMLIR(text);if(validateMLIR(index).diagnostics.length)throw Error('Invalid public keyboard fixture');
    const matches=await findMLIRPatterns(index,pattern);if(matches.items.length!==1)throw Error('Expected one reference CFG match');
    const prepared=await preparePatternOverview(index,matches.items),snapshot=patternOverviewSnapshot(prepared,{expanded:[0],font:32});if(!snapshot.virtual)throw Error('Expected real Canvas threshold');
    const ids=prepared.matches[0].nodes.map(n=>n.identifier);
    return {text,index,pattern,match:matches.items[0],ids,layers:index.graphs.reduce((sum,g)=>sum+g.graph.nodes.length,0),blocks:matches.items[0].blocks.length};
}
