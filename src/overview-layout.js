// A linear topology pass plus component/layer ordering, performed in the model
// Worker. Cycles are condensed iteratively: a long chain cannot overflow JS's
// call stack. This overview prioritizes bounded work over Dagre edge routing.
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
    const successors=parts.map(()=>new Set()),degree=new Int32Array(parts.length),rank=new Int32Array(parts.length);
    for(let a=0;a<next.length;a++)for(const b of next[a])if(component[a]!==component[b] && !successors[component[a]].has(component[b])){successors[component[a]].add(component[b]);degree[component[b]]++;}
    const queue=[];for(let i=0;i<parts.length;i++)if(!degree[i])queue.push(i);
    for(let q=0;q<queue.length;q++)for(const b of successors[queue[q]]){rank[b]=Math.max(rank[b],rank[queue[q]]+1);if(!--degree[b])queue.push(b);}
    const vertical=direction!=='horizontal',w=Math.max(220,font*28+32),h=font*2+36,gap=72,scopes=new Map();
    for(let i=0;i<parts.length;i++){const scope=nodes[parts[i][0]].group?.split('/')[0] || '模型';if(!scopes.has(scope))scopes.set(scope,[]);scopes.get(scope).push(i);}
    const placed=new Array(nodes.length),groups=[];let crossOffset=40,maxMain=0;
    for(const [name,components] of scopes){const levels=new Map();for(const c of components){if(!levels.has(rank[c]))levels.set(rank[c],[]);levels.get(rank[c]).push(c);}
        let mainOffset=60,maxCross=0;
        for(const level of [...levels.keys()].sort((a,b)=>a-b)){let cross=0,mainSize=0;
            for(const c of levels.get(level)){const part=parts[c].slice().sort((a,b)=>a-b),cols=Math.ceil(Math.sqrt(part.length)),rows=Math.ceil(part.length/cols);
                const cw=cols*(w+32),ch=rows*(h+32);
                part.forEach((n,i)=>{const x=(vertical?crossOffset+cross:mainOffset)+(i%cols)*(w+32),y=(vertical?mainOffset:crossOffset+cross)+Math.floor(i/cols)*(h+32);placed[n]={...nodes[n],x,y,width:w,height:h,minX:x,minY:y,maxX:x+w,maxY:y+h};});
                cross+=(vertical?cw:ch)+40;mainSize=Math.max(mainSize,vertical?ch:cw);
            }
            maxCross=Math.max(maxCross,cross);mainOffset+=mainSize+gap;
        }
        const box=vertical?{x:crossOffset-20,y:20,width:maxCross,height:mainOffset}:{x:20,y:crossOffset-20,width:mainOffset,height:maxCross};groups.push({name,...box});crossOffset+=maxCross+80;maxMain=Math.max(maxMain,mainOffset+40);
    }
    const edges=links.map(e=>{const a=placed[byId.get(e.from)],b=placed[byId.get(e.to)],forward=vertical?b.y>a.y:b.x>a.x;
        let points;
        if(vertical){const x=a.x+a.width/2,y=a.y+(forward?a.height:0),tx=b.x+b.width/2,ty=b.y+(forward?0:b.height),bend=forward?(y+ty)/2:Math.min(y,ty)-60;
            points=[{x,y},{x:forward?x:x+a.width/2+60,y:bend},{x:forward?tx:tx+b.width/2+60,y:bend},{x:tx,y:ty}];
        }else{const x=a.x+(forward?a.width:0),y=a.y+a.height/2,tx=b.x+(forward?0:b.width),ty=b.y+b.height/2,bend=forward?(x+tx)/2:Math.min(x,tx)-60;
            points=[{x,y},{x:bend,y:forward?y:y+a.height/2+60},{x:bend,y:forward?ty:ty+b.height/2+60},{x:tx,y:ty}];}
        return {...e,points,minX:Math.min(...points.map(p=>p.x))-8,minY:Math.min(...points.map(p=>p.y))-8,maxX:Math.max(...points.map(p=>p.x))+8,maxY:Math.max(...points.map(p=>p.y))+8};
    });
    return {nodes:placed,edges,groups,font,direction,width:vertical?crossOffset:maxMain,height:vertical?maxMain:crossOffset};
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
