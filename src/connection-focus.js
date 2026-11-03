// Build once per displayed graph. Focusing only visits incident edges, including
// loop backedges and parallel/control edges; it never walks transitive paths.
export function connectionIndex(edges) {
    const incident=new Map();
    const add=(id,edge,kind)=>{id=String(id);if(!incident.has(id))incident.set(id,[]);incident.get(id).push([edge,kind]);};
    for(const edge of edges){add(edge.from,edge,2);add(edge.to,edge,1);}
    return {focus(ids){const focused=new Map();for(const id of new Set(ids))for(const [edge,kind] of incident.get(String(id))||[])focused.set(edge,(focused.get(edge)||0)|kind);return focused;}};
}
export const connectionColors={1:'#1767a3',2:'#b34d0a',3:'#7651a8'};

export function svgConnectionFocus(canvas,graph) {
    const edges=[...graph.edges.values()].filter(e=>e.label?.element).map(e=>({from:e.v,to:e.w,native:e.label})),index=connectionIndex(edges),markers=[];
    const arrow=canvas.querySelector('#arrowhead');
    if(arrow)for(const [kind,name] of [[1,'input'],[2,'output'],[3,'both']]){const marker=arrow.cloneNode(true);marker.id=`connection-arrow-${name}`;for(const child of marker.querySelectorAll('*')){child.removeAttribute('id');child.style.fill=connectionColors[kind];child.style.stroke=connectionColors[kind];}arrow.parentNode.append(marker);markers.push(marker);}
    let focused=new Map(),selected=[],enabled=true,halos=[];
    const clear=()=>{for(const edge of focused.keys())for(const node of [edge.native.element,edge.native.labelElement]){node?.classList.remove('connection-input','connection-output','connection-both');}for(const halo of halos)halo.remove();halos=[];focused.clear();canvas.classList.remove('connections-focused');canvas.dataset.focusedEdges='0';};
    const render=()=>{
        clear();if(!enabled||!selected.length)return;
        focused=index.focus(selected);canvas.classList.toggle('connections-focused',focused.size>0);canvas.dataset.focusedEdges=String(focused.size);
        for(const [edge,kind] of focused){
            const native=edge.native,path=native.element,cls=kind===1?'connection-input':kind===2?'connection-output':'connection-both';
            path.classList.add(cls);native.labelElement?.classList.add(cls);
            const halo=path.cloneNode(false);halo.removeAttribute('id');halo.removeAttribute('marker-end');halo.setAttribute('class','connection-halo');halo.setAttribute('aria-hidden','true');path.parentNode.append(halo,path);halos.push(halo);
        }
    };
    return {select(nodes){selected=nodes.map(node=>graph._table.get(node)?.name).filter(id=>id!==undefined);render();},setEnabled(value){enabled=value;render();},dispose(){clear();for(const marker of markers)marker.remove();}};
}
