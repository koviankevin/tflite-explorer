// Worker-safe, bounded estimates. Canvas uses actual font metrics for visible
// labels; full names remain in tooltips and accessible controls.
export function overviewLabel(node){
    const title=String(node.type?.name || node.name || node.identifier),pattern=node.diagramKind==='pattern';
    const count=pattern?(node.attributes?.find(a=>a.name==='匹配 OP')?.value || / · (\d+) OP · 點開$/.exec(node.name || '')?.[1]):null;
    const info=pattern?(count?`${count} OP · 點開`:String(node.name || '點開')):
        [Number.isInteger(node.sourceNode)?`#${node.sourceNode}`:null,Number.isInteger(node.sourceGraph)?`block ${node.sourceGraph}`:null].filter(Boolean).join(' · ') || (node.name!==title?String(node.name || ''):'');
    return {title,info};
}
export function overviewNodeSize(node,font){
    const {title,info}=overviewLabel(node),small=Math.max(12,font*.72);
    const estimate=(text,size)=>{let em=0;for(const ch of text.slice(0,256)){em+=/[^\x00-\xff]/u.test(ch)?1:/[ilI1.,:;'| !]/.test(ch)? .32:/[MW@%]/.test(ch)? .9:.62;}return em*size;};
    return {width:Math.ceil(Math.min(font*18+24,Math.max(150,font*6+24,estimate(title,font)+24,estimate(info,small)+24))),height:Math.ceil(font+small+26)};
}
export function fitOverviewText(ctx,text,width){
    const chars=Array.from(text.slice(0,256).replace(/[\uD800-\uDBFF]$/u,'')),bounded=chars.join('');
    if(text.length<=256&&ctx.measureText(bounded).width<=width)return bounded;
    let low=0,high=chars.length;
    while(low<high){const mid=Math.ceil((low+high)/2);if(ctx.measureText(chars.slice(0,mid).join('')+'…').width<=width)low=mid;else high=mid-1;}
    return chars.slice(0,low).join('')+'…';
}
