import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,cp} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readProfile,installProfile} from '../scripts/lib/build-profile.mjs';
const root=path.resolve('build/qa/custom-references');
async function stage(){
    await mkdir(root,{recursive:true});const directory=await mkdtemp(path.join(root,'profile-test-'));assert.equal(path.dirname(directory),root);
    await mkdir(path.join(directory,'src'));await writeFile(path.join(directory,'package.json'),'{"type":"module"}');
    for(const name of ['flex-scalar-map.js','tflite-custom-contract.js','tflite-public-custom-contracts.js','tflite-custom-registry.js'])await cp(new URL('../src/'+name,import.meta.url),path.join(directory,'src',name));
    // Small owned fixtures are retained in ignored build/ for task audit.
    return directory;
}
async function profile(directory,extra){
    const ext=path.join(directory,'extension');await mkdir(ext);await writeFile(path.join(ext,'index.js'),`export const mlirDialects=[];\n${extra}\n`);
    const p=path.join(directory,'profile.json');await writeFile(p,JSON.stringify({schemaVersion:1,distribution:'internal',name:'public synthetic contract test',extensionVersion:'1.0.0',adapterInterfaceVersion:1,dialectDirectory:'./extension'}));return readProfile(p);
}
const spec={interfaceVersion:1,customCode:'PublicSyntheticPrivateContract',versionMin:1,versionMax:1,coverage:'local-ports-options-only',options:{format:'fixed-u32-le',byteLength:4,prefix:[80,82,69,70],references:[]}};
test('internal optional contract registry is isolated; public registry contains only audited public contracts',async()=>{
    const internal=await stage(),p=await profile(internal,'export const tfliteCustomContracts='+JSON.stringify([spec])+';');await installProfile(internal,p);
    const registered=await import(pathToFileURL(path.join(internal,'src/tflite-custom-registry.js')).href);assert.equal(registered.tfliteCustomContracts.length,2);assert.equal(registered.tfliteCustomContracts[1].customCode,spec.customCode);
    const publicStage=await stage();await installProfile(publicStage,await readProfile());const clean=await import(pathToFileURL(path.join(publicStage,'src/tflite-custom-registry.js')).href);assert.equal(clean.tfliteCustomContracts.length,1);assert.equal(clean.tfliteCustomContracts[0].customCode,'TFLite_Detection_PostProcess');assert.ok(!(await readFile(path.join(publicStage,'src/tflite-custom-registry.js'),'utf8')).includes(spec.customCode));
});
test('legacy MLIR-only extensions still build; duplicate or malformed TFLite declarations reject',async()=>{
    const legacy=await stage();await installProfile(legacy,await profile(legacy,''));assert.equal((await import(pathToFileURL(path.join(legacy,'src/tflite-custom-registry.js')).href)).tfliteCustomContracts.length,1);
    const duplicate=await stage(),d={...spec,customCode:'TFLite_Detection_PostProcess'};await installProfile(duplicate,await profile(duplicate,'export const tfliteCustomContracts='+JSON.stringify([d])+';'));await assert.rejects(import(pathToFileURL(path.join(duplicate,'src/tflite-custom-registry.js')).href),/重複/);
    const malformed=await stage();await installProfile(malformed,await profile(malformed,'export const tfliteCustomContracts=null;'));await assert.rejects(import(pathToFileURL(path.join(malformed,'src/tflite-custom-registry.js')).href),/契約/);
});
