# 實體大模型的原生記憶體歸屬診斷

目前公開版仍為 [v1.4.0](quantization-validation.md#v140-正式交付)。v1.4.1 候選的 [41252363060](https://github.com/koviankevin/tflite-explorer/actions/runs/41252363060)在八輪功能／權重／options／pattern、Worker 與程序退出通過後，因 RSS slope 約 24.39 MiB／輪超過原 16 MiB 失敗；[原始證據與重判](legacy-shape-validation.md#主分支驗收失敗尚未發布)保留，沒有發布或改列通過。

本次只增加獨立、唯讀的 Hosted Linux 診斷。使用同一個實體 1.25 GiB／21,005 OP 合成模型、八輪／兩輪 warmup、500ms RSS 取樣、五次 settle、原 URL timer、原 16 MiB slope 與原 10 秒正常關閉規則。它不是記憶體修正，單次診斷通過也不能取代失敗的正式關卡。

`physical-memory-diagnostic.yml` 只有 main／workflow_dispatch、唯讀 repository 權限及單獨 concurrency；job／artifact 分別為 `diagnose`／`browser-memory-diagnostic-*`，與發布關卡的路徑、job 及名稱不同。報告另標示 `purpose=readonly-native-memory-attribution`、`releaseEvidenceEligible=false`；發布驗證器會明確拒絕此標記，即使其餘內容及 status 是 passed。新增拒絕案例先重現漏擋，再修正，原有不可變歷史報告仍可驗證。

## 補充觀察

- 使用既有 `/proc` probe，從產生原 RSS 樣本的同一份程序表取得當時 active 的 owned PID／startTicks。讀取 status 前後再次核對 startTicks；退出／重用保持 missing，不補零、不讀外來替代程序的記憶體。
- 每份補充分類保留原 RSS、phase、elapsedMs 與前後觀察時間，包含每個程序的 anonymous／file／shared RSS。它們不會取代或扣除原始 RSS；共享頁面可能重複計入，非同一瞬間的差值也會保留。
- 每份 RSS 樣本都保留同一個 Performance 回覆中的 heap used／total；每次 phase 改變、至少十秒及原有五次 settle 點另補 Chromium process type、主頁 isolate 的 `Runtime.getHeapUsage` 和 DOM counters。backing 欄位描述 array buffer／external string，不能直接冒充 Blob、全部瀏覽器或所有 Worker 的持有者。未提供的欄位記 null；不呼叫 GC 或 heap snapshot。
- 補充結果依原始 sample index 存放，避免 interval 與顯式 settle 觀察重疊時，完成順序弄亂原 RSS 對應。只收白名單身分與數值欄位，不收 command line、模型名稱、權重或測試 BIN。

每輪診斷最多 4,000 個樣本、24,000 筆程序紀錄、512 筆 CDP 詳細資料；超限會失敗，不悄悄省略而聲稱完整。用原失敗報告 envelope，加上最大數目的六程序合成觀察、逐樣本 capacity 與 512 筆詳細資料，實際 JSON 大小 11,580,464 bytes，低於 16 MiB 診斷 metadata 預算。這只是序列化大小的合成檢查，沒有執行瀏覽器、讀取實體模型、量測 OS 記憶體或證明效能改善。

49 項相關選測涵蓋原政策、PID／startTicks、真實 probe 組合、重疊觀察、缺漏／重用、白名單、預算、逐樣本 capacity／settle 詳細資料及診斷報告不得發布。應用程式、parser、runtime、權重／custom options、套件版本與原 RSS／讀取／安全門檻不變。PR／main 來源核對後，只執行事先限定的一次診斷，保存成功或失敗的原始結果；實際歸屬與根因仍待觀察。

前置來源 `1148a2532ed89201c3aa503d23707c2fd8748e8d`／tree `288e3ac8ab2d160036432e5d4ca9e88649eef243` 的[收據](results/physical-memory-preflight.json)與[原始選測、拒絕 red／green、預算與 primary schema 雜湊](results/physical-memory-preflight-evidence.zip)保留 SHA-256／CRC。這些是收集器與接受邊界的前置檢查，尚未量到真正瀏覽器的記憶體歸屬，也沒有修復原 RSS 失敗。

## 診斷入口修正

PR #208 的實際受測 tree `d07991f97ec878eff5ee03de015597018755cb30` 與合併主分支相同，877 項 Node 測試通過、35 項既有選做略過，79 項發布契約全通過。但第一次獨立診斷 [41256209262](https://github.com/koviankevin/tflite-explorer/actions/runs/41256209262) 在入口即因 `Unknown lifecycle profile` 失敗：既有 allowlist 只接受 `gate／soak`，漏加 `memory-diagnostic`。這次沒有到 resource preflight，沒有建立實體模型或開瀏覽器，沒有記憶體樣本，不能用來推論 RSS 根因。

修正僅在原 allowlist 加入已設計的診斷模式；未知模式仍拒絕。新增測試以獨立 child 執行真正入口，在第一個 resource preflight 用 stub 停止，因此不用模型或瀏覽器即可重現舊錯誤，並驗證修正後能走到正確邊界、診斷不可發布標記仍在。相關選測增為 50 項且全部通過。最初測試在 Windows sandbox 的 temp rename 問題也保留，測試暫存改在 repository 的 ignored build 內後，才取得對應原錯誤的 red／green。

[失敗收據](results/physical-memory-entry-failure.json)與[原始 ZIP、日誌、來源核對及 red／green](results/physical-memory-entry-failure-evidence.zip)保留 provider digest、CRC 和逐檔雜湊。入口修正通過必要 PR 檢查後，以新來源事先限定一次診斷；不重跑原正式失敗關卡、不改門檻、不發布 v1.4.1。

## 八輪獨立診斷的觀察

入口修正的 PR #209 實際 checkout `56c0d1c2af7dbe1df5a497a3890ba838287f391d`／tree `911ffbab691ddf68d0a73cfad25cbab3f342783c`，與合併主分支 `697ac53a820baeb51798d0f01c55c1c91d7a50e2` 相同。878 項 Node 通過、35 項既有選做略過，79 項必要契約全通過。其後事先限定的 [41256679398](https://github.com/koviankevin/tflite-explorer/actions/runs/41256679398) 完成八輪，工作流程與原政策重判均通過；報告明確不可用於發布，原正式失敗仍為失敗。

共 1,720 個原 RSS／native 樣本、185 筆詳細觀察，包含原五次 settle 共 40 筆。所有樣本皆完整，程序數均為六個，沒有觀察到退出／重用造成的缺口；57 個 Worker 均關閉，六個觀察到的程序正常退出。八輪完整／局部／組合輸出及權重雜湊與原失敗報告逐項相同。原報告約 5.3 MB，provider digest、ZIP CRC、來源及每個樣本對應均已核對。

| 輪次 | 關閉後總 RSS（MiB） | 主頁 heap used（MiB） | 主頁 heap total（MiB） |
| --- | ---: | ---: | ---: |
| 1 | 593.195 | 5.887 | 8.066 |
| 2 | 597.547 | 6.104 | 8.316 |
| 3 | 598.992 | 6.086 | 8.316 |
| 4 | 601.949 | 5.776 | 8.316 |
| 5 | 605.102 | 6.205 | 7.316 |
| 6 | 606.949 | 6.248 | 8.566 |
| 7 | 616.973 | 6.299 | 8.566 |
| 8 | 618.555 | 5.977 | 8.566 |

本次 slope 為 4,336,025.6 bytes／輪，drift 20,369,408 bytes、main heap drift 151,100 bytes；沒有出現原失敗在關閉取樣時的高平台。但每輪 release phase 都觀察到超過 100 MiB 的 renderer anonymous RSS 大幅下降，多筆約 144 MiB；對應 file RSS 及主頁 heap total 不變。這提供了可觀察的程序／記憶體類別，尚未辨識 allocator、物件或 Worker isolate，也不能回推原失敗的確切原因。補充 native status 與原 RSS 並非同時讀取，最大差值 73,039,872 bytes 保留，沒有用差值修正或扣除正式 RSS。

[Chromium PartitionAlloc 說明](https://github.com/chromium/chromium/blob/main/base/allocator/partition_allocator/PartitionAlloc.md)記載空 span 的週期回收機制；目前資料尚不足以將此機制認定為本模型的根因。後續應用已保存的八輪變化設計有界的最小 allocator 歸屬測試。若使用 [Tracing.requestMemoryDump](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/#method-requestMemoryDump)，必須避開會強制 GC 的 deterministic 模式，不把診斷觀察改成正式驗收。

[公開數值摘要](results/physical-memory-attribution.json)保留來源、計數、原政策重判及移除 PID／環境欄位的變化。19 筆原始 metadata／報告／日誌及讀取器的封存完整留在本機，摘要提供其 SHA-256；本次不公開上傳本機原始日誌、截圖、路徑或程序身分。應用未作 RSS 修正，原正式關卡 `41252363060` 不重跑、不改列通過；v1.4.1 未發布，公開站與固定 Release 維持 v1.4.0。
