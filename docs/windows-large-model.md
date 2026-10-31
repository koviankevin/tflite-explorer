# Windows 大模型程序記憶體驗收

本階段 Windows 1.25 GiB／21,005 OP 八輪已取得混合結果：Edge 通過原門檻；Chrome 第四輪 RSS slope 超標，第五輪內容與記憶體通過，但最後正常關閉逾時。兩輪都不能當成完整通過。[v1.2.0 已正式交付](product-readiness-v1.2.md)，但沒有修復或取代這項 Windows 完整驗收缺口。小型模型、Linux 大檔及空頁結果各有範圍，不互相替代。

## 原生觀察與所有權

`test/browser/windows-process-memory.py` 使用 Windows Toolhelp32 取得 PID／parent 清單，僅在確認本次隔離瀏覽器的所有權後讀取記憶體。根 PID 來自剛啟動的瀏覽器自己的 CDP `SystemInfo.getProcessInfo`；原生 helper 要求它是呼叫 Node 的直接子程序，且名稱為選定的 chrome.exe／msedge.exe。每個程序以 PID 加 GetProcessTimes 的 creation FILETIME 識別；只由目前仍存活、身分相符的父程序擴展子程序，已觀察的子程序仍單獨追蹤。重用 PID 不會當成舊身分，讀取 memory 前在同一 handle 再核對 creation time。

主判定使用整個已觀察到的瀏覽器程序樹 WorkingSetSize 總和，可能重複計算共享頁；另保留 PrivateUsage（private commit），不以它扣除或替換常駐記憶體。資料來源與欄位定義見 Microsoft 的 [PROCESSENTRY32W](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/ns-tlhelp32-processentry32w)、[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)及 [PROCESS_MEMORY_COUNTERS_EX](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex)。不讀個人 profile、程序環境、command line 或記憶體內容；helper 沒有終止程序或修剪 working set 的操作。

為避免 snapshot 與 OpenProcess 之間的 PID 重用，另在同一 handle 以動態連結的 [NtQueryInformationProcess / ProcessBasicInformation](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess) 核對真實 parent／PID，再檢查 creation time，最後才讀 counters；不解參考 PEB。這是僅供 Windows 驗收的 native API，未來 OS 可能變更；API 不可用或欄位長度不符直接使量測失敗，不降級為未證明的程序所有權。

原生前置測試已在 Chrome 156.0.8078.76／Edge 156.0.4314.50 的隔離空合成頁取得 counters，各追蹤 8／9 個身分，正常 close 後全部原生退出，helper 亦 exit 0。4 KiB 合成暫存檔的 [GetCompressedFileSizeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getcompressedfilesizew) 觀察得到 4096 bytes，核對後只刪除該檔與空目錄。這不是大模型、Worker heap 或八輪記憶體的通過證據。

## 八輪流程

既有 `model-lifecycle.mjs` 的 Windows 入口僅能明確授權啟動已安裝 Chrome／Edge，禁止 Windows soak。沿用 v3 的實體合成 1.25 GiB、21,005 OP、全權重非零寫入／fsync／完整 SHA-256 readback、實際選檔、pattern 正負例、整份編輯、組合草稿與匯出／重開流程。Windows 另以 GetCompressedFileSizeW 核對實體儲存量；只接受該次新建 OS 暫存目錄中的固定合成 fixture，拒絕 symlink／reparse root。原檔與尚留的小型檔案保留供後續核對，逐輪已核對並關閉的生成下載仍按精確檔名移除。

原 8 輪、2 輪 warmup、500ms 取樣、RSS／heap／讀取量門檻、80 秒 URL 釋放觀察上限、應用 60 秒 URL 壽命均不變。Linux gate 的 22 分鐘 watchdog 不變；Windows 測試工具的總 watchdog 為 30 分鐘，不是網站 runtime 或 URL 的計時器。Worker `Runtime.getHeapUsage` 仍在既有檢查點量測 isolate used／backing storage，不稱為獨立 OS RSS 或連續峰值。有限輪數與 500ms 取樣不能證明永不洩漏，也可能漏掉短暫尖峰及從未觀察的程序。

首輪 Windows Chrome 原始結果為失敗：沿用 Linux 的 22 分鐘總 watchdog 時，八輪實際選檔、整份編輯、切圖／組合、下載重開、權重／options 及 pattern 正負例已完成，但在 `cycle-8-release` 等待最後一批 URL 自然釋放時退出。第八輪缺少完整釋放／settle、整體判定與正常 browser close 證據，不能算八輪通過。原始報告及 exit 1 保留於 `build/qa/windows-large/chrome-1.json`／`.log`。為涵蓋這台 Windows 主機的原生下載、完整本機 bytes 比對與最後正常釋放，僅增加 Windows 測試總 watchdog；不減輪數、跳過驗證或縮短應用 timer。

