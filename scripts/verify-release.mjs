import {verifyArtifact} from './lib/release-artifact.mjs';
const manifest=await verifyArtifact(process.argv[2] || 'dist');
console.log(JSON.stringify({verified:true,release:manifest.release,files:manifest.files.length}));
