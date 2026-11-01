# Renderer 釋放變化的最小重現

本實驗接續[原八輪的觀察](physical-memory-attribution.md#八輪獨立診斷的觀察)，只用於釐清尚未發布的 v1.4.1 候選所遇到的原生記憶體問題。原正式失敗 `41252363060` 維持失敗，公開站與固定下載維持 v1.4.0；實驗不是發布關卡。

八輪原始資料中的大幅下降都發生在 release phase 開始後約 4～6 秒，且 renderer anonymous RSS 的下降量接近大型 source Worker 的 committed heap 加 backing；這只是待驗證的線索。原資料沒有 allocator 歸屬，不能因數量接近就確認根因。

先測一個排除條件明確的流程：原生選檔、局部定位第一個 OP、關閉模型，繼續取樣 45 秒。不匯出、不建立下載 Blob URL、不編輯或執行 interpreter。兩個合成 TFLite 保持原產生器的結構，分別為 3,005 與 21,005 個 OP，權重都縮為實際寫入、完整 readback 雜湊核對的 1 MiB；每份檔案小於 16 MiB。這不是超過 1 GiB 檔案的正式效能驗收，也不取代它。

獨立 workflow `renderer-release-probe.yml` 只有 main／手動入口、contents read 權限與十分鐘上限。每個案例使用新的隔離 Chromium、同一份乾淨來源、1280×640／圖字 32px、原生 chooser；500ms 取樣與原 10 秒正常關閉／observed-identity reap 規則保持。模型關閉仍要求 model Worker 在原五秒內退出，頁面 layout Worker 則在 context 關閉時核對。沒有 app 修改、GC／heap snapshot、時限放寬、安全設定改動或成功部署重跑。

訊號預先固定為：已關模型至少一秒後，同一 renderer 身分的相鄰完整觀察出現至少 100 MiB anonymous RSS 下降，間隔不超過 1.5 秒。保留總 RSS、原生分類、主頁 heap used／total 及差值，不扣除原 RSS。其他程序下降、PID／creation identity 改變、缺少 renderer 資料或過長的取樣缺口都不能冒充這個訊號。沒有觀察到訊號也照實記錄，不能解讀為修好正式記憶體失敗。

由既有 PID／startTicks guard 讀取原生資料，再投影為本次案例內的 ordinal labels；公開 JSON 只接受固定欄位、enum、數字和公開 Git／版本／雜湊字串。拒絕 PID、建立時間、路徑、環境、日誌與任意模型字串；上傳路徑只包含經驗證的單一 numeric report，private report／fixtures 不在 artifact 路徑。每個案例最多 512 個樣本、每個樣本 32 個程序，整份公開報告最多 8 MiB，超限明確失敗。

37 項相關選測通過，涵蓋既有 identity／memory probe、真正入口拒絕非 hosted 環境、結構縮小、延後釋放訊號與負例、缺漏／重用、公開欄位／報告預算、禁止發布，以及真實 workflow 的原件／fixture 上傳拒絕。實際 hosted probe 仍待必要 PR／來源核對後的一次限定執行；尚未取得這個最小案例的量測結果。

## 第一次執行與建置位置修正

PR #211 的 898 項 Node 測試通過、35 項既有選做略過，79 項必要契約全通過，實際受測 tree 與主分支相同。其後限定的一次 [41261551022](https://github.com/koviankevin/tflite-explorer/actions/runs/41261551022) 在 build 階段失敗，模型與瀏覽器尚未開啟，記憶體樣本為零。

原因是實驗將 core 輸出放在 runner 暫存目錄，違反既有 `buildDestination()` 僅接受專案輸出目錄的守門。從原報告的錯誤雜湊，與直接執行真正 builder guard 的錯誤逐字雜湊核對一致；[公開摘要](results/renderer-probe-build-failure.json)只列固定原因、來源、計數與 provider 校驗值，原始日誌與證據留在本機。

修正將 core 改放在專案 `build/` 下的獨立新目錄，報告／fixture 位置分開，沒有放寬 builder guard。實際 builder 契約回歸先重現相同拒絕，再驗證新位置可接受、原位置仍拒絕，相關選測增為 38 項且全通過。必要 PR／來源核對後，以修正來源事先限定一次 probe；原失敗和正式大模型失敗都不改列成功，也不重新執行原關卡。

## 第二次執行與顯示數量修正

PR #212 的 899 項 Node 測試、79 項發布契約通過，實際受測 tree 與主分支相同。修正建置位置後的 [41262415628](https://github.com/koviankevin/tflite-explorer/actions/runs/41262415628) 已開啟 3,005 OP 的小型模型，但 UI assertion 將畫面的分組數字 `3,005` 與原始字串 `3005` 比較，立即失敗。原錯誤訊息逐字重現的 SHA-256 與 artifact 相同；不是模型解析失敗或記憶體超標。保留一筆 baseline 樣本，尚無 loaded／closed 量測，不能用於判斷釋放。

六個觀察到的程序身分全部退出，model 與 layout Workers 皆關閉。原報告將失敗階段標為 cleanup，是 finally 覆寫了 ui 階段；現在於清理前記錄原錯誤，清理若另外失敗仍各自保留。數量比較改為與 UI 同樣的 en-US 分組格式，隔離 context 固定該 locale，不修改 app、parser、原測試門檻或正式部署。

回歸先重現相同的 `3,005 !== 3005`，再對兩個實驗規模核對正例並拒絕錯誤數量；原始 ZIP、日誌與失敗留在本機，公開僅有[固定欄位摘要](results/renderer-probe-count-failure.json)。修正來源的必要檢查與精確 tree 核對後，最多再執行一次本最小實驗；不重跑原大模型關卡或成功部署。

## 已取得最小案例的延後釋放訊號

PR #213 的 900 項 Node 測試通過、35 項既有選做略過，79 項必要契約全通過；合併來源 `d5f28c75f6fb7fa7c4b58a66fac61c8651cbe89c` 與實際受測 checkout 的完整 tree 相同。隨後限定的一次 [41263107748](https://github.com/koviankevin/tflite-explorer/actions/runs/41263107748) 已完成，沒有再執行原正式八輪或部署。

| 案例 | 實際檔案 bytes | 模型 Worker heap total | 關閉後觀察 | 預先固定訊號 |
| --- | ---: | ---: | --- | --- |
| 3,005 OP／1 MiB 權重 | 2,164,512 | 27,414,528 bytes | 92 筆／45.091 秒 | 未觀察到單次至少 100 MiB 的延後 anonymous 下降 |
| 21,005 OP／1 MiB 權重 | 8,836,512 | 132,456,448 bytes | 92 筆／45.183 秒 | 關閉後 28.307 秒，renderer anonymous 下降 152,268,800 bytes（約 145.2 MiB） |

共 195 筆樣本的順序、原生總和、同一 renderer label、訊號間隔與固定判定另以獨立讀取器重算。兩案關閉後最大相鄰間隔為 509／503 ms，沒有缺少 owner；各六個觀察到的程序身分退出，model／layout 各一個 Worker 皆關閉，零個 runtime／identity／其他 Worker。公開 schema 驗證及原實作 summary 重算也一致。大案例該步的 main heap total 僅下降 1,835,008 bytes，不能用主頁 heap 解釋全部 renderer anonymous 下降。

這證明在本次環境中，沒有大權重、匯出／下載 Blob URL、編輯與 interpreter，也能出現大幅延後釋放；不是上述操作才會觸發的必要條件。它沒有證明特定 allocator 或所有舊失敗的根因，也不能證明原大模型關卡已修好。先前八輪的步階在 release phase 後約 4～6 秒，本次在模型關閉後約 28 秒，時間不同，不能直接套用固定釋放延遲。

[數值摘要](results/renderer-release-minimized.json)只保留公開來源／雜湊、固定 enum、計數與量測；provider digest、ZIP CRC、原始報告 SHA-256、來源與 fixture readback 均已核對，原始日誌／封存留在本機。這項實驗一直是 `releaseEvidenceEligible=false`，沒有 forced GC、heap snapshot、RSS 扣除或 timer／門檻放寬。v1.4.1 的 OP／IO 候選仍未發布，正式站與固定 Release 維持 v1.4.0；下一步須釐清原生保留機制或降低實際配置開銷，不能用這次 success 換掉原失敗。

## 對應版本的 V8 pool 與唯讀日誌

受測 Chromium 是 156.0.8078.4；官方同版本 [DEPS](https://github.com/chromium/chromium/blob/156.0.8078.4/DEPS) 指向 V8 `b976f35da8356fcf4e5e176d1d810ba6a6f05718`，其 version header 為 15.6.75.0。[來源摘要](results/renderer-pool-source.json)保存固定來源及本機原件校驗值，沒有以當前 main 代替受測版本。

該版 [MemoryAllocator::TearDown](https://github.com/v8/v8/blob/b976f35da8356fcf4e5e176d1d810ba6a6f05718/src/heap/memory-allocator.cc#L54) 呼叫 pool 的 teardown；[MemoryPool](https://github.com/v8/v8/blob/b976f35da8356fcf4e5e176d1d810ba6a6f05718/src/heap/memory-pool.cc#L351) 可將已結束 isolate 的本地頁移入共用 pool，再由延後任務釋放。該原始碼的 [flag 預設](https://github.com/v8/v8/blob/b976f35da8356fcf4e5e176d1d810ba6a6f05718/src/flags/flag-definitions.h#L2783)啟用 pooling／teardown sharing，timeout 為八秒；這是來源預設，不是對實際 binary flags 或原 28 秒步階的完整解釋。

下一個事先限定的單次實驗沿用同樣的兩種實體小權重結構、45 秒觀察、500ms 取樣與程序／Worker 清理；僅加入 `--trace-gc-nvp` 日誌。這個旗標的 pool 路徑列出釋放的 normal／large page bytes；不調整 pool policy、timeout 或原 RSS 判定，不呼叫 GC 或 heap snapshot。`Browser.getVersion` 須符合上述版本，實際 browser command line 也核對只加入這個 JS 旗標。日誌本身可能影響時序，因此不能選作發布證據。

原始 browser stdout／stderr 經 pinned Playwright 的 `DEBUG_FILE` 寫入 `.browser-private.log`，不進入公開 artifact。每次取樣檢查總日誌不超過 4 MiB；讀取後每行最多 32 KiB、每案最多 128 筆 pool event。只保留受防護 browser root、renderer PID 和本案時間範圍一致的數值事件，原始 PID／address／命令／日誌字串不會輸出。公開事件的 renderer label 與 RSS 的相鄰步階對照，未對時或數量不足也照實保留，不能假設 pool 已解釋失敗。

45 項相關選測通過，包含 source byte units、外部／舊案例排除、私有欄位及大小限制、對時負例與真正 SDK 的私有輸出路由。SDK 測試只啟動一個短暫 Node 合成輸出程序，不開瀏覽器或個人 profile；尚未執行此加日誌的新 hosted 實驗。必要 PR 與受測／合併 tree 核對後只執行一次，保留先前所有失敗與成功診斷，不重跑原正式八輪或成功部署。

送審期間另核對同一修訂的 [Isolate::PrintWithTimestamp](https://github.com/v8/v8/blob/b976f35da8356fcf4e5e176d1d810ba6a6f05718/src/execution/isolate.cc#L8092)，實際前綴為 PID／pointer／isolate ID 三欄。初版合成行只用了兩欄；替換為真正 formatter 的結構後，回歸確實以 `pool-log-format` 失敗，再將 decoder 與 SDK 合成輸出一起修正。舊兩欄格式明確拒絕，pointer／isolate ID 也不會進入公開事件。這在 hosted 量測前處理，並保留原 red，不以舊格式測試成功代替實際版本覆蓋。

## 日誌實驗的 command-line 觀察修正

PR #215 的 906 項 Node 測試及 79 項必要契約通過，合併 tree 與實際受測 checkout 相同。但限定的一次 [41264988044](https://github.com/koviankevin/tflite-explorer/actions/runs/41264988044) 在開啟模型前失敗：`Browser.getBrowserCommandLine` 要求 `--enable-automation`，正常的 SDK 啟動沒有該旗標。原文逐字 SHA-256 與報告相同，實際 Chromium／V8 版本也符合來源；沒有模型或 RSS 樣本，不能判定 pool 假說。

修正改讀 launch marker 已確認的自有 root `/proc/PID/cmdline`，在讀取前後以原 parser 核對 PID／startTicks／存活狀態，大小最多 64 KiB；參數只留在 private report。沒有加 automation 或其他旗標，唯一新增的 JS 旗標仍為唯讀日誌。新回歸驗證讀取只限該 root、兩次身分核對、重用時不讀取或拒絕結果、空值／超預算拒絕，無須開瀏覽器。

[失敗摘要](results/renderer-pool-command-failure.json)保留原 run、來源、provider digest 與錯誤雜湊；當時觀察到的一個 root 已退出、零個 Worker。後續 cleanup 的「預期一個 model Worker、實際零個」是前段開模型前中止所造成的第二筆 assertion，不是原生關閉逾時。新來源必要檢查與合併 tree 核對後，才限定一次修正後日誌實驗；原失敗不改標、不重跑原正式八輪或部署。

## 已觀察到同一 renderer 的 pool 歸還

PR #216 的 907 項 Node 測試通過、35 項既有選做略過，79 項必要契約全通過；實際受測 tree 與合併來源 `e46ab3c8f224326ef05e6cfc6e5274caee6f2b77` 相同。限定的 [41265628094](https://github.com/koviankevin/tflite-explorer/actions/runs/41265628094) 已完成，原始數值 artifact 的 provider digest／ZIP CRC、來源、fixture readback、公開 schema 與 summary 均已核對。

| 案例 | 總樣本／關閉後樣本 | normal-page pool 歸還 | 固定 RSS 訊號 |
| --- | --- | --- | --- |
| 3,005 OP／1 MiB 權重 | 96／92，關閉後 45.140 秒 | 24,903,680 bytes，接收日誌時距關閉 29.717 秒 | 沒有單次至少 100 MiB 的延後下降 |
| 21,005 OP／1 MiB 權重 | 97／92，關閉後 45.067 秒 | 128,974,848 bytes（123 MiB），接收日誌時距關閉 29.153 秒 | 距關閉 28.634 秒的 renderer anonymous 下降 152,735,744 bytes；落在事先固定的日誌對時範圍 |

兩案各六個觀察到的程序身分、model／layout 各一個 Worker 均正常退出，零個 runtime Worker。共 193 筆原生總和／身分／固定訊號及 pool 對時已用另一份 Python 讀取器獨立重算；關閉後最大取樣間隔 506／518 ms，沒有缺少 owner。大案例該步 main heap total 只下降 1,835,008 bytes；pool 記錄因此提供了主頁 heap 之外的具體線索。小案例與大案例各另有一筆零釋放的 pool 事件，均保留；大案例排除兩筆前一案的日誌，不冒充本案事件。

`normalPageBytes` 在固定來源中是 reservation bytes 的歸還計數，不能直接等同 resident bytes，也不能宣稱解釋了整筆 RSS 或全部歷史失敗。對時使用 SDK 接收日誌的時間，會有輸出／排程延遲；V8 印出的時間屬各 isolate，不拿它當全域時鐘。這次觀察支持 V8 pool 參與延後保留，但不是已修復原 slope 失敗，也不是對未知 allocator／GC 的完整因果證明。

[公開數值摘要](results/renderer-pool-attribution.json)只含固定欄位，原始公開 ZIP／報告／job log 留在本機。含 PID／pointer 的私有 browser 日誌未上傳、未取回本機；公開 job log 另掃描確認沒有原始 V8 prefix，不能宣稱已保存那份 private log 原件。新日誌實驗始終不具發布資格，沒有 forced GC、heap snapshot、RSS 扣除、pool／timer 或門檻改動。正式站與固定 Release 仍是 v1.4.0，v1.4.1 未發布。

後續先量測並降低模型結構索引的實際配置開銷，再驗證功能、匯出與原政策；不靠關閉 V8 pool、強制 GC 或重跑既有失敗碰綠燈。

已開始[模型索引配置減量候選](model-index-allocation.md)，以同一實體小權重結構核對完整索引／pattern 指紋與三次 Node 前後觀察。這是應用程式修改；候選的 browser／RSS 與正式發布仍須各自證明，原失敗不改列成功。
