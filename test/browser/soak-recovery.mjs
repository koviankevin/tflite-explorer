// CI workload only: manage this invocation's synthetic drafts through the same
// backup / confirm-remove / retry controls a user sees. Never access IndexedDB.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {parseEditSession,exportEditSession,EDIT_DRAFT_LIMIT} from '../../src/model-edit-session.js';
import {EDIT_RECOVERY_COUNT} from '../../src/edit-recovery-store.js';

export const SOAK_RECOVERY_POLICY=Object.freeze({version:1,capacity:20,backupLimitBytes:EDIT_DRAFT_LIMIT,commands:2,font:32});
export const SOAK_CAPACITY_MESSAGE='編輯草稿尚未保存：已達 20 份本機編輯草稿上限；請先下載並移除不需要的草稿。';
const key=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sameKeys=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(k=>b.includes(k));
const commands=[{kind:'clone',node:'op:0:0',side:'after'},{kind:'expose',node:'new:1',enabled:true}];

export function inspectSoakBackup(text,fixture){
    const doc=parseEditSession(text);
    assert.equal(doc.source.name,path.basename(fixture.file));assert.equal(doc.source.format,'tflite');
    assert.equal(doc.source.bytes,fixture.bytes);assert.equal(doc.source.fingerprint,fixture.editFingerprint);
    assert.deepEqual(doc.history,{commands,redo:[]});assert.equal(doc.view.font,32);assert.equal(doc.view.selected,'new:1');
    assert.ok(doc.scope.nodes.length>=2&&doc.scope.nodes.length<=64&&doc.scope.nodes.some(n=>n.graph===0&&n.node===0));
    const canonical=exportEditSession(doc);
    return {downloaded:true,parsed:true,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(canonical).digest('hex'),sourceBytes:doc.source.bytes,sourceFingerprint:doc.source.fingerprint,commands:doc.history.commands.length,font:doc.view.font};
}
const validBackup=(b,fixture)=>b?.downloaded===true&&b.parsed===true&&Number.isSafeInteger(b.bytes)&&b.bytes>0&&b.bytes<=EDIT_DRAFT_LIMIT&&hash(b.sha256)&&b.sourceBytes===fixture?.bytes&&b.sourceFingerprint===fixture?.editFingerprint&&hash(b.sourceFingerprint)&&b.commands===2&&b.font===32;

export class SoakRecoveryLedger{
    constructor(fixture){assert.equal(EDIT_RECOVERY_COUNT,SOAK_RECOVERY_POLICY.capacity);this.fixture=fixture;this.records=new Map();this.seen=new Set();}
    oldest(keys){
        assert.equal(this.records.size,EDIT_RECOVERY_COUNT,'Capacity must be reached normally before removing any draft.');
        assert.ok(sameKeys(keys,[...this.records.keys()]),'Refusing to remove an unknown or missing saved draft.');
        return this.records.keys().next().value;
    }
    authorizeRemoval(keys,selected,backup){
        assert.equal(selected,this.oldest(keys));assert.ok(validBackup(backup,this.fixture));
        assert.deepEqual(backup,this.records.get(selected),'Saved draft changed after its final backup; refusing removal.');
    }
    removed(before,after,selected,backup){
        this.authorizeRemoval(before,selected,backup);
        assert.ok(sameKeys(after,before.filter(k=>k!==selected)),'Removing one draft changed other retained keys.');
        this.records.delete(selected);
    }
    saved(keys,backup){
        assert.ok(validBackup(backup,this.fixture));assert.ok(keys.every(key)&&new Set(keys).size===keys.length);
        assert.ok(keys.length<=EDIT_RECOVERY_COUNT&&keys.length===this.records.size+1);
        assert.ok([...this.records.keys()].every(k=>keys.includes(k)),'An existing draft disappeared.');
        const fresh=keys.filter(k=>!this.records.has(k));assert.equal(fresh.length,1);assert.equal(this.seen.has(fresh[0]),false,'A removed draft was resurrected.');
        this.records.set(fresh[0],backup);this.seen.add(fresh[0]);return fresh[0];
    }
}

