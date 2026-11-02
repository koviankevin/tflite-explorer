export const GRAPH_NAVIGATION_HELP='W／A／S／D 或方向鍵移圖，Shift 加速，Q 縮小／E 放大（也可用＋／－），Home 顯示全圖';

const physical={KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d',KeyQ:'q',KeyE:'e'};
const panKey=event=>physical[event.code] || (event.key || '').toLowerCase();
export const isGraphPanKey=event=>['w','a','s','d'].includes(panKey(event));
export const isGraphNavigationKey=event=>isGraphPanKey(event)||['q','e','+','=','-'].includes(panKey(event));

// Text controls always retain native editing, including IME composition. A
// focused graph can use physical WASD even when the IME reports key=Process.
export function navigateGraph(event,{pan,zoom,fit}){
    if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]')||event.isComposing&&!physical[event.code])return false;
    const key=isGraphNavigationKey(event)?panKey(event):event.key;
    const step=event.shiftKey?240:80,delta={ArrowLeft:[-step,0],a:[-step,0],ArrowRight:[step,0],d:[step,0],ArrowUp:[0,-step],w:[0,-step],ArrowDown:[0,step],s:[0,step]}[key];
    if(delta)pan(...delta);
    else if(event.key==='Home')fit();
    else if(['+','=','e'].includes(key))zoom(1.4);
    else if(['-','q'].includes(key))zoom(1/1.4);
    else return false;
    event.preventDefault();event.stopPropagation();return true;
}
