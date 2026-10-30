// Independent Hosted diagnosis only. Never invoked by the application or while
// collecting the original RSS acceptance samples. Read native DOM, not Services.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {sha256} from '../../scripts/lib/release-artifact.mjs';

export function memoryReporterSourceProof(source){
    assert.equal(typeof source,'string');assert.ok(Buffer.byteLength(source)>0&&Buffer.byteLength(source)<=256*1024,'Native reporter source size invalid');
    const body=name=>{const match=new RegExp('^function '+name+'\\(\\)\\s*\\{([\\s\\S]*?)^\\}','m').exec(source);assert.ok(match,'Unsupported native reporter source function '+name);return match[1];};
    const dispatch=body('doMeasure'),collect=body('updateAboutMemoryFromReporters');
    assert.match(source,/appendButton\(\s*\w+,\s*\w+,\s*doMeasure,\s*["']Measure["'],\s*["']measureButton["']\s*\)/,'Native Measure button wiring changed');
    assert.equal(dispatch.replace(/\s+/g,''),'updateAboutMemoryFromReporters();','Native Measure dispatch changed');
    assert.match(collect,/\bgMgr\.getReports\s*\(/,'Native source must use ordinary reports');
    assert.doesNotMatch(collect,/\b(?:doGC|doCC|doMMU|forceGC|garbageCollect|cycleCollect|minimizeMemoryUsage)\s*\(/,'Native measurement may explicitly collect memory');
    return {reporterOnly:true,bytes:Buffer.byteLength(source),sha256:sha256(Buffer.from(source)),dispatch:'doMeasure → updateAboutMemoryFromReporters → getReports',scope:'Static handler proof, not a claim that the engine performs no ordinary GC.'};
}

export function installedFirefoxReporterProof(executable){
    assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.ok(path.isAbsolute(executable)&&path.basename(executable)==='firefox');
    const code=`import sys,json,zipfile,hashlib,pathlib
root=pathlib.Path(sys.argv[1]).resolve().parent
matches=[]
for candidate in [root/'omni.ja',root/'browser'/'omni.ja']:
 if not candidate.exists(): continue
 archive=candidate.resolve(); assert archive.is_relative_to(root) and archive.is_file()
 with zipfile.ZipFile(archive) as z:
  entries=[i for i in z.infolist() if i.filename.endswith('/aboutMemory.js')]
  for entry in entries:
   assert 0<entry.file_size<=256*1024 and not entry.is_dir()
   raw=z.read(entry); h=hashlib.sha256()
   with open(archive,'rb') as f:
    for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
   matches.append({'archive':str(archive.relative_to(root)),'archiveSHA256':h.hexdigest(),'entry':entry.filename,'sourceSHA256':hashlib.sha256(raw).hexdigest(),'source':raw.decode('utf-8')})
assert len(matches)==1, 'Missing or ambiguous installed aboutMemory.js'
print(json.dumps(matches[0],ensure_ascii=False))`;
    const raw=JSON.parse(execFileSync('python3',['-I','-c',code,executable],{encoding:'utf8',windowsHide:true,maxBuffer:512*1024,timeout:15000})),proof=memoryReporterSourceProof(raw.source);assert.equal(proof.sha256,raw.sourceSHA256);
    return {...proof,installed:{archive:raw.archive,archiveSHA256:raw.archiveSHA256,entry:raw.entry},scope:'Exact installed public Firefox bundle; read only, not a main-branch source assumption.'};
}

export async function readFirefoxNativeMemory(context,proof){
    assert.ok(proof?.reporterOnly===true&&/^[a-f0-9]{64}$/.test(proof.sha256||''),'Native reporter source proof required');
    const report={format:'model-lens-firefox-native-memory',version:1,status:'failed',sourceProof:proof,forcedGC:false,measureCalls:0,anonymized:true,verbose:true,pageClosed:false,errors:[],scope:'One native text snapshot after a separate control; rounded reporter values and reporter UI overhead, not RSS acceptance or continuous Worker/isolate heap.'};
    let page,failure;
    try{
        page=await context.newPage();page.on('pageerror',error=>{if(report.errors.length<12)report.errors.push(String(error.message).slice(0,512));else report.errorOverflow=true;});
        report.navigation={waitUntil:'commit',ready:false,timeoutRecovered:false};
        try{await page.goto('about:memory',{waitUntil:'commit',timeout:10000});}
        catch(error){report.navigation.error=String(error.message).slice(0,1024);report.navigation.url=page.url();if(error.name!=='TimeoutError')throw error;}
        report.navigation.url=page.url();assert.equal(report.navigation.url,'about:memory','Native page URI mismatch');
        report.navigation.documentURL=await page.locator('html').evaluate(element=>element.ownerDocument.URL,null,{timeout:5000});
        assert.equal(report.navigation.documentURL,'about:memory','Native document URI mismatch');
        await page.locator('#measureButton').waitFor({state:'visible',timeout:5000});
        report.navigation.ready=true;report.navigation.timeoutRecovered=Boolean(report.navigation.error);
        await page.locator('#verbose').check({timeout:5000});await page.getByLabel('anonymize',{exact:true}).check({timeout:5000});
        await page.locator('#measureButton').click({timeout:5000});report.measureCalls++;
        await page.getByText(/Main Process/).first().waitFor({state:'visible',timeout:15000});
        const text=await page.locator('body').innerText({timeout:5000}),bytes=Buffer.byteLength(text);assert.ok(bytes>0&&bytes<=512*1024,'Native memory text exceeds bounded artifact capacity');
        assert.ok(/Main Process/.test(text)&&/explicit/.test(text)&&/resident/.test(text),'Native memory report incomplete');assert.ok(!report.errors.length&&!report.errorOverflow,'Native memory page error');
        report.text=text;report.bytes=bytes;report.sha256=sha256(Buffer.from(text));
    }catch(error){failure=error;report.error=error.stack||String(error);}
    finally{if(page)try{await page.close();report.pageClosed=true;}catch(error){failure ||= error;report.errors.push('Close: '+String(error.message).slice(0,512));}}
    if(failure)throw Object.assign(failure,{firefoxNativeMemory:report});report.status='passed';return report;
}
