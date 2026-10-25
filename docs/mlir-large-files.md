# 大型 MLIR

整份 MLIR 不再受 64 MiB 上限限制。原本的整檔 `arrayBuffer → UTF-8 string` 和權重陣列解析，改成 File-backed 的結構文字及權重區段。模型仍只在瀏覽器本機 Worker 處理。

## 讀取與匯出

- 每次掃描 1 MiB，檢查完整 UTF-8。超過 4 KiB 的 dense literal，以及檔案 metadata 內的 resource hex string，保留原始 File 的 byte ranges。
- 4 KiB 門檻也涵蓋大量中型常數，避免數萬個各自未滿 64 KiB 的權重仍累積進結構上限；讀取每段時最多暫存 64 KiB 的型別標頭／前綴。Dense 括號巢狀深度另限制 4096。
- 支援 literal-first 數值／hex dense、Netron 支援的 type-first dense 和內附 resource blobs。保留型別、shape、operator、properties、SSA 和控制流程；不解析公司 dialect 的語意。外部權重檔選取尚未實作。
- compact source 中的臨時 token 只供結構 parser 使用。詳細資料以延後讀取提示替代，attribute 條件不會拿臨時值比對。Adapter 的 deferred attribute 有 `modelLensDeferred=true`、`value=null`，避免將 token 當作真實權重。
- 結構文字最多 256 MiB，扣除延後 payload；另保留既有 OP 選取、pattern、block 和輸出數量限制。大量非權重文字或大量 operations 仍可能達到結構／裝置記憶體上限。
- 匯出器對 compact source 做 SSA 邊界修改、投影與重驗，最後用 `Blob([text, File.slice(), …])` 接回原始權重。三條匯出路徑共用這個機制：同 block 局部、跨 block 局部及完整 function。檔案內 resource dictionary 目前整份保留，可能包含未選 OP 的 resources。
- 關閉模型會終止 Worker，釋放原始 File 與區段索引；已啟動的下載保留既有 Blob URL 生命週期。首次仍須完整掃描磁碟上的檔案，不代表數 GB 可瞬間開啟。

本機檢查涵蓋結構語法、SSA、已註冊的分支傳值與 dominance。大型 payload 檢查 UTF-8、引號／括號閉合及 hex 字元／偶數長度；不逐值解析數值 literal、不檢查權重元素數量，也不取代 LLVM／公司 dialect verifier。下載狀態會明示「大型權重保留原文，未逐值驗證」。檔案診斷在略去 payload 後會映回原始行列；匯出候選文字使用自己的位置。

## 驗證紀錄（2026-10-25）

實體檔 `weights-2560MiB.mlir` 為 **2,684,355,495 bytes**，含 2.5 GiB hex literal，表示 1.25 GiB 的 i8 權重、10 OP／6 blocks，以及 custom op、分支、匯合與迴圈。逐塊實際寫入、fsync，沒有 sparse padding。來源 SHA-256：`91f73e977e3d7787657a11cfa9b8369da58249faed0b63ebbd5187105402d3b4`。

| 驗證 | 結果 |
| --- | --- |
| Node v24.19.0 File-backed 開檔 | 12.19 秒；compact structure 983 bytes |
| Node 局部匯出、重開、跨 block pattern | 1 個原始匹配、重開後 1 個；SSA／dominance 通過 |
| 匯出權重原文 SHA-256 | `bee4d7dfdad770188e021938c81fd7d8e41e4e899f2a0fca4da0250822f0f560`，與來源一致 |
| Node 開檔／匯出／重開／hash 程序 | 整體約 48 秒；process max RSS 265.4 MiB（非整個瀏覽器記憶體） |
| Edge 原生選檔（本機網站） | 18.84 秒；custom op 搜尋定位、跨 block 匹配及下載通過 |
| 原生 Edge 下載的局部 MLIR | 2,684,362,324 bytes；重新解析、SSA／dominance、原 pattern 1 匹配、權重 hash 一致 |
| MLIR、條件、工作階段相關 Node 測試 | 137 通過；35 個需額外原生 compiler／下載檔設定的案例先略過 |
| 後續分段讀取／匯出／條件回歸 | 26 通過，含多份中型權重；SSA／projection 選測另 41 通過、1 compiler 案例當時略過 |
| TFLite 解析、custom op、子模型匯出 | 16 通過 |
| 原生 IREE `iree-opt`（LLVM 20.0.0git） | 33 compiler 正負例通過；實際下載檔案例未設定（1 略過）；同結構 scalar-splat fixture 另通過 |
| 原生 compiler 的 projection print／parse／SSA rename | 1 通過，補足前列 projection 當時略過的案例 |
| 分段讀取最終補測（含共用 dense aliases） | 13 通過；aliases 不向 dialect hook 暴露臨時權重值 |

GitHub 正式站亦完成原生 Edge 實際選檔、跨 block pattern JSON 匯入、唯一匹配定位、2.5 GiB 局部匯出與重開。在 1366×768、圖字 32px 下操作；重開後沿用舊 pattern 仍為 1 個匹配，精簡圖保留原來 5 個 OP。再次匯出的實體檔為 2,684,362,473 bytes，原始權重 hash 仍相同，SSA／dominance 檢查通過。最終版重開前一次下載檔為 18.06 秒；較忙時曾為 35.34 秒，因此不將單次時間視為速度保證。

大型 payload 本身沒有送入原生 compiler；上列 compiler 測試不代表公司 dialect 或 2.5 GiB 檔完整 LLVM verifier 已通過。公司實際產生的 MLIR 尚未提供，這是實體合成測試，非公司模型驗收。瀏覽器與 Node 數值會隨硬體、磁碟快取和並行工作變動。

可在測試目錄產生並驗證，不會在一般 `npm test` 自動配置數 GB：

```powershell
node scripts/large-mlir-fixture.mjs C:\qa\large-mlir 2560
node scripts/verify-large-mlir.mjs C:\qa\large-mlir
# 直接驗證瀏覽器下載檔，不額外產生巨大副本：
node scripts/verify-large-mlir.mjs C:\qa\large-mlir C:\Downloads\weights-2560MiB-submodel.mlir
```

目錄會保存 `plan.json`、`events.jsonl`、fixture／Node 報告及可匯入的 pattern JSON。初次產檔及匯出使用排他建立，避免覆寫既有檔案。
