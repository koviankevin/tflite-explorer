// Local Windows benchmark fixture hosting only. Caller must authenticate the
// complete artifact first. No HTML edits, foreign request exemptions or AV flags.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from '../../scripts/lib/release-artifact.mjs';
export async function trustedDocument(directory,manifest){
    const release=manifest?.release,entries=manifest?.files?.filter(f=>f.path==='index.html');
    if(release?.distribution!=='public'||release.extension||release.source?.dirty!==false||!entries||entries.length!==1)throw Error('Trusted bootstrap requires an authenticated clean public artifact.');
    const body=await readFile(path.join(directory,'index.html')),entry=entries[0];
    if(body.length!==entry.bytes||sha256(body)!==entry.sha256)throw Error('Bootstrap HTML differs from authenticated manifest.');
    const policies=[...body.toString('utf8').matchAll(/<meta\s+[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"[^>]*>/gi)].map(m=>m[1]);
    if(policies.length!==1||!policies[0].includes("script-src 'self'")||!policies[0].includes("connect-src 'self'"))throw Error('Bootstrap must preserve the original application CSP.');
    const proof={mode:'manifest-pinned-document-fixture',documentSHA256:entry.sha256,bytes:body.length,policy:policies[0],deliveries:0,httpDocumentTransportVerified:false};
    return {proof,async handle(route,base){
        const request=route.request(),url=new URL(request.url()),origin=new URL(base).origin;
        if(request.method()!=='GET'||request.resourceType()!=='document'||url.origin!==origin||!['/','/index.html'].includes(url.pathname)||url.search)return false;
        await route.fulfill({status:200,headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':policies[0],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body});proof.deliveries++;return true;
    }};
}
