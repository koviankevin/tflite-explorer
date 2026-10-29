// Task instructions use the same names as the visible controls. No model,
// tensor payload, editor command or execution result is retained by the guide.
export const GUIDE_TOPICS=Object.freeze([
    {id:'explore',label:'開檔與搜尋',heading:'從一個模型開始',steps:[
        ['開啟模型','選本機 .tflite／.lite 或文字 .mlir，也可以先試示範模型。模型與權重留在本機。'],
        ['搜尋並定位','左側 Layers／Tensors（MLIR 為 SSA Values）可找名稱、operator 類型或 #編號，點結果定位；tensor 詳情包含 shape、dtype 與量化資訊。'],
        ['移動與查看','一般檢視可拖曳平移、滾輪縮放。左側欄右邊界可拖曳調寬；圖字可調到 32px。大型模型先顯示局部圖，完整圖可使用 Canvas 總覽。']
    ],actions:['open','demo','mlir-demo','explore']},
    {id:'pattern',label:'Pattern 與切圖',heading:'圈選原本的結構，再找其他匹配',steps:[
        ['先選 OP','在探索圖按「選取 pattern」，拖曳框選多個 OP。再次框到已選 OP 會取消選取；Alt＋拖曳平移、滾輪縮放，選取會保留。'],
        ['保存或調整搜尋結構','「儲存並搜尋」建立 pattern；「編輯選取 pattern」修改搜尋條件。這些操作不修改實際模型。MLIR 可在同一 function／region 跨 block 選取，保留分支、匯合與迴圈。'],
        ['切出局部模型','按「匯出 TFLite 子模型」或「匯出局部 MLIR」，網站補齊必要介面。按「開啟匯出結果」建立新模型分頁，原模型保留。'],
        ['移轉 pattern','Pattern 清單的匯出／匯入使用 JSON；它記錄搜尋結構，不是 TFLite／MLIR 模型，也不包含模型權重。']
    ],actions:['explore','open']},
    {id:'edit',label:'編輯實際模型',heading:'修改 TFLite，先預覽再匯出',steps:[
        ['選範圍並進入編輯','在探索圖選 OP，再按頂端「編輯模型」。需要組合片段時，從匹配結果或圈選操作「加入組合草稿」。實際模型編輯只支援 TFLite。'],
        ['複製、新增與接線','選 OP 後可複製，再從內建 OP 選單換類型。點來源「接出」，再點目標「接入」，也可拖曳端點接線；輸出 tensor 自動建立。'],
        ['補上 const','新增 OP 的「補上亂數權重／常數」提供支援 dtype 的用途預設。可選 Uniform／Normal／Truncated Normal／Bernoulli，進階參數可調 seed、平均值、標準差等。'],
        ['查看變更並匯出','查看右側變更預覽，可復原／重做；「驗證並匯出模型」只做結構及資料驗證，不自動執行。要試跑，先「開啟修改結果」，再到執行模型。'],
        ['接續或重新開始','再次進入會保留目前草稿。要清空目前草稿，使用「重新開始草稿」並確認；不會刪除原模型。']
    ],actions:['edit','explore']},
    {id:'run',label:'執行與 IO',heading:'執行目前模型分頁的 TFLite',steps:[
        ['先開啟要跑的檔案','執行只使用目前分頁已開啟的整份 TFLite，不套用編輯草稿。想跑局部或修改結果，先匯出，再開啟到新模型分頁。'],
        ['前往執行模型','頂端「執行模型」顯示檔名和介面。只切換到此工作區不會跑 interpreter；需再按「設定輸入並執行一次」。'],
        ['指定每個 input','可選 raw .bin、全 0 或亂數規則。BIN 採 little-endian，bytes 必須符合 shape／dtype；亂數有預設，也可展開進階參數。索引／token 等仍需符合模型用途。'],
        ['執行並保存 IO','確認輸入後手動執行。完成可「下載測試 input／output」，ZIP 內含 BIN、規格、分佈／seed 和模型 SHA-256。換模型分頁或關閉會清除 IO，請先下載。'],
        ['查看檢查範圍','公開 CPU WASM 限 128 MiB 模型、16 MiB IO、30 秒。custom kernels、動態 shape 等可能列為未能驗證；單次成功不代表精度或全部分支正確。']
    ],actions:['run','open']},
    {id:'save',label:'保存與恢復',heading:'分清楚模型、pattern 與草稿',steps:[
        ['模型檔','TFLite／MLIR 包含模型結構與保留的參數。匯出結果可在新模型分頁開啟；分頁切換保留搜尋、選取、視角及編輯歷史。'],
        ['Pattern JSON','只保存搜尋結構和條件。從 Pattern 清單匯出、匯入，或用刪除／復原整理；不包含模型權重。'],
        ['編輯草稿 JSON','在編輯區按「儲存編輯草稿」。換電腦或瀏覽器後，從頂端「編輯草稿」匯入，再重新選原模型，通過完整指紋核對後接續。新分佈草稿使用 v3。'],
        ['本機備份與工作階段','瀏覽器本機保存不會跨電腦同步，也可能受儲存回收影響。探索的「儲存工作階段」與編輯草稿用途不同；要長期保留，請下載 JSON 並另外保存原模型。']
    ],actions:['drafts','explore']}
]);
export const GUIDE_ACTIONS=Object.freeze({open:'選擇本機模型',demo:'開啟 TFLite 示範', 'mlir-demo':'開啟 MLIR 示範',explore:'前往探索模型',edit:'前往編輯模型',run:'前往執行模型',drafts:'開啟編輯草稿管理'});
export function guideActionReason(action,{hasModel,format,busy}={}){
    if(!Object.hasOwn(GUIDE_ACTIONS,action))throw Error('操作指南的動作不存在。');
    if(busy)return '目前有操作進行中；請等待完成或關閉說明後取消，再前往其他操作。';
    if(['open','demo','mlir-demo','drafts'].includes(action))return '';
    if(!hasModel)return '請先開啟本機模型或示範模型。';
    if(['edit','run'].includes(action)&&format!=='tflite')return '此操作僅支援 TFLite；MLIR 可探索、搜尋、圈選 pattern 與局部匯出。';
    return '';
}
export function guideTopicFor({mode}={}){return mode==='edit'?'edit':mode==='run'?'run':'explore';}
export function guideTabIndex(key,index,count){
    if(!Number.isInteger(index)||index<0||index>=count||!Number.isInteger(count)||count<=0)return null;
    return key==='ArrowRight'?(index+1)%count:key==='ArrowLeft'?(index+count-1)%count:key==='Home'?0:key==='End'?count-1:null;
}
