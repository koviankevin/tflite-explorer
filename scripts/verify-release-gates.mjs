import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {verifyReleaseGates} from './lib/release-gates.mjs';
const args=process.argv.slice(2),directory=args[0]||'dist',output=args[1];
if(args.length>2)throw Error('Usage: node scripts/verify-release-gates.mjs [dist] [new-receipt.json]');
const {preparedDirectory,...receipt}=await verifyReleaseGates({directory});
if(output){await mkdir(path.dirname(path.resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',flush:true});}
console.log(JSON.stringify({status:receipt.status,buildId:receipt.release.buildId,gates:receipt.gates.map(g=>({kind:g.kind,runId:g.runId,reused:g.reused})),receipt:output||null}));
