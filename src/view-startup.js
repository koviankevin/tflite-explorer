// Netron reports initialization errors through view.error and can still
// resolve start(). Do not treat that resolution as a ready application.
export async function startView(view){
    const report=view.error;let failed=false;
    view.error=()=>{failed=true;};
    try{
        await view.start();
        if(failed)throw Error('網站圖形介面初始化失敗。');
    }finally{view.error=report;}
}
