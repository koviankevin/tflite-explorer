// Iterative SCC/rank construction and three bounded pairs of connection-order
// sweeps run in the model Worker. No dummy node is allocated per skipped rank:
// long edges and cycles use a fixed number of side lanes instead.
export function overviewLayout(nodes,links,{font=18,direction='vertical'}={}) {
    const byId=new Map(nodes.map((n,i)=>[n.identifier,i])),next=nodes.map(()=>[]),previous=nodes.map(()=>[]);
    for(const e of links){const a=byId.get(e.from),b=byId.get(e.to);if(a===undefined || b===undefined)throw new Error('總覽連線的端點不存在。');next[a].push(b);previous[b].push(a);}
    const seen=new Uint8Array(nodes.length),order=[];
    for(let root=0;root<nodes.length;root++)if(!seen[root]) {
        const stack=[[root,0]];seen[root]=1;
        while(stack.length){const top=stack.at(-1),children=next[top[0]];if(top[1]<children.length){const n=children[top[1]++];if(!seen[n]){seen[n]=1;stack.push([n,0]);}}else{order.push(top[0]);stack.pop();}}
    }
    const component=new Int32Array(nodes.length).fill(-1),parts=[];
    for(let i=order.length-1;i>=0;i--){const root=order[i];if(component[root]>=0)continue;const id=parts.length,part=[],stack=[root];component[root]=id;
        while(stack.length){const n=stack.pop();part.push(n);for(const p of previous[n])if(component[p]<0){component[p]=id;stack.push(p);}}parts.push(part);
    }
    const successors=parts.map(()=>new Set()),parents=parts.map(()=>new Set()),degree=new Int32Array(parts.length),rank=new Int32Array(parts.length);
    for(let a=0;a<next.length;a++)for(const b of next[a])if(component[a]!==component[b] && !successors[component[a]].has(component[b])){successors[component[a]].add(component[b]);parents[component[b]].add(component[a]);degree[component[b]]++;}
    const queue=[];for(let i=0;i<parts.length;i++)if(!degree[i])queue.push(i);
    for(let q=0;q<queue.length;q++)for(const b of successors[queue[q]]){rank[b]=Math.max(rank[b],rank[queue[q]]+1);if(!--degree[b])queue.push(b);}
    // An independent source may be a weight/constant used much later. Place it
    // just before its earliest consumer instead of widening the first rank.
    for(let c=0;c<parts.length;c++)if(!parents[c].size&&successors[c].size){let first=Infinity;for(const s of successors[c])first=Math.min(first,rank[s]);rank[c]=Math.max(rank[c],first-1);}
    const vertical=direction!=='horizontal',w=Math.max(220,font*28+32),h=font*2+36,gap=72,laneGap=24,laneCount=8,scopes=new Map();
    const sizes=parts.map(part=>{part.sort((a,b)=>a-b);const cols=Math.ceil(Math.sqrt(part.length)),rows=Math.ceil(part.length/cols),cw=cols*w+(cols-1)*32,ch=rows*h+(rows-1)*32;return {cols,cross:vertical?cw:ch,main:vertical?ch:cw,key:part[0]};});
    const scopeOf=parts.map(part=>nodes[part[0]].group?.split('/')[0] || '模型'),sideScopes=new Set();
    for(let i=0;i<parts.length;i++){const scope=scopeOf[i];if(!scopes.has(scope))scopes.set(scope,[]);scopes.get(scope).push(i);}
    const sideRoute=e=>{const a=component[byId.get(e.from)],b=component[byId.get(e.to)];return scopeOf[a]===scopeOf[b]&&(a===b||rank[b]-rank[a]!==1);};
    for(const e of links)if(sideRoute(e))sideScopes.add(scopeOf[component[byId.get(e.from)]]);
    const placed=new Array(nodes.length),groups=[],scopeBounds=new Map(),centers=new Float64Array(parts.length);let crossOffset=40,maxMain=0;
    for(const [name,components] of scopes){const levels=new Map();for(const c of components){if(!levels.has(rank[c]))levels.set(rank[c],[]);levels.get(rank[c]).push(c);}
        const ordered=[...levels.keys()].sort((a,b)=>a-b).map(r=>levels.get(r));
        for(const level of ordered){level.sort((a,b)=>sizes[a].key-sizes[b].key);let width=-40;for(const c of level)width+=sizes[c].cross+40;let offset=-width/2;for(const c of level){centers[c]=offset+sizes[c].cross/2;offset+=sizes[c].cross+40;}}
        const sweep=(level,neighbors,forward)=>{
            const targets=new Map();for(const c of level){let sum=0,count=0,coreSum=0,coreCount=0;for(const n of neighbors[c])if(scopeOf[n]===name){sum+=centers[n];count++;if(parents[n].size){coreSum+=centers[n];coreCount++;}}
                targets.set(c,forward&&coreCount?coreSum/coreCount:count?sum/count:centers[c]);}
            level.sort((a,b)=>targets.get(a)-targets.get(b)||sizes[a].key-sizes[b].key);
            compactRank(level,targets,sizes,centers,parents);
        };
        for(let pass=0;pass<3;pass++){for(const level of ordered)sweep(level,parents,true);for(let i=ordered.length-1;i>=0;i--)sweep(ordered[i],successors,false);}
        let minCross=Infinity,maxCross=-Infinity;for(const c of components){minCross=Math.min(minCross,centers[c]-sizes[c].cross/2);maxCross=Math.max(maxCross,centers[c]+sizes[c].cross/2);}
        const margin=sideScopes.has(name)?laneGap*(laneCount+1):0,origin=crossOffset+margin-minCross;let mainOffset=60;
        scopeBounds.set(name,{min:crossOffset+margin,max:crossOffset+margin+maxCross-minCross});
        for(const level of ordered){let mainSize=0;for(const c of level){const size=sizes[c],cross=origin+centers[c]-size.cross/2;mainSize=Math.max(mainSize,size.main);
                parts[c].forEach((n,i)=>{const x=(vertical?cross:mainOffset)+(i%size.cols)*(w+32),y=(vertical?mainOffset:cross)+Math.floor(i/size.cols)*(h+32);placed[n]={...nodes[n],x,y,width:w,height:h,minX:x,minY:y,maxX:x+w,maxY:y+h};});}
            mainOffset+=mainSize+gap;
        }
        const span=maxCross-minCross+2*margin,box=vertical?{x:crossOffset-20,y:20,width:span+40,height:mainOffset}:{x:20,y:crossOffset-20,width:mainOffset,height:span+40};groups.push({name,...box});crossOffset+=span+80;maxMain=Math.max(maxMain,mainOffset+40);
    }
    const point=(main,cross)=>vertical?{x:cross,y:main}:{x:main,y:cross};
    const edges=links.map((e,i)=>{const ai=byId.get(e.from),bi=byId.get(e.to),a=placed[ai],b=placed[bi],am=vertical?a.y:a.x,bm=vertical?b.y:b.x,as=vertical?a.height:a.width,bs=vertical?b.height:b.width,ac=vertical?a.x+a.width/2:a.y+a.height/2,bc=vertical?b.x+b.width/2:b.y+b.height/2;
        let points,route;
        if(sideRoute(e)){const bounds=scopeBounds.get(scopeOf[component[ai]]),sign=(ac+bc)/2<=(bounds.min+bounds.max)/2?-1:1,lane=(sign<0?bounds.min:bounds.max)+sign*laneGap*(1+i%laneCount);route='side';
            if(bm>am){const start=am+as,end=bm;points=[point(start,ac),point(start+gap/3,ac),point(start+gap/3,lane),point(end-gap/3,lane),point(end-gap/3,bc),point(end,bc)];}
            else {const start=am+as*(ai===bi?0.3:0.5),end=bm+bs*(ai===bi?0.7:0.5),ax=ac+sign*(vertical?a.width:a.height)/2,bx=bc+sign*(vertical?b.width:b.height)/2;points=[point(start,ax),point(start,lane),point(end,lane),point(end,bx)];}
        }else{const start=am+as,end=bm,bend=(start+end)/2;points=[point(start,ac),point(bend,ac),point(bend,bc),point(end,bc)];}
        return {...e,...(route?{route}:{}),points,minX:Math.min(...points.map(p=>p.x))-8,minY:Math.min(...points.map(p=>p.y))-8,maxX:Math.max(...points.map(p=>p.x))+8,maxY:Math.max(...points.map(p=>p.y))+8};
    });
    return {nodes:placed,edges,groups,font,direction,width:vertical?crossOffset:maxMain,height:vertical?maxMain:crossOffset};
}

