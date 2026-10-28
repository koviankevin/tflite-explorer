// Layout-driven writes share one frame boundary per observed element.
export function resizeInFrame(element,update){
    const win=element.ownerDocument.defaultView;
    let frame=null,disposed=false;
    const observer=new win.ResizeObserver(()=>{
        if(disposed||frame!==null)return;
        frame=win.requestAnimationFrame(()=>{frame=null;if(!disposed)update();});
    });observer.observe(element);
    return ()=>{disposed=true;observer.disconnect();if(frame!==null)win.cancelAnimationFrame(frame);frame=null;};
}
