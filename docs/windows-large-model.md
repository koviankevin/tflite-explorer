# Windows 大模型程序記憶體驗收

最新 [v1.3.0 固定產物與 SDK 1.64.1 驗收](#v130-固定產物與-sdk-1641)在 Chrome／Edge 各完成八輪：兩端功能與原記憶體子判定通過，Edge 整輪通過，Chrome 最後正常關閉仍逾時。較早 [v1.2.0 完整驗收](#v120-固定產物的完整-windows-驗收)兩端曾通過，不能據此宣稱間歇性關閉根因已修復。小型模型、Linux 大檔及空頁結果各有範圍，不互相替代。

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

字級修正合併後的 `bb3bd37` 已補齊[新 Linux 實體八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/41174035077)。原始實體檔為 1,349,965,216 bytes／21,005 OP；八輪包含兩輪暖機，原 RSS slope 約 0.26 MiB／輪、drift 約 6.7 MiB，40 個模型 Worker、16 個指紋 Worker、完整權重／options／pattern／匯出重開與正常程序退出皆通過。來源、provider digest、CRC 與原判定見[收據](results/product-readiness-main-verification.json)及[原始封存](results/product-readiness-main-evidence.zip)。這補齊新來源的 Linux 關卡，沒有修復或替代 Windows Chrome 的正常關閉失敗。[v1.2.0 正式交付](product-readiness-v1.2.md)已完成；當時未完成的 Windows 完整驗收另於下節補齊，歷史失敗的根因仍未證實。

## v1.2.0 固定產物的完整 Windows 驗收

精確來源 `f592e3d9df7ed48fae2ca19e353c7215638959a3`／build `d69754e5b6791ecd` 的 322 個原始核心檔案重新驗證後，Chrome／Edge 各執行一次原始八輪流程，兩輪暖機、原 RSS／heap 門檻與 10 秒 browser close 上限均未改動。兩端 producer 與獨立讀取器都實際 exit 0；[收據](results/windows-v1.2-native.json)及[原始報告、debug log、政策與讀取器](results/windows-v1.2-native-evidence.zip)保留。

| 瀏覽器 | Closed RSS slope | Closed RSS drift | Sampled peak growth | 正常退出 |
| --- | --- | --- | --- | --- |
| Chrome | 約 -18.0 MiB／輪 | 19.5 MiB | 578.2 MiB | 18 個原生程序身分皆退出 |
| Edge | 約 15.7 MiB／輪 | 28.5 MiB | 584.8 MiB | 12 個原生程序身分皆退出 |

兩端均核對 1,349,965,216 bytes／21,005 OP、完整／局部／組合匯出、所有權重／custom options bytes、pattern 正負例、草稿與 32px 版面。每端 40 個模型 Worker、16 個全檔指紋 Worker，以及共 57 筆 native worker close 事件均核對；debug log 另確認 SDK 正常 exit 0，沒有事後強制清理冒充正常退出。Worker 記憶體是檢查點的 V8 heap／backing storage，不是獨立 OS RSS 或連續峰值。

**Edge 的 slope 接近原 16 MiB／輪上限，不能宣稱有寬裕餘量或未來永不成長。** 取樣可漏掉瞬間峰值；這是公開合成模型的有限八輪、manifest 固定 HTML 本機啟動，並非公司模型、數小時負載或 HTTPS 文件傳輸驗收。較早 Chrome4／Chrome5 及單次 IO-only 關閉失敗仍保留，後來相同大檔 IO-only 對照正常退出也不證明歷史根因已修復。未重跑成功部署。

## 空白頁的原生程序類型與等待鏈

後續兩個預先指定的短對照各只開一張合成空白頁，不載入網站應用、模型、下載、Worker 或網站 WASM。保留原 25 秒 idle、10 秒 browser close 上限；第一個保留觀察用 CDP session，第二個先解除這些 session，再關閉 context／browser。Chrome `156.0.8078.76` 的兩個 context 均正常關閉，browser 也各在約 30／28 ms 斷線，但程序在原 10 秒內都未退出，兩輪仍判失敗。

本次在每個 PID 的原生建立時間相符前後，僅讀取自有 Chrome 的 `--type` 分類；沒有保存完整 command line、環境或程序記憶體。兩次逾時當下 renderer、GPU、network 與 storage 已退出，仍存活的根程序與子程序可明確對應；子程序類型是 **crashpad-handler**。這只辨識這兩次實際仍存活的 PID，不能回推已消失的歷史 unknown child，也不能由同時存活就認定根程序在等它。

第二輪另以 Windows WCT 讀取 52 個自有執行緒；51 個回傳單一節點，一個查詢回報 error 87。沒有改動偵錯權限、列出同步物件名稱或讀取 stack／記憶體。依 [GetThreadWaitChain 官方說明](https://learn.microsoft.com/windows/win32/api/wct/nf-wct-getthreadwaitchain)，單一節點也可能來自不支援的同步等待，因此這次資料沒有找到可確認的等待相依關係，不能排除阻塞或宣稱已定位根因。

這些結果表示網站模型、推論、下載與這些觀察用 CDP session 不是本次逾時的必要條件；Chrome 自身仍可能啟動內建服務，不能把其 stderr 當成網站執行過 LiteRT。兩次 SDK 隨後 force kill 的日誌均保留，不冒充正常退出。沒有改變正式測試的關閉方式或放寬門檻。[本次主分支收據](results/transpose-main-verification.json)及[原始報告、分類／WCT helper、日誌與讀取器](results/transpose-main-evidence.zip)保留此獨立診斷；同批 Linux 關卡成功不修復這個 Windows 原生問題。

## v1.3.0 固定產物與 SDK 1.64.1

精確公開 app 來源 `7debc69df1a1c91e8ed3928a8a4932a493324180`／build `44782d0412ebc0b8` 的 323 個核心檔案核對後，Chrome／Edge 各執行一次完整八輪，沒有自動重試。driver 另固定於乾淨來源 `3f2115cbb71e9f8797ba0a0a617167de5144e463`；明確比對 app／driver 的可執行與測試輸入，SDK 1.64.1 以官方封裝 SHA-512 核對後隔離載入。這與後面的 canonical driver 驗證分開記錄，不把不同來源冒充同一次測試。

| Windows 瀏覽器 | Closed RSS slope | Closed RSS drift | 整輪結果 |
| --- | --- | --- | --- |
| Chrome 156.0.8078.76 | 約 8.44 MiB／輪 | 32.28 MiB | 原記憶體子判定通過；最後正常關閉超過 10 秒，exit 1 |
| Edge 156.0.4314.50 | 約 -10.87 MiB／輪 | 51.22 MiB | 原判定通過，13 個已觀察原生身分正常退出，exit 0 |

每端皆核對實體 1,349,965,216 bytes／21,005 OP、八輪完整／局部／組合匯出重開、權重／custom options bytes、pattern 正負例及 16 份原檔指紋；40 個模型 Worker、16 個指紋 Worker與 57 筆 native worker close 事件皆確認。Chrome／Edge 分別保留 2,530／2,054 筆程序樹樣本。Chrome 原 10 秒失敗時仍有兩個原生身分，SDK 稍後強制清理有原始日誌，不能算正常退出；本次 unknown child 也不能回推為較早空白頁已分類的 crashpad-handler。

原 8 輪、2 輪暖機、500ms 取樣、RSS／heap／讀取量門檻、URL 與關閉上限都未變。不強制 GC、不扣除 RSS、不修剪 working set；本機仍使用 manifest 固定原樣 HTML，因此不宣稱初始 HTTP 文件傳輸或防毒相容性通過。有限取樣及 Worker 檢查點也不等於連續峰值或永久不洩漏。

### OP 驗收的子程序觀察修正

獨立檢查發現舊 Windows OP UI driver 只初始化 observer，未呼叫 sample，實際僅記錄主程序。舊小型 UI 功能與 Worker close 結果仍有效，但不能用來證明子程序全部退出。已加上流程前與關閉前的原生取樣、PID／creation-time 身分清單及 descendant 必須存在的檢查；失敗時保留尚存活身分。原 root-only 報告在新獨立讀取器確實被拒絕。

[PR #195](https://github.com/koviankevin/tflite-explorer/pull/195)同時鎖定 Playwright 1.64.1／Chromium 156 世代，依新版 coreBundle 與 utilityContext 介面更新有版本／callback SHA 防護的原生 chooser adapter。四項 adapter／DOM 選測、PR 的 843 項 Node 通過（35 項既有選用略過）、78 項發布契約與九筆 core 量測皆核對。受測 merge tree 與合併後 `26523731` 的完整 tree 相同。

未修改的新版 canonical driver 完成 Chrome／Edge 四項 OP 流程：SPLIT 實際選檔、匯出重開與 pattern；動態 PAD 明列未檢查；錯誤 SLICE 零下載；21,006 筆 JSON 與畫面 100→200 筆。Edge 觀察到 11 個身分且正常退出；Chrome 觀察到 8 個身分、功能通過，但最後原 10 秒關閉仍失敗。這修好觀察覆蓋，**沒有修好 Chrome 關閉根因**。

新版工具另完成[正式網站唯讀驗證](https://github.com/koviankevin/tflite-explorer/actions/runs/41225507999)：35 項、15 組 32px 文字框、19 種手動 runtime、八輪 CPU／IO 與原程序／記憶體政策通過。這是 Linux Chromium 正式站結果，不取代 Windows 大檔。未重部署、移動 tag 或改寫固定 Release。[完整收據](results/windows-v1.3-sdk1641.json)及[189 份原始證據與來源](results/windows-v1.3-sdk1641-evidence.zip)保留混合結果、setup-only 失敗、provider ZIP／digest／CRC、原始程序快照及獨立讀取器；大型實體權重檔留在本機。

## 原生 stack 診斷取樣

後續直接以 Node 啟動隔離 Chrome、使用 CDP pipe 關閉空白頁，沿用已記錄 SDK 1.64.1 的啟動參數，只更換本次暫存 profile。25 秒 idle 後約 1,143 ms 正常退出，八個已觀察 PID／creation 身分皆消失。這是一次正常對照，不能證明 Playwright 啟動器造成間歇性失敗。既有日誌中，Chrome 內部 TensorFlow Lite 訊息在成功／失敗案例的組合也不一致，因此不是該失敗的必要或充分條件，更不能當成網站執行過 interpreter 的證據。

另外準備只針對自有合成程序的原生 stack collector：[Microsoft 官方固定 NuGet 套件](https://www.nuget.org/packages/Microsoft.Debugging.Platform.DbgEng/20260319.1511.0)先核對 SHA-512／ZIP CRC，五個 DLL 的 Microsoft Authenticode 均 Valid。依[非侵入式診斷介面](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/noninvasive-debugging--user-mode-)，短暫暫停、解讀 stack 後一定 detach；只保存固定 stack／module 名稱輸出，不製作原始記憶體 dump，停用 symbol 網路、shell／執行指令及 SQM，並使用該程序私有的 debugger 設定目錄。真正的合成 Python 子程序已取得 stack，解除後繼續執行且 exit 0；這個預檢不算 Chrome 逾時 stack。

新 canonical OP driver 仍固定 `70c3260`／tree `8789536`，候選 build `d3500ba9cd43f789` 的應用輸入與公開版相同。第一個案例的四項 OP 功能通過，但最後原 10 秒關閉失敗；保存 checkpoint 後，collector 的 Windows stdin 預設解碼在中文字路徑遇到錯誤，尚未 attach。已用實際 Node→Python 請求重現 red，再改明確 UTF-8 bytes 讀取，核對原始路徑、全部 native row 及真正 helper 的無 attach 驗證。原先 header parser 漏算 vararg COM 方法的預檢失敗也保留，沒有算成應用問題。

修正資料傳遞後的一次 OP、一次原 SDK 1.56.1 空白頁，以及預先限定最多三次的 OP 重現採樣均正常退出；每次的已觀察身分都以原生建立時間核對消失，沒有用 SDK 強制清理冒充成功。三次採樣到上限便停止，沒有反覆執行至取得偏好的結果。**目前仍未取得原 10 秒失敗當下的 Chrome stack，關閉根因沒有修好。** 後續應在實際失敗時蒐集該份缺少的證據；這批成功不能抵銷原始 Windows 大檔或小型失敗。

[本次收據](results/windows-close-diagnostics.json)及[124 份原始紀錄與診斷來源](results/windows-close-diagnostics-evidence.zip)保留所有正負結果、設定／解碼失敗及獨立讀取器。DLL／套件本體與大型實體權重留在本機；沒有更動正式網站、固定 Release、RSS／GC／URL 或關閉政策，也不新增公司／手機／其他引擎或長時間負載驗收。

## 實體八輪的失敗 stack

上述有限取樣結束後，另預先限定一次 Chrome 實體大檔案例；只在原 10 秒關閉失敗且 checkpoint 保存後加入 stack collector。公開 app 仍為 `7debc69`／build `44782d0412ebc0b8`，driver 仍固定 `3f2115c`／tree `76ee1c3`；八輪、兩輪暖機、500ms 取樣、URL、讀取與記憶體門檻未變。這一輪已真正取得失敗根程序的 43 個執行緒 stack，collector 完成 detach；它更新了上一節當時「尚未取得」的狀態，沒有改寫先前失敗。

實體 1,349,965,216 bytes／21,005 OP 的完整、局部與組合匯出重開、權重／custom options、pattern 正負例與 16 份原檔指紋通過。40 個模型 Worker、16 個指紋 Worker 與 57 筆 native worker close 核對。2,047 筆程序樹樣本按原政策重判，RSS slope 約 -10.11 MiB／輪、drift 16.82 MiB、main heap drift 168,024 bytes，記憶體子判定通過；中途較高樣本仍保留，未強制 GC 或扣除 RSS。

**整輪仍失敗。** 原 10 秒截止時根程序與一個未分類子程序仍存活；稍後 SDK 強制清理與全部 12 個已觀察身分消失不算正常退出。本次未分類子程序不沿用較早空白頁的 crashpad-handler 標籤。主執行緒 stack 停在 Windows 單一物件等待，但一份 stack 不足以確認等待物件或歷史根因；原始 stack 的 Chrome 近鄰 export 名稱及大 offset 也不能當作真正函式名稱。

本機另保存官方 Chrome 公開符號的來源、GUID／age、provider MD5、gzip CRC 與完整 SHA-256，僅嘗試對保存的位址離線解碼，沒有上傳 stack 或模型、沒有修改 DLL／PDB 或強制接受不匹配符號。PDB Info age 與 DBI／執行檔 age 分開記錄；單次離線解析未在另設的六分鐘診斷界線內完成，已以同一原生 handle 核對身分後結束該解析程序。正常 debugger 精確匹配及真正 Chrome 函式名稱仍未取得，不把檔案校驗當成解碼成功。符號資料與大型權重留在本機；[本次收據](results/windows-physical-stack.json)及[原始報告、stack、來源與校驗紀錄](results/windows-physical-stack-evidence.zip)保留失敗與解碼狀態。未宣稱 Chrome 根因修復，未重新部署或改寫固定 Release。

## 已定位的 Chrome 雲端資料夾統計阻塞

後續改用有界的離線 CodeView public records 讀取器，43.47 秒內讀取既有 PDB 的 718,242,754 bytes，未重新下載符號或執行模型。除了 GUID／DBI age，另核對 PDB section headers 與實際簽章 DLL 完全相同、沒有 OMAP，以及五個 PE export 的 RVA。四個關鍵 public symbol 起點還逐一對照 DLL 原生 runtime function table：起點相同，保存的返回位址位於其範圍內。因此下列四個函式有額外交叉證據；其他近鄰 public 名稱、大 offset、inline／折疊別名仍不能冒充精確函式或 source line。先前 DbgHelp 精確載入仍未完成，這是獨立的檔案解讀方法，沒有強制接受符號不匹配。

實體大檔失敗的主執行緒位於 `WaitableEvent::Wait` → `TaskTracker::CompleteShutdown` → `BrowserMainLoop::ShutdownThreadsAndCleanUp`；另一個 COM STA 背景執行緒位於 `cloud_synced_folder_checker::EvaluateOneDriveSyncStatus`，上層是 Windows storage／property 與 `NtQueryDirectoryFile`。同版 Chromium `156.0.8078.76` 的 [startup metrics](https://github.com/chromium/chromium/blob/156.0.8078.76/chrome/browser/metrics/chrome_browser_main_extra_parts_metrics.cc) 會在 COM STA、BEST_EFFORT、SKIP_ON_SHUTDOWN task 上呼叫這項 [OneDrive 狀態查詢](https://github.com/chromium/chromium/blob/156.0.8078.76/chrome/browser/win/cloud_synced_folder_checker.cc)；[TaskTracker](https://github.com/chromium/chromium/blob/156.0.8078.76/base/task/thread_pool/task_tracker.cc) 仍等待已開始的 SKIP task。這解釋本次關閉等待的位置，沒有證明 Windows／provider 的底層缺陷、查詢的具體目錄，或所有歷史失敗都相同。

再預先限定兩個依序執行、各一次的空白頁對照；都沒有網站、模型、Worker 或 interpreter。沿用原 25 秒 idle、10 秒正常關閉與 PID／建立時間觀察，只有自有暫存 profile 及下表這一個統計功能差異：

| 隔離對照 | 結果 |
| --- | --- |
| 原 SDK 1.64.1 啟動設定 | 10,058.5 ms 後仍未原生退出，整輪失敗；再次捕捉到相同的 shutdown 與 OneDrive 函式範圍，這次停在 Windows Cloud Files `CfRetrieveProperties`／`ZwFsControlFile`；事後強制清理不算通過 |
| 只把 `CloudSyncedFolderChecker` 加入原有 disabled-feature 清單 | 約 191 ms 正常退出、exit 0；八個已觀察原生身分退出，沒有強制清理 |

這一組對照支持本機 Chrome 啟動統計的雲端儲存查詢是阻塞來源；不代表永久修復或任意模型的可靠性保證。**正式 Chrome 驗收維持原設定與失敗判定，沒有把診斷用統計 opt-out 加入必要測試。** 未更動 OneDrive、個人瀏覽器／registry、sandbox、防毒、安全政策或正式網站；沒有重跑大檔、Edge 或成功部署。Chromium 歷史 issue 405035574 已在 M136 修正且涉及 loader lock，不能因函式名稱相同就把本次 M156 雲端檔案查詢判為同一個舊 bug。

[本次收據](results/windows-cloud-metric.json)與[原始對照、失敗 stack、範圍檢查、來源及授權](results/windows-cloud-metric-evidence.zip)保留。大型符號、權重與 debugger 本體留在本機。本次定位了具體外部等待路徑，未修改應用來掩蓋 Chrome／Windows 相容性問題；預設 Chrome 的原生關閉仍待處理。