// Reconstruct ownership, retention, hashes and retry transitions independently
// from the UI runner's in-memory ledger. A v1 soak has no such capacity proof.
export function evaluateSoakRecovery(cycles,fixture,recoveryPolicy){
    const issues=[],records=new Map(),seen=new Set(),require=(ok,name)=>{if(!ok)issues.push(name);};
    require(JSON.stringify(recoveryPolicy)===JSON.stringify(SOAK_RECOVERY_POLICY),'changed-recovery-policy');
    for(const [i,c] of cycles.entries()){
        const r=c?.recoveryStorage,e=r?.capacity;
        if(i>=EDIT_RECOVERY_COUNT){
            const before=[...records.keys()],oldest=before[0];
            require(e?.message===SOAK_CAPACITY_MESSAGE&&e.retrySaved===true&&e.remainingUnchanged===true&&e.key===oldest&&sameKeys(e.beforeKeys,before)&&sameKeys(e.afterRemoveKeys,before.filter(k=>k!==oldest)),'missing-capacity-transition-'+(i+1));
            require(validBackup(e?.backup,fixture)&&JSON.stringify(e.backup)===JSON.stringify(records.get(oldest)),'missing-verified-old-backup-'+(i+1));
            records.delete(oldest);
            require(sameKeys(e?.afterRetryKeys,[...records.keys(),r?.savedKey]),'missing-retry-record-'+(i+1));
        }else require(e===null,'premature-draft-removal-'+(i+1));
        require(r?.version===1&&key(r.savedKey)&&!seen.has(r.savedKey)&&validBackup(r.backup,fixture),'missing-downloaded-saved-draft-'+(i+1));
        require(sameKeys(r?.retainedKeys,[...records.keys(),r?.savedKey])&&r?.retainedKeys?.length===Math.min(i+1,EDIT_RECOVERY_COUNT),'changed-retained-drafts-'+(i+1));
        if(key(r?.savedKey)){records.set(r.savedKey,r.backup);seen.add(r.savedKey);}
    }
    return {status:issues.length?'failed':'passed',issues,saved:cycles.length,removed:Math.max(0,cycles.length-EDIT_RECOVERY_COUNT),retained:records.size};
}

export function validRecoveryPreflight(r){
    if(!r||r.status!=='passed'||r.browserClosed!==true||r.error||!Array.isArray(r.errors)||r.errors.length||r.viewport?.width!==1280||r.viewport?.height!==640||!Array.isArray(r.cycles)||r.cycles.length!==22||!r.cycles.every((c,i)=>c?.cycle===i+1)||!Number.isSafeInteger(r.fixture?.bytes)||r.fixture.bytes<=0||r.fixture.bytes>1024**2||!hash(r.fixture.editFingerprint))return false;
    const evaluation=evaluateSoakRecovery(r.cycles,r.fixture,r.recoveryPolicy);
    if(evaluation.status!=='passed'||JSON.stringify(evaluation)!==JSON.stringify(r.evaluation))return false;
    const workers=Array.isArray(r.workers)?r.workers:[],models=workers.filter(w=>/\/model-worker\.js(?:\?|$)/.test(w?.url||'')),identities=workers.filter(w=>/\/edit-recovery-worker\.js(?:\?|$)/.test(w?.url||'')),cleanup=r.processCleanup;
    return models.length===22&&identities.length===22&&[...models,...identities].every(w=>w.closed===true)&&cleanup?.allReaped===true&&Array.isArray(cleanup.remaining)&&cleanup.remaining.length===0&&Array.isArray(cleanup.identities)&&cleanup.identities.length>0&&cleanup.identities.every(p=>Number.isSafeInteger(p?.pid)&&p.pid>0&&/^\d+$/.test(p.startTicks));
}

export async function savedDraftRows(read){
    // One synchronous DOM observation: a save/remove refresh can replace every
    // option between protocol calls, so count + nth reads are not a snapshot.
    const options=await read(()=>[...document.querySelectorAll('#edit-recovery-list option')].map(o=>({key:o.value,label:o.textContent})));
    assert.ok(Array.isArray(options)&&options.length<=EDIT_RECOVERY_COUNT);
    const found=options.map(o=>{assert.ok(key(o.key)&&typeof o.label==='string');const revision=Number(o.label.match(/ · v(\d+)$/)?.[1]);assert.ok(Number.isSafeInteger(revision)&&revision>0);return {key:o.key,revision};});
    assert.equal(new Set(found.map(r=>r.key)).size,found.length);return found;
}

