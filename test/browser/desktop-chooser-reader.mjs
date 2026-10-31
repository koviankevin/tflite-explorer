import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// Playwright 1.64.1 reads file input.multiple in the chooser handle's world.
// Chromium supplies an isolated handle; Firefox/WebKit supply a main-world
// handle, so Netron's disabled eval silently drops the chooser notification.
// Adopt the actual native handle into the utility world before that DOM read.
// This changes only the Node test driver, never eval/CSP/handlers in the app.
export function isolateChooserObservation(Page,version){
    const original=Page.prototype._onFileChooserOpened;
    const digest=createHash('sha256').update(original.toString()).digest('hex');
    if(version!=='1.64.1'||digest!=='fb07c888f6df8e4bc20eed88354b17e9a212c8c3eabb427a3be16844eb10d26e')throw Error('Review the desktop chooser adapter for the new pinned Playwright implementation.');
    Page.prototype._onFileChooserOpened=async function(handle){
        const context=await handle._context.frame.utilityContext();
        return original.call(this,await handle._adoptTo(context));
    };
    return {evidence:{playwright:version,originalSHA256:digest,readWorld:'utility',nativeHandle:true},restore:()=>{Page.prototype._onFileChooserOpened=original;}};
}
export async function installDesktopChooserReader(){
    const [{server:{Page}},pkg]=await Promise.all([import('playwright-core/lib/coreBundle'),readFile(new URL('../../node_modules/playwright-core/package.json',import.meta.url),'utf8')]);
    return isolateChooserObservation(Page,JSON.parse(pkg).version);
}
