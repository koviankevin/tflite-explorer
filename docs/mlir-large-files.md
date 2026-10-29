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

## 現行來源的 Hosted Node 大檔驗收（2026-10-29）

[40791134897](https://github.com/koviankevin/tflite-explorer/actions/runs/40791134897) 的實際來源為 `304348fd7965bccb2fb455d2daff44995a5477d5`，與固定 preview.22 公開應用程式相同，測試／交付文件不同。[原始 provider ZIP](results/large-mlir-current-2026-10-29.zip)及[獨立核對](results/large-mlir-current-2026-10-29-review.json)已核對 provider digest、ZIP CRC、來源、兩個實際子程序與全部原始報告。

實體來源 2,684,355,495 bytes，匯出 2,684,362,324 bytes；完整權重 hash 與既有固定 fixture 一致，SSA／dominance 通過，五個選取 OP 的跨 block pattern 在原檔及重開後各一筆。Pattern 檔另外保留五個 block、四個 argument 的控制結構，不是重複匹配。Node v24.22.1 開檔約 8.95 秒、驗證程序約 27.53 秒，子程序最大 RSS 286.3 MiB；compact structure 為 983 bytes。

這次是 Node 實體合成檔，沒有瀏覽器／Worker 記憶體、原生 compiler 或公司 dialect 驗收。2026-10-25 的瀏覽器與 Node 歷史紀錄保留如下，不能當成本次新跑的瀏覽器結果。

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

## 獨立手動 GitHub Actions 驗收

`.github/workflows/large-mlir.yml` 提供 **Optional 2.5 GiB MLIR Node acceptance**，只有 `workflow_dispatch`，不由 PR、push 或正式部署觸發，也不重跑 TFLite Chromium 驗收。[GitHub 要求 workflow 先存在於預設分支](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)，因此首次需要合併 PR 才能 dispatch；之後可選擇要驗證的分支。一般 PR validation 成功不能當成本項成功。

Ubuntu 24.04／Node 24 直接重用 `large-mlir-fixture.mjs` 與 `verify-large-mlir.mjs`，不安裝瀏覽器或 npm dependencies。可在 Linux 本機使用同一入口（目錄必須尚未存在）：

```bash
node scripts/accept-large-mlir.mjs test-results/large-mlir-run-001
```

入口固定產生 **2,684,355,495 bytes** 的實體檔，含 **2560 MiB hex 文字**（代表 1.25 GiB i8 權重），不能透過輸入縮小。沿用逐塊寫入及 fsync，並檢查分段讀取統計、延後權重區段、跨 block pattern、局部串流匯出、重新開啟、專案 SSA／dominance 檢查，以及重新開啟後的權重 SHA-256。另串流重算來源及輸出整檔 SHA-256；來源大小、來源整檔 hash 與權重 hash 必須與上列既有 fixture 一致。輸出整檔 hash 可隨匯出內容改變，不要求與來源相同。

執行前要求 **8.5 GiB 可用磁碟**（沿用產生器的三倍 payload 空間，再留 1 GiB）及 **2 GiB 可用記憶體**。Linux 優先採 `/proc/meminfo` 的 MemAvailable，並在 cgroup v2 可見時扣除其已用量，取較低可用值。門檻是保守預檢，不是記憶體上限保證，也不會自動清除 runner 其他內容或改用小檔。

`acceptance-report.json` 保存實際 checkout SHA、工作目錄狀態、GitHub run／attempt、runner image、OS／Node、前後可用資源、各階段時間、產生器與驗證器各自的 OS 最大 RSS、檔案大小、整檔與權重 hash 及失敗階段。最大 RSS 來自 Node `process.resourceUsage()`，不代表瀏覽器或整部 runner 的峰值；可用資源是階段邊界快照，非連續監測。

| 報告狀態 | 意義 |
| --- | --- |
| `passed` | 完整固定大小 Node 合成檔驗收通過 |
| `resource_insufficient` | 預檢不足，未開始產生模型；exit 2 |
| `resource_exhausted` | ENOSPC／ENOMEM／Node OOM，或可見 cgroup OOM kill 計數增加；exit 2 |
| `verification_failed` | 程式／檔案／hash／結構等驗證失敗；exit 1 |
| `interrupted_unknown` | 收到 signal，但無足夠資源耗盡證據；exit 1，不能直接宣稱程式 bug 或 OOM |
| `running` 或無最終報告 | runner／job 被取消、逾時或中斷，沒有完成驗收 |

所有非成功狀態均讓 job 失敗；取消或 runner 消失時，`always()` 也無法保證 Artifact 上傳。正常成功或可捕捉失敗都只上傳明列的精簡 JSON／JSONL／pattern 報告，保留 14 天，不上傳數 GiB 來源與匯出檔。檔案隨 ephemeral runner 銷毀。

### 驗證層級

新增入口的 [2026-10-25 本機完整執行報告](results/large-mlir-node-2026-10-25.json) 為 `passed`：Ubuntu 24.04.3／Node v24.22.1，來源 2,684,355,495 bytes、局部匯出 2,684,362,324 bytes，權重 hash 與上列一致，驗證程序最大 RSS 274,395,136 bytes（約 261.7 MiB）。本次執行基於 `26fcee9` 加入本 PR 的未提交修改，報告如實標示 `workingTreeDirty: true`；它是本機證據，並非 GitHub runner 執行紀錄。

| 層級 | 能支持的結論 |
| --- | --- |
| Node 本機合成檔 | 上列 2026-10-25 紀錄；本機執行新增入口的結果須另外標示來源 SHA／dirty 狀態 |
| Edge 本機／正式網站實測 | 上列原生選檔、UI 搜尋、pattern 匯入、下載與重開紀錄；本工作流程沒有瀏覽器步驟 |
| GitHub Actions 大型 MLIR | 只有對應 `large-mlir.yml` run 成功、且 Artifact 的固定大小報告為 `passed` 才算通過；PR validation 或 TFLite run 不算 |
| 公司真實 MLIR／完整 LLVM verifier | 尚未驗證；合成檔與專案 SSA／dominance 檢查不能代替公司 dialect／原生 compiler 的完整驗證 |