先提交乾淨來源，再用獨立且尚不存在的報告檔，每個 channel 分開執行：

```powershell
$env:LIFECYCLE_MODE = 'gate'
$env:MODEL_LENS_BROWSER_CHANNEL = 'chrome' # 另一輪為 msedge
$env:MODEL_LENS_QA_PYTHON = 'C:\path\to\python.exe'
$env:LIFECYCLE_REPORT = 'build/qa/windows-large/chrome-1.json'
node test/browser/model-lifecycle.mjs --allow-local-browser
```

Windows 可先以 `node scripts/build.mjs --out build/qa/windows-large/site` 建置一次，再設定 `$env:LIFECYCLE_BUILD = 'build/qa/windows-large/site'`，讓兩個 channel 使用同一份產物。每次仍逐檔核對 manifest、完整來源 commit／tree 與乾淨公開產物；不接受不同來源或內網包，不覆寫仍在使用的建置。這只省去重複建置，實體檔案生成及八輪流程照常執行。未設定時及原 Linux CI 仍沿用原本的建置方式。

必要本機驗收範圍為 Chrome／Edge、1280×640／32px，不啟動手機、Firefox／WebKit、公司模型或兩小時測試。沒有放寬既有門檻、成功部署重跑或 workflow 改動。待取得原生大檔報告後再補充來源、實際退出碼、原始 counters、判定與獨立收據。

## 本機文件傳輸的第三方注入

第二輪 Chrome 八輪功能及原始記憶體子判定通過，但整輪仍為 exit 1：攔到 Kaspersky 外部 script 請求並拒絕，且 browser close 超過原 10 秒。21 個先前已證明所有權的 PID／creation 身分在事後唯讀檢查中全部消失；這不是原 10 秒內正常關閉的通過證據。完整失敗仍保留於 `chrome-2.json`／`.log`，不清除錯誤或改判綠燈。

