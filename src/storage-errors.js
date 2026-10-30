// DOMException.message may be empty (notably Chromium quota aborts).
export function storageErrorMessage(error){
    const known={QuotaExceededError:'瀏覽器儲存配額不足；請先下載備份並整理本機草稿，再重試',SecurityError:'瀏覽器拒絕本機儲存權限；目前操作仍保留，可下載備份後檢查網站權限',InvalidStateError:'本機資料庫連線已關閉；請保留目前操作並重試',AbortError:'儲存交易已中止，尚未完成保存；請重試或下載備份'};
    return known[error?.name]||String(error?.message||error?.name||'本機儲存失敗，請下載備份並重試').slice(0,512);
}
