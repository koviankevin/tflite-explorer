import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Playwright 1.56.1 reads file input.multiple in the chooser handle's world.
// Chromium supplies an isolated handle; Firefox/WebKit supply a main-world
// handle, so Netron's disabled eval silently drops the chooser notification.
// Adopt the actual native handle into the utility world before that DOM read.
// This changes only the Node test driver, never eval/CSP/handlers in the app.
export function isolateChooserObservation(Page,version){
    const original=Page.prototype._onFileChooserOpened;
    const digest=createHash('sha256').update(original.toString()).digest('hex');
    if(version!=='1.56.1'||digest!=='43f26a718e33a0ab23f5b459249221ae00955ab78373a5ab1c93cf5df844ae42')throw Error('Review the desktop chooser adapter for the new pinned Playwright implementation.');
    Page.prototype._onFileChooserOpened=async function(handle){
        const context=await handle._context.frame._utilityContext();
        return original.call(this,await handle._adoptTo(context));
    };
    return {evidence:{playwright:version,originalSHA256:digest,readWorld:'utility',nativeHandle:true},restore:()=>{Page.prototype._onFileChooserOpened=original;}};
}
export async function installDesktopChooserReader(){
    const [{Page},pkg]=await Promise.all([import('../../node_modules/playwright-core/lib/server/page.js'),readFile(new URL('../../node_modules/playwright-core/package.json',import.meta.url),'utf8')]);
    return isolateChooserObservation(Page,JSON.parse(pkg).version);
}