// Pool-adjacent-violators compaction fits neighbor centers without overlaps in
// O(rank size). Source-only inputs yield to the continuing flow; only ranks
// containing sources alone use their average as the alignment anchor.
function compactRank(level,targets,sizes,centers,parents){
    const blocks=[];let distance=0;const offsets=[];
    for(let i=0;i<level.length;i++){const c=level[i];if(i)distance+=(sizes[level[i-1]].cross+sizes[c].cross)/2+40;offsets.push(distance);const value=targets.get(c)-distance,anchor=parents[c].size?1:0;
        blocks.push({start:i,end:i,sum:value,count:1,anchorSum:value*anchor,anchors:anchor,mean:value});
        while(blocks.length>1&&blocks.at(-2).mean>blocks.at(-1).mean){const b=blocks.pop(),a=blocks.at(-1);a.end=b.end;a.sum+=b.sum;a.count+=b.count;a.anchorSum+=b.anchorSum;a.anchors+=b.anchors;a.mean=a.anchors?a.anchorSum/a.anchors:a.sum/a.count;}
    }
    for(const b of blocks)for(let i=b.start;i<=b.end;i++)centers[level[i]]=b.mean+offsets[i];
}

const intersects=(a,b)=>a.minX<=b.maxX && a.maxX>=b.minX && a.minY<=b.maxY && a.maxY>=b.minY;
export function spatialIndex(items) {
    const build=list=>{if(!list.length)return null;const box={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};for(const n of list){box.minX=Math.min(box.minX,n.minX);box.minY=Math.min(box.minY,n.minY);box.maxX=Math.max(box.maxX,n.maxX);box.maxY=Math.max(box.maxY,n.maxY);}
        if(list.length<=16)return {...box,items:list};const axis=box.maxX-box.minX>box.maxY-box.minY?'X':'Y';list.sort((a,b)=>(a['min'+axis]+a['max'+axis])-(b['min'+axis]+b['max'+axis]));const middle=list.length>>>1;return {...box,left:build(list.slice(0,middle)),right:build(list.slice(middle))};};
    const root=build(items.slice());
    return {query(box){const found=[],stack=root?[root]:[];while(stack.length){const n=stack.pop();if(!intersects(n,box))continue;if(n.items){for(const item of n.items)if(intersects(item,box))found.push(item);}else stack.push(n.left,n.right);}return found;}};
}

