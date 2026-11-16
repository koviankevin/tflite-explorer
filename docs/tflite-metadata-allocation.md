# TFLite metadata 配置候選

這是接續[鄰接索引修改後仍失敗的 RSS 關卡](adjacency-index-allocation.md#主分支原政策驗收仍失敗)之實際解析修改，尚未發布。失敗來源 `43924226459`／`43945973931` 均保留、不重跑；本頁的局部測量不能取代原政策實體八輪。正式網站及固定 Release 仍為 v1.12.3。

## 配置來源與修改範圍

同一份實體 21,005 OP 合成結構中，reader 實際建立 119,040 個 Int32Array metadata views，42,017 個為空，其餘 77,023 個總 payload 只有 532,152 bytes。另有 21,003 個空 Uint8Array；Netron 模型本身有 161,068 個 Array 容器。計數不使用 heap snapshot／GC，不讀取 view 的 `.buffer` getter 來推斷原先配置，也不展開 lazy tensor 值；合成 fixture 的完整 SHA 校驗仍正常讀回整檔。物件數不是配置 bytes 的證明。

`tflite-metadata-arrays.js` 只包裝本次 TFLite reader instance 的 Int32 metadata：小向量使用各自獨立的原生 view，存放在互不重疊的 64 KiB 區塊；空向量也保留各自的 view。非空向量超過 16 KiB、配置區達 8 MiB 或缺少直接讀取介面時，沿用原 reader 路徑；其他 dtype 全部沿用原路徑，沒有丟棄或縮減資料。上述 fixture 的 77,023 個非空向量使用九個區塊，共 589,824 bytes。

每個 reader 的配置區彼此獨立。權重 Buffer／RangeStream、Uint8 custom options、其他向量型別、schema decoder 與 builder 均保持原路徑，沒有全域修改 BinaryReader、Worker 生命週期、pool、timer 或 RSS 規則。

**內部 metadata 的 backing buffer ownership 改變**：同檔案內的不同 view 可以共用 buffer，byteOffset 也可非零；內容與 view 範圍內的修改互不影響。它不是可整塊 transfer 的 owned runtime IO。現有 writer 按向量值編碼；Netron graph builder 先將 metadata attributes／shape 正規化，新增真實 snapshot 測試確認主頁 graph DTO 沒有這些 arena views。Generic `serialize()` 本身仍會保留一般 typed views，沒有宣稱所有序列化介面都改成 Array。

## 真實 parser 回歸與正確性

兩個 subgraphs 的小型真實 parser 回歸，在修改前因「747 buffers for 747 views」失敗；修改後用少量區塊，同時保留 747 個不同 view。逐欄與原 generated-schema reader 比較所有 Int32 值，並驗證 view 修改隔離、structuredClone 內容、reader 之間隔離、換頁、8 MiB 後 fallback、空欄位、其他 dtype、大向量、原 reader 錯誤及真實截斷檔。

精選 108 項案例通過、零失敗／略過：41 項解析、custom options、完整編輯及組合匯出，66 項 shape／量化／Softmax／實際 WASM 數值，再加一項實際 graph DTO 邊界案例。後者所在六項 metadata 測試亦完整重跑；不是把重複案例加總。必要 PR 全套檢查仍待執行。

## Node 與原生瀏覽器測量

基準為乾淨 build `bbd58bb177d33768`；實際修改的 dirty build 為 `4dac4316b054dec8`、355 檔。原始 metadata、layers／tensors／兩向鄰接及 7,000 筆線性／induced 結果、完整與局部實際匯出 SHA-256 全部一致。六個新 Node 24.22.1 程序依 A、候選、候選、A、A、候選執行：

| Node 中位數 | 基準 | 候選 |
| --- | ---: | ---: |
| 索引完成 RSS | 247,193,600 B | 229,654,528 B |
| induced 搜尋後 RSS | 306,089,984 B | 277,032,960 B |
| 解析及索引 | 393.18 ms | 358.86 ms |
| 線性搜尋 | 40.29 ms | 42.91 ms |
| induced 搜尋 | 110.15 ms | 137.75 ms |

搜尋時間有退步，沒有宣稱所有操作變快。自然 GC 與排程影響 checkpoint，used heap 不能直接解讀為 live-object bytes。

Chrome 157.0.8103.51／Edge 157.0.4341.60、1280×640／32px 各兩組 ABBA：第一組八案驗證一般 7,000 筆搜尋及子模型重開；第二組八案依正式 lifecycle 的實際 pattern、完整編輯、接線、undo／redo、草稿保存及組合匯出流程執行。第二組仍使用相同 21,005 OP 結構，權重縮為真實非零 1 MiB，大小／hash assertions 對應此 fixture；沒有執行原 RSS gate 或縮短其等待。

第二組各模式兩次 checkpoint 平均如下，單位為十進位 MB 的 Worker heap capacity：

| 階段 | Chrome 基準 → 候選 | Edge 基準 → 候選 |
| --- | ---: | ---: |
| 原模型 pattern 定位 | 120.44 → 112.97 | 118.08 → 113.75 |
| 完整編輯後重開 | 109.43 → 117.47 | 109.30 → 117.08 |
| 局部子模型重開 | 33.46 → 29.56 | 33.46 → 29.82 |
| 原模型組合草稿 | 116.66 → 114.15 | 115.36 → 114.67 |
| 組合模型重開 | 34.66 → 29.82 | 34.66 → 29.43 |

這些階段觀察到的最大 capacity，Chrome 為 121.88 → 117.99 MB，Edge 為 119.00 → 117.81 MB；不是連續 peak 或 OS RSS。第一組剛開檔時的 capacity 反而增加約 7～8 MB，而 pattern 畫面下降約 8 MB，說明不能只挑有利 checkpoint。

第二組 24 份實際輸出跨基準／候選完全相同，包含 21,006 OP 完整編輯、四 OP 局部模型與九 OP 組合模型；權重、opaque custom options、報告 byte comparison、草稿歷史及重開搜尋皆核對。所有觀察到的 Worker 關閉、SDK browser.close 返回，沒有 OS process reap 證明或自動推論。一次診斷腳本相對路徑錯誤發生在瀏覽器啟動前，修正並 import 預檢後才執行，原件保留。

## 證據與下一步

[固定欄位數值摘要](results/tflite-metadata-allocation-candidate.json)記錄個別來源 SHA、各階段、完整指紋及原始封存校驗。94 檔原始本機稽核封存為 2,199,950 bytes，SHA-256 `4f46566ff5ae2c0f1b88e7b30f30ce9c6b4d1685f5a2e5f4670524503597bfe3`；沒有把 raw logs／模型上傳成發布證據。

本候選有實際配置與正確性證據，但仍未證明修好完整 RSS 漂移。接下來需必要 PR 檢查、受測／合併來源核對及新來源的原政策關卡；全部通過前不 prepare／publish。原有兩個實體失敗、正式 v1.12.3 與安全規則保持。

## 新來源四項關卡已核對，尚未發布

PR #305 的實際受測 merge tree 與合併後 `48f4d2f401953306c864c264213f718011db81f3` 相同；必要 Node 為 1,190 項通過、35 項依既有環境條件略過，83 項發布契約及九筆核心效能樣本通過。乾淨來源 build `84887a25d20b31ec` 共 355 核心檔，已重新建置並核對[四關卡收據](results/metadata-arena-v1.12.4-main-gates.json)的 provider digest、原始報告、source scope 與產物。

新來源的 [實體八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/43959902520)在原政策下通過。實際 1,349,965,216 bytes／21,005 OP 檔案由非零權重逐塊寫入、fsync 並完整 SHA-256 回讀；八輪於 2026-11-16 21:25:55.666Z 至 21:40:09.091Z 執行。關閉後 RSS 漂移 12,595,200 B、斜率 712,235.89 B／輪，峰值成長 494,804,992 B，main heap 漂移 691,300 B，均符合原門檻。完整編輯、局部子模型、組合草稿及重開搜尋通過，57 個觀察到的 Worker 終止、六個程序身分正常退出。

核心、83 項契約及 54 項站台操作亦通過。這是一次新來源的有限 Hosted Chromium 驗收，不代表所有 Windows 版本、數小時負載或任意模型已通過，也不單憑一次成功證明歷史 RSS 的全部根因已解。原兩個失敗及診斷保持原狀；接下來仍須固定來源的 prepare／publish、正式 HTTPS 與固定 Release 核對，正式版本目前仍為 v1.12.3。

## v1.12.4 正式交付

新 metadata 來源與 Softmax 檢查現已一併正式交付，見[完整收據](results/softmax-v1.12.4-published.json)。原來源的兩次 RSS 失敗保留；新來源依原政策通過八輪，仍不擴大為所有 Windows／長時間資源保證。正式 HTTPS、Chrome／Edge 與四份固定下載核對完成，未重跑成功部署。
