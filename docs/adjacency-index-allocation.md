# 鄰接索引配置候選

這是接續 [Softmax 發布阻擋](softmax-validation.md#主分支大檔關卡失敗尚未發布)的實際應用修改，尚未發布。原八輪 `43924226459` 的 RSS 漂移失敗保留；下列小權重結構實驗不能取代實體大檔關卡。正式網站及固定 Release 仍是 v1.12.3。

## 修改與可重現回歸

原索引為 21,005 個 OP 建立 63,020 個 Set：21,009 個 tensor 使用者集合、各 21,005 個正向／反向鄰接集合，另有一個 operator 類型名稱集合。大部分鄰接列只有一個鄰居。現在兩個方向以 Uint32 CSR 儲存，內部搜尋與局部圖透過快取的輕量列視圖讀取 iteration、size、has；高度分支的 membership 才提升該列為 Set。完整 `next`／`previous` 屬性仍依需求產生原生、可修改、可 structuredClone 的 Array&lt;Set&gt;。既有屬性的順序、稀疏列、重複 producer、self-loop 與兩方向獨立修改皆保留。

回歸直接執行真正的完整搜尋：96 OP 的線性搜尋在前一個「每列延遲 Set」原型仍建立 96 個 Set，低於 12 個的斷言確實失敗。現在線性與 induced 子圖搜尋均通過同一斷言，匹配路徑完全相同。沒有以 GC、Worker 生命週期、pool、URL timer 或 RSS 判定變更取得減量。

另外保留兩個未採用的實驗：整個鄰接向量延遲建立仍被第一張局部圖全部實體化；每次讀取新建物件／函式則使搜尋變慢約 2～3 倍、記憶體上升。最終實作改為共用 prototype 方法、每個需要的列最多快取一個視圖，避免每次讀取的配置。

## 同來源結構與時間／記憶體

使用實際寫入並 readback 核對的 8,836,512-byte／21,005 OP 合成 TFLite，權重只有 1 MiB。基準為乾淨 build `525f716810e77bf6`，候選為 dirty build `c85a2e4b7ea72960`；六個修改檔的 canonical SHA-256 與完整測量保存在[數值摘要](results/adjacency-index-candidate.json)。這些 dirty 建置不是發布產物。

Node 24.22.1 的六個新程序依事先固定的 A、候選、候選、A、A、候選順序執行，各三次；先解析、實際局部圖，再搜尋 7,000 條線性及 induced 子圖。完整 layers、tensors、producer／consumer 順序、兩向鄰接與線性結果的指紋皆相同：`4c5377e61b59ff797f4dce17a3079a1300dee314a1cfe5633462db84b77e58f2`；induced 結果逐路徑另比對一致。

| Node 中位數 | 原索引 | 候選 |
| --- | ---: | ---: |
| 索引完成 used heap | 144,073,368 B | 136,216,392 B |
| 線性搜尋後程序 RSS | 265,486,336 B | 259,158,016 B |
| induced 子圖搜尋後程序 RSS | 319,180,800 B | 312,385,536 B |
| 解析及索引時間 | 401.17 ms | 370.09 ms |
| 線性搜尋時間 | 40.33 ms | 46.07 ms |
| induced 子圖搜尋時間 | 98.76 ms | 134.06 ms |

搜尋時間有退步，沒有宣稱所有操作變快。自然 GC、程序排程與熱機差異影響這些 checkpoint；本次優先減少結構配置，後續仍由原政策判定完整資源流程是否可接受。

原生 Chrome 157.0.8103.51／Edge 157.0.4341.60 各採 A、候選、候選、A，獨立 context、1280×640、32px、本機 chooser。八案均完成 #0 搜尋定位、7,000 筆 pattern 搜尋、實際子模型下載、重開及再次搜尋；各案匯出 SHA-256、顯示節點皆與基準一致，觀察到的 Worker 全關閉，browser.close 正常返回，未量 OS identity reap。

| Worker checkpoint，兩次平均 | Chrome 原索引 → 候選 | Edge 原索引 → 候選 |
| --- | ---: | ---: |
| 索引完成 used heap | 67,787,522 → 57,824,244 B | 60,386,262 → 50,683,082 B |
| 索引完成 heap capacity | 113,930,240 → 111,286,272 B | 110,368,768 → 108,249,088 B |
| pattern 畫面 heap capacity | 122,404,864 → 118,734,848 B | 121,618,432 → 119,652,352 B |

候選 backing storage 同時由約 7.71 MB 增至 8.16 MB，不能只報 used heap。選檔至就緒兩次平均由 Chrome 1,604 → 1,031 ms、Edge 1,651 → 1,036 ms；樣本少，不作一般速度保證。這些是 Worker 的 V8 觀察，不是整個瀏覽器程序 RSS 或原 1.25 GiB 模型驗收。

## 驗證與交付界線

111 項選測通過、零失敗或略過，涵蓋實際索引／搜尋、200 組有分支及迴圈的隨機圖與 eager 兩向逐列對照、Canvas／收合總覽、跨 block pattern、MLIR 局部匯出與反覆重開。新測試先驗證所有指定測試檔存在，避免 Node 對不存在的路徑未報錯而誤認有覆蓋。

原始失敗、所有原型、來源、測量腳本、六次 Node 數據、八次瀏覽器數據與測試日誌留在本機 89 檔稽核封存，完整 SHA-256 `1430cbfba14e3130929967aba25da163b37496fd654971379213940c99171d74`，189,084 bytes；公開摘要只含合成 fixture 校驗、版本、來源與數字。未執行會強制 GC 的 Inspector sampling 結果讀取，沒有模型上傳或推論。

下一步為必要 PR 檢查、實際受測／合併 tree 核對，以及應用修改後新來源的原政策關卡。主分支大檔、正式站與固定下載尚未對本候選通過，不能把本頁局部成功改列舊 RSS 失敗已修復。

## 主分支原政策驗收仍失敗

上述為送審時的候選紀錄。PR [#302](https://github.com/koviankevin/tflite-explorer/pull/302) 已完成 1,184 項 Node 測試、35 項既有環境略過、83 項發布契約及九個新程序效能；受測 merge tree 與合併 tree 完全相同。另以 [#303](https://github.com/koviankevin/tflite-explorer/pull/303) 補上鄰接模組單獨修改時的 PR 效能觸發路徑，應用不變，依既有計畫沿用 runtime／build 結果。

乾淨主分支 `2c4273be98a513b6a95135539b2a76d77dc28d74`／build `bbd58bb177d33768`、354 檔已執行各一次原政策關卡。核心 [43945965104](https://github.com/koviankevin/tflite-explorer/actions/runs/43945965104)、契約 [43945985913](https://github.com/koviankevin/tflite-explorer/actions/runs/43945985913) 及站台 [43946214584](https://github.com/koviankevin/tflite-explorer/actions/runs/43946214584) 均通過，站台包含 54 項操作；來源指紋、provider digest、原始報告 SHA-256 與完整案例均核對。站台首次 dispatch 因漏傳 required input 被 HTTP 422 拒絕，沒有建立 run；確認清單沒有相同來源後才補上 versioned 情境及 build ID。隨後 API 暫時 404 也是追蹤同一 run，沒有重複 dispatch。

實體八輪 [43945973931](https://github.com/koviankevin/tflite-explorer/actions/runs/43945973931) 完成 1,349,965,216-byte／21,005 OP 合成模型的所有功能，但仍以 `closed-rss-drift` 失敗：

| 原政策指標 | 實測 | 上限 |
| --- | ---: | ---: |
| 暖機後 RSS slope | 9,480,484.57 B／輪 | 16,777,216 B／輪 |
| 末段 RSS drift | 140,804,096 B（134.28 MiB） | 134,217,728 B（128 MiB） |
| 主頁 heap drift | 235,404 B | 33,554,432 B |
| sampled peak growth | 567,701,504 B | 805,306,368 B |

1,888 個樣本、八輪關檔點與原公式另用獨立 Python 重算。完整／局部／組合共 24 份實際匯出 SHA-256 與前一個失敗來源完全相同，權重、opaque custom options、pattern 正負例、指紋、草稿組合及重開皆通過；57 個 Worker 與六個受觀察的程序均已退出。原 artifact digest 與 ZIP CRC、原始 report SHA-256 亦獨立相符，見[固定欄位失敗摘要](results/adjacency-physical-gate-failure.json)。沒有推論、強制 GC、RSS 扣除、pool／timer 或門檻修改。

真實八輪的 source Worker heap capacity 中位數約 127.12 MB，前次約 127.25 MB；edited-model 約 122.06 MB，前次約 120.22 MB。兩輪不是同一程序的受控比較，但已足以否定「小權重結構的 capacity 改善證明完整資源問題已修好」。本候選沒有解決發布阻擋，不重跑任一失敗來源，也不拿站台／功能成功取代 RSS 失敗。

正式網站及固定 Release 保持 v1.12.3，未開始 prepare／publish。下一步是量測解析階段剩餘的實際配置，保留此失敗及先前的 allocator 診斷；不再無修改地執行大檔關卡。