export class OverviewCamera {
    constructor(width,height){this.width=width;this.height=height;this.zoom=1;this.x=0;this.y=0;}
    world(x,y){return{x:(x-this.x)/this.zoom,y:(y-this.y)/this.zoom};}
    zoomAt(factor,x=this.width/2,y=this.height/2){const p=this.world(x,y);this.zoom=Math.max(0.00001,Math.min(3,this.zoom*factor));this.x=x-p.x*this.zoom;this.y=y-p.y*this.zoom;}
    pan(x,y){this.x+=x;this.y+=y;}
    fit(bounds){this.zoom=Math.max(.00001,Math.min(1,Math.max(1,this.width-32)/Math.max(1,bounds.width),Math.max(1,this.height-32)/Math.max(1,bounds.height)));this.x=(this.width-bounds.width*this.zoom)/2;this.y=(this.height-bounds.height*this.zoom)/2;}
    focus(nodes,zoom){if(!nodes.length)return;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const n of nodes){minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+n.width);maxY=Math.max(maxY,n.y+n.height);}const fit=Math.max(.00001,Math.min(1,Math.max(1,this.width-60)/(maxX-minX),Math.max(1,this.height-60)/(maxY-minY)));this.zoom=Math.min(zoom ?? fit,fit);this.x=this.width/2-(minX+maxX)/2*this.zoom;this.y=this.height/2-(minY+maxY)/2*this.zoom;}
    bounds(padding=0){const a=this.world(-padding,-padding),b=this.world(this.width+padding,this.height+padding);return{minX:a.x,minY:a.y,maxX:b.x,maxY:b.y};}
}
