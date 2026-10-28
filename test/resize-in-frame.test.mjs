import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resizeInFrame} from '../src/resize-in-frame.js';
function fixture(){
    const frames=new Map();let next=0,observer,inside=false;
    const win={requestAnimationFrame(fn){frames.set(++next,fn);return next;},cancelAnimationFrame(id){frames.delete(id);},ResizeObserver:class{constructor(fn){this.callback=fn;observer=this;}observe(){}disconnect(){this.disconnected=true;}}};
    const element={ownerDocument:{defaultView:win},height:20};
    return {element,frames,get observer(){return observer;},get inside(){return inside;},notify(){inside=true;try{observer.callback([{target:element}]);}finally{inside=false;}},frame(){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();}};
}
test('header/capture style writes occur outside ResizeObserver delivery and coalesce to the latest geometry',()=>{
    const f=fixture(),heights=[];const stop=resizeInFrame(f.element,()=>{assert.equal(f.inside,false,'Style writes during RO delivery can cause an undelivered-notifications loop.');heights.push(f.element.height);});
    f.notify();f.element.height=30;f.notify();f.element.height=40;f.notify();assert.equal(heights.length,0);assert.equal(f.frames.size,1);f.frame();assert.deepEqual(heights,[40]);stop();
});
test('disconnect cancels pending frames and late observer deliveries cannot touch a disposed view',()=>{
    const f=fixture();let writes=0;const stop=resizeInFrame(f.element,()=>writes++);f.notify();stop();assert.equal(f.observer.disconnected,true);assert.equal(f.frames.size,0);f.frame();f.notify();f.frame();assert.equal(writes,0);
});
