# Firefox 指紋 Worker 關閉狀態診斷

preview.31 來源 `3f26db6283ea13edc943ca93fa2947c9e8719dc0` 的四個 main 關卡與 Chromium 原生／八輪 IO 已獨立核對；正式站仍為 preview.30，尚未準備或發布新版。桌面工作流程 `40885964513` 兩個 jobs 都回報成功，但獨立資源核對在 Firefox 發現 27 個 edit-recovery Workers 中只有 26 個 close 事件，第 95 筆觀察缺少 close。63 model／20 runtime Workers 與十四組輸入清理皆通過。這是尚待釐清的資源證據，不能直接稱為洩漏或框架問題，也不能把 job 綠燈當成完整資源驗收。

同一工作流程的 WebKit 有四個指紋 Worker，四個 close 都已觀察；其十七項功能、完整 candidate manifest、原生 CPU／IO、十四組清理與既有資源界線已完成獨立核對。沿用 WebKit，不重跑成功引擎。兩引擎最後頁面 Netron layout Worker 的 close 未觀察，仍維持既有的明確界線；不擴大該例外來容納 Firefox 指紋 Worker。

診斷依序區分三個可反駁的情況：

1. Native context 已消失，但 close 通知未傳到觀察端：預期每個 constructor 都有原生 terminate 回傳，且頁面仍開啟時，舊 Worker context 的唯讀存活探測會拒絕。
2. 網站沒有對某個 Worker 呼叫 terminate：預期 constructor 記錄沒有對應的 terminate，且 native Worker list／context 仍存在。
3. 呼叫 terminate 後 native context 仍可執行：預期 terminate 已回傳，但原生 context 仍能回傳常數；仍需進一步釐清 engine／生命週期，不能當成已釋放。

僅在 Hosted Firefox candidate 加入測試端觀察。建構與 terminate 仍交給原生實作；記錄時間、次數、script/build、是否收到指紋回覆，絕不保存 File／Blob、message payload 或指紋值。額外 message/error 觀察 listener 在原生 terminate 前移除。按既有流程階段記錄 page.workers 與 DOM 上的數字紀錄；對至少五秒仍未收到 close 的指紋 Worker，最多四次、每次 1.5 秒上限地要求 native context 回傳常數 `1`。不讀模型、不呼叫 app API、不終止或關閉 Worker 來製造成功，也不把探測拒絕／timeout 改寫為 close 事件。

這是診斷：包裝與觀察可能擾動排程。所有原有功能、model／runtime close 與已知 layout 界線維持；新資料用於判斷下一步，尚不是 Firefox 資源驗收通過的聲明。五項相關 Node 檢查已驗證原生參數／回傳、觀察 listener 解除、payload 排除、唯讀 native probe 與不偽造 closed 狀態。應用 src／vendor／建置／workflow 未修改；四個發布關卡是否可沿用仍按真正 dependency fingerprint 核對，contract 因涵蓋測試源碼須重新取得 main 證據。

[原始 provider ZIP 與獨立收據](results/firefox-worker31-original.zip)及[來源／SHA／讀取器狀態清單](results/firefox-worker31-original.json)保留，原 Firefox strict reader 失敗與後續 authentication-only 稽核分開記錄。

## 啟動取消的最小對照

來源 `7e094d26ebbe627f61e70840ba9bdb26bff0ee94` 的 [Firefox 診斷 40893435879](https://github.com/koviankevin/tflite-explorer/actions/runs/40893435879) 已終止。獨立讀取器實際 exit 0，核對原始 provider ZIP digest／CRC、來源、304 檔 manifest、十四組輸入清理與真正 CPU 取消／逾時；資源驗收仍為 **unverified**。27 個建構均有原生 terminate 回傳，但 15 個 identity close 未觀察；對照建立時間，這 15 個皆在 0～1ms 內終止且沒有回覆。四次常數探測皆逾時，不能由此推論 context 已關閉或仍活著。監聽加入後缺少事件由一個增加為十五個，須考慮觀察對時序的影響。[原始資料封存](results/firefox-worker31-diagnostic.zip)及[雜湊與明確界線](results/firefox-worker31-diagnostic.json)保留。

下一個測試只在 Hosted Firefox 的獨立空白 context，以固定按鈕建立無資料的 classic／module Blob Worker，各比較八次立即 terminate 與收到原生 ready 訊息後 terminate。新 context 沒有 identity constructor wrapper；沿用原生 Worker，不用 app API、模型資料、forced GC 或新例外。分別保存建構、ready、terminate、實際 close、頁面關閉前後和最多四次有上限的常數探測。未知 close 保持未知；所有 URL 在 terminate 後撤銷。七項本機 Node 檢查通過，只驗證合成文件腳本及既有觀察工具，未在本機啟動瀏覽器。這個對照的執行結果尚待取得。

## 取消前不啟動無用工作

上述對照已由來源 `5a4845057cc7511215956f4a93c2ffc31a4812e0` 的 [Hosted Firefox 40897677111](https://github.com/koviankevin/tflite-explorer/actions/runs/40897677111) 執行。原始 SHA／CRC／來源／304 檔 manifest 獨立核對通過，讀取器實際 exit 0；四組各八個 Blob Worker 的 32 個 native close 全部觀察到，而應用的 27 個 identity Workers 仍缺十五個 close。這反駁「任何立即取消都會缺事件」的概括，尚不能歸因 Firefox、匯入模組或監聽包裝。[原始對照與單元紅綠 log](results/firefox-worker31-control.zip)、[雜湊及明確結果](results/firefox-worker31-control.json)保留，資源狀態仍 unverified。

另在真正 `editRecoverySession.detach()` → capture → `fingerprint.cancel()` 呼叫鏈重現獨立的浪費：已取消的同一輪工作仍會建立一個 Worker。三個新測試先失敗，亦確認 constructor 同步例外及 terminate 前保留 File-capturing callbacks。修正將建構排入 microtask；只在 task 仍有效時建立 Worker，同一輪取消／替換不建立它。對已啟動的工作，成功、錯誤和取消都先清除 onmessage／onerror 與 task 的 Worker 參照，再呼叫原生 terminate；建構錯誤透過原 promise 拒絕，可再次重試。

21 項相關 Node 測試通過，涵蓋真正 detach 呼叫鏈、相同 File 共用／快取、排隊來源替換、已啟動的取消與晚到訊息、建構／post／native error、pagehide 在啟動前後取消與 pageshow 恢復、交易保存／衝突與讀取預算。延後的是建構一個 microtask，沒有額外延遲 timer、等待 ready、GC、CSP 或 close 例外。這先修正已證實的無用工作與回呼所有權；能否消除 Hosted Firefox 的缺失 close，仍須新來源的原生證據，不以單元成功推定。