export function createSoakRecovery({page,read,directory,fixture}){
    const ledger=new SoakRecoveryLedger(fixture),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let serial=0;
    async function until(fn,timeout=30000){const deadline=Date.now()+timeout;for(;;){const value=await fn();if(value)return value;if(Date.now()>deadline)throw Error('Timed out waiting for the real saved-draft UI.');await wait(100);}}
    const rows=()=>savedDraftRows(read);
    const keys=found=>found.map(r=>r.key);
    async function manager(){
        await page.locator('#open-edit-draft').click();await until(async()=>await page.locator('#edit-recovery-description').textContent()!=='讀取本機編輯草稿…');
        assert.equal(await page.locator('#edit-recovery-dialog').isVisible(),true);return rows();
    }
    async function backup(selected){
        await page.locator('#edit-recovery-list').selectOption(selected);
        const event=page.waitForEvent('download');await page.locator('#download-edit-recovery').click();const download=await event;
        assert.equal(await download.failure(),null);const file=path.join(directory,`soak-recovery-${++serial}.json`);
        try{await download.saveAs(file);assert.ok((await stat(file)).size<=EDIT_DRAFT_LIMIT);return inspectSoakBackup(await readFile(file,'utf8'),fixture);}
        finally{await download.delete();await rm(file,{force:true});}
    }
    async function settledStatus(){return until(async()=>{const status=page.locator('#edit-recovery-status'),message=await status.textContent();return message.startsWith('已保存本機編輯草稿')||await status.getAttribute('data-error')==='true'?message:null;},90000);}
    return {
        async ensureSaved(entry){
            const message=await settledStatus();entry.recoveryStorage={version:1,capacity:null};if(message.startsWith('已保存本機編輯草稿'))return;
            assert.equal(message,SOAK_CAPACITY_MESSAGE,'An unrelated save error must fail the workload without removing drafts.');
            const before=await manager(),beforeKeys=keys(before),selected=ledger.oldest(beforeKeys),verified=await backup(selected);
            ledger.authorizeRemoval(beforeKeys,selected,verified);assert.deepEqual(await rows(),before,'Saved records changed during backup.');
            const removal=page.locator('#edit-recovery-dialog .draft-removal');if(await removal.getAttribute('open')===null)await removal.locator('summary').click();
            await page.locator('#remove-edit-recovery-confirm').check();assert.equal(await page.locator('#edit-recovery-list').inputValue(),selected);
            await page.locator('#remove-edit-recovery').click();const after=await until(async()=>{const r=await rows();return r.length===EDIT_RECOVERY_COUNT-1?r:null;});
            assert.deepEqual(after,[...before].filter(r=>r.key!==selected));ledger.removed(beforeKeys,keys(after),selected,verified);
            await page.locator('#retry-edit-recovery').click();const retry=await settledStatus();assert.match(retry,/^已保存本機編輯草稿/);
            const retried=await until(async()=>{const r=await rows();return r.length===EDIT_RECOVERY_COUNT?r:null;});
            assert.deepEqual(retried.filter(r=>beforeKeys.includes(r.key)),after,'Retry changed a retained draft revision.');
            entry.recoveryStorage.capacity={message,key:selected,backup:verified,beforeKeys,afterRemoveKeys:keys(after),afterRetryKeys:keys(retried),remainingUnchanged:true,retrySaved:true};
            await page.locator('#close-edit-recovery').click();
        },
        async finishCycle(entry){
            const found=await manager(),foundKeys=keys(found),fresh=foundKeys.filter(k=>!ledger.records.has(k));assert.equal(fresh.length,1);
            const verified=await backup(fresh[0]);assert.deepEqual(await rows(),found,'Draft changed while capturing its final backup.');
            const savedKey=ledger.saved(foundKeys,verified);Object.assign(entry.recoveryStorage,{savedKey,backup:verified,retainedKeys:foundKeys});
            await page.locator('#close-edit-recovery').click();
        }
    };
}
