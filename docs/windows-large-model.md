# Windows 大模型程序記憶體驗收

目前是驗收工具開發階段，尚無本階段 Windows 1.25 GiB 八輪通過結論；正式站仍為 v1.1.0。小型公開／合成模型的 Chrome／Edge 功能成功、Linux 大檔結果及本機空頁量測各有範圍，不互相替代。

## 原生觀察與所有權

`test/browser/windows-process-memory.py` 使用 Windows Toolhelp32 取得 PID／parent 清單，僅在確認本次隔離瀏覽器的所有權後讀取記憶體。根 PID 來自剛啟動的瀏覽器自己的 CDP `SystemInfo.getProcessInfo`；原生 helper 要求它是呼叫 Node 的直接子程序，且名稱為選定的 chrome.exe／msedge.exe。每個程序以 PID 加 GetProcessTimes 的 creation FILETIME 識別；只由目前仍存活、身分相符的父程序擴展子程序，已觀察的子程序仍單獨追蹤。重用 PID 不會當成舊身分，讀取 memory 前在同一 handle 再核對 creation time。

主判定使用整個已觀察到的瀏覽器程序樹 WorkingSetSize 總和，可能重複計算共享頁；另保留 PrivateUsage（private commit），不以它扣除或替換常駐記憶體。資料來源與欄位定義見 Microsoft 的 [PROCESSENTRY32W](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/ns-tlhelp32-processentry32w)、[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)及 [PROCESS_MEMORY_COUNTERS_EX](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex)。不讀個人 profile、程序環境、command line 或記憶體內容；helper 沒有終止程序或修剪 working set 的操作。

為避免 snapshot 與 OpenProcess 之間的 PID 重用，另在同一 handle 以動態連結的 [NtQueryInformationProcess / ProcessBasicInformation](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess) 核對真實 parent／PID，再檢查 creation time，最後才讀 counters；不解參考 PEB。這是僅供 Windows 驗收的 native API，未來 OS 可能變更；API 不可用或欄位長度不符直接使量測失敗，不降級為未證明的程序所有權。

原生前置測試已在 Chrome 156.0.8078.76／Edge 156.0.4314.50 的隔離空合成頁取得 counters，各追蹤 8／9 個身分，正常 close 後全部原生退出，helper 亦 exit 0。4 KiB 合成暫存檔的 [GetCompressedFileSizeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getcompressedfilesizew) 觀察得到 4096 bytes，核對後只刪除該檔與空目錄。這不是大模型、Worker heap 或八輪記憶體的通過證據。

## 八輪流程

既有 `model-lifecycle.mjs` 的 Windows 入口僅能明確授權啟動已安裝 Chrome／Edge，禁止 Windows soak。沿用 v3 的實體合成 1.25 GiB、21,005 OP、全權重非零寫入／fsync／完整 SHA-256 readback、實際選檔、pattern 正負例、整份編輯、組合草稿與匯出／重開流程。Windows 另以 GetCompressedFileSizeW 核對實體儲存量；只接受該次新建 OS 暫存目錄中的固定合成 fixture，拒絕 symlink／reparse root。原檔與尚留的小型檔案保留供後續核對，逐輪已核對並關閉的生成下載仍按精確檔名移除。

原 8 輪、2 輪 warmup、500ms 取樣、RSS／heap／讀取量門檻、22 分鐘 watchdog、80 秒 URL 釋放觀察上限、應用 60 秒 URL 壽命均不變。Worker `Runtime.getHeapUsage` 仍在既有檢查點量測 isolate used／backing storage，不稱為獨立 OS RSS 或連續峰值。有限輪數與 500ms 取樣不能證明永不洩漏，也可能漏掉短暫尖峰及從未觀察的程序。

先提交乾淨來源，再用獨立且尚不存在的報告檔，每個 channel 分開執行：

```powershell
$env:LIFECYCLE_MODE = 'gate'
$env:MODEL_LENS_BROWSER_CHANNEL = 'chrome' # 另一輪為 msedge
$env:MODEL_LENS_QA_PYTHON = 'C:\path\to\python.exe'
$env:LIFECYCLE_REPORT = 'build/qa/windows-large/chrome-1.json'
node test/browser/model-lifecycle.mjs --allow-local-browser
```

必要本機驗收範圍為 Chrome／Edge、1280×640／32px，不啟動手機、Firefox／WebKit、公司模型或兩小時測試。沒有放寬既有門檻、成功部署重跑或 workflow 改動。待取得原生大檔報告後再補充來源、實際退出碼、原始 counters、判定與獨立收據。
