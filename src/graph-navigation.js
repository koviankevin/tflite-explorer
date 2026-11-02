export const GRAPH_NAVIGATION_HELP='W／A／S／D 或方向鍵移圖，Shift 加速，＋／－縮放，Home 顯示全圖';

// Scoped to a graph surface, never the search panel or form controls.
export function navigateGraph(event,{pan,zoom,fit}){
    if(event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]'))return false;
    const key=event.key.length===1?event.key.toLowerCase():event.key;
    const step=event.shiftKey?240:80,delta={ArrowLeft:[-step,0],a:[-step,0],ArrowRight:[step,0],d:[step,0],ArrowUp:[0,-step],w:[0,-step],ArrowDown:[0,step],s:[0,step]}[key];
    if(delta)pan(...delta);
    else if(event.key==='Home')fit();
    else if(event.key==='+'||event.key==='=')zoom(1.4);
    else if(event.key==='-')zoom(1/1.4);
    else return false;
    event.preventDefault();event.stopPropagation();return true;
}