小型控制測例重現了 HTML 中出現原始檔沒有的 script，連 HTTP CSP 標頭也被加入第三方 host。單加標頭並不足以隔離；[Kaspersky 官方說明](https://support.kaspersky.com/kav/21.2/en-US/97156.htm)也記錄其流量 script 注入能力。未修改防毒、系統信任、瀏覽器安全規則或請求拒絕規則。

本機 Windows 的功能／記憶體量測可明確設定 `$env:MODEL_LENS_TRUSTED_BOOTSTRAP = '1'`，同時必須指定 `LIFECYCLE_BUILD`。測試工具先驗證完整公開產物，再逐 byte 核對 index.html，使用 [Playwright route.fulfill](https://playwright.dev/docs/api/class-route#route-fulfill) 提供原樣 HTML 及原本的 CSP。只處理指定 origin 的 GET `/`／`/index.html` document；不攔截其他資產、外部 origin、POST 或 query。其餘資產仍走 HTTP，實際選檔、下載、Worker 與原生程序量測不變。小型 Chrome／Edge 的前後測已證明外部請求仍遭拒絕、相同建置可啟動及正常退出。

報告明列 `documentFixture.httpDocumentTransportVerified=false`，因為這項隔離量測不驗證初始 HTML 的 HTTP 傳輸，也不代表防毒相容性通過。正式站與 Linux 必要關卡仍使用正常 HTTP／HTTPS，分開保存證據。若 native browser close 再失敗，仍記為失敗，另記錄原有 10 秒 native reap 觀察；不延長關閉／reap 上限、不送強制終止訊號。

## 已取得的完整結果與後續診斷

[階段三收據](results/product-readiness-stage3.json)及[原始證據封存](results/product-readiness-stage3-evidence.zip)保留同一來源 `2899993`／build `fbf6138d30bb127d` 的完整報告、原生 counters、觀察器、測試程式、失敗及獨立核對。八輪包含兩輪 warmup，原判定使用其後六輪。封存公開副本只遮蔽第三方防毒請求的路徑／query；逐檔列出原檔與封存檔雜湊，未遮蔽的本機原始紀錄仍保留。

| 案例 | 原始結果 | 判讀 |
| --- | --- | --- |
| Chrome 第四輪 | exit 1；RSS slope `23,851,710.17` bytes／輪，高於原 16 MiB／輪 | 全部八輪內容、權重、custom options、pattern 正負例與原生正常關閉通過；記憶體仍不合格，不宣稱洩漏根因已確認 |
| Edge 第一輪 | exit 0；RSS slope `14,591,122.29` bytes／輪，原判定及獨立讀取器均通過 | 同一實體模型與完整八輪流程；保留 renderer 波動，不推論所有負載永不累積 |

短對照的逐程序紀錄另外識別出 Chrome 啟動的 `updater.exe`，可造成約 60–70 MiB 的程序樹波動及瀏覽器退出後仍存活。這推翻「單憑短對照即可歸因於指紋／digest」的推測；同步讀取及 BYOB 原型均未採用。它也沒有解釋完整案例中的所有 renderer 波動。

僅在明確授權的 Windows Chrome 測試啟動中加入 `--disable-updater-scheduler`。[Chromium 自己的 browser tests](https://chromium.googlesource.com/chromium/src.git/+/fc613d7cb460a811be6d8d8a6f5ab147f35e3ad6/chrome/test/base/in_process_browser_test.cc)也使用此旗標；[排程入口](https://chromium.googlesource.com/chromium/src/+/d231b99bf97fa46fee0d7ea4310657538a999dc5/chrome/browser/chrome_browser_main.cc)檢查後直接返回。它只影響該次隔離測試，不改作業系統更新服務、registry、個人瀏覽器、防毒、CSP 或正式網站。Linux 與 Edge 啟動不變；所有實際觀察到的後代仍計入 RSS 並須正常退出，不扣除背景程序。

原產物的 parser-only 對照完成 40 個真實解析 Worker，edit/export-only 對照完成 16 個真實序列化及重新解析 Worker，加入上述旗標後皆正常退出。兩者沒有覆蓋完整網站操作與真實下載，不能取代新的完整 Chrome 八輪驗收。

測試工具另在 Windows 的階段切換或每十秒保存原生逐 PID／creation 身分、CDP 程序類型、main isolate backing storage 與一般 DOM counters。這些唯讀補充不改原 RSS／heap 算法、warmup、取樣間隔或門檻；未呼叫強制 GC、leak-detection 清理或 working-set trimming。新的完整結果仍須在乾淨來源、實際程序結束後獨立核對。

## 第五輪與小型關閉對照

[後續原始證據](results/product-readiness-stage3-update.json)保留 Chrome 第五輪實際 exit 1：八輪完整功能、16 份全原檔指紋、權重／custom options／輸出 bytes／pattern 正負例及原記憶體判定均通過，closed RSS slope 為 `265,888.91` bytes／輪；但是最後 `browser.close()` 超過原 10 秒，原生觀察仍有兩個 chrome.exe 身分，故整輪失敗。57 個 worker close 事件不代替整個程序的正常退出。

讀取已安裝 Playwright 原始碼另確認，其 parent process exit handler 可能強制清理仍存活的自有瀏覽器。小型失敗的 debug log 確實保留此行為。因此不能把 driver 結束後 PID 消失視為原 10 秒內正常退出，也不能把沒有手動發訊號等同 SDK 從未清理。原報告、當時 counters 與失敗判定均未改寫。

四個空白頁對照在約 0.2 秒正常退出，保留／先解除 CDP 觀察器皆通過；同一五個 OP 小型網站的兩種關閉順序也都通過，沒有因果證據支持改變正式 teardown。另一次小型 UI 測試在錯選隱藏按鈕後，清理亦重現 close 逾時；修正測試選到可見的桌面搜尋按鈕，不能據此宣稱已修復瀏覽器關閉問題。

小型候選的 Chrome／Edge 1280×640、1366×640、32px、原生選檔、範本標示與搜尋數值檢查通過，並各正常關閉。但人工檢視截圖發現 Chrome 初次切字級時文字超框，表示原數值檢查未覆蓋真正文字尺寸；已補[字級排版回歸](font-reflow.md)。這批小型結果不能寫成完整視覺驗收，也不能抵銷第五輪大模型關閉失敗。

來源相同的主分支 `3eb0415` 另完成正常 HTTP 的 Linux 實體八輪、六種版本切換及完整網站操作，原 artifact digest／CRC／source／原判定皆獨立核對通過。新的字級修正會改變相關來源範圍，仍須補其受影響的正式關卡。

字級修正合併後的 `bb3bd37` 已補齊[新 Linux 實體八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41174035077)。原始實體檔為 1,349,965,216 bytes／21,005 OP；八輪包含兩輪暖機，原 RSS slope 約 0.26 MiB／輪、drift 約 6.7 MiB，40 個模型 Worker、16 個指紋 Worker、完整權重／options／pattern／匯出重開與正常程序退出皆通過。來源、provider digest、CRC 與原判定見[收據](results/product-readiness-main-verification.json)及[原始封存](results/product-readiness-main-evidence.zip)。這補齊新來源的 Linux 關卡，沒有修復或替代 Windows Chrome 的正常關閉失敗。[v1.2.0 正式交付](product-readiness-v1.2.md)已完成，這個 Windows 缺口繼續保留。
