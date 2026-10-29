# preview.31 發布與驗收

本版整理三個已重現的資源／隔離問題：測試輸入視窗完成或取消後清除 File 控制項與確認回呼；TFLite lazy buffer decoder 限於各個 reader，避免匯入 parser 改變示範模型的建置 bytes；草稿核對取消時不再建立同一輪即被取消的 Worker，並在終止前清除回呼。對應 PR #131、#132、#135。模型仍全程本機處理，interpreter 維持手動啟動。

## 固定候選驗收

受測來源 `3256ee92d8487395c4f9d34b6203fca205081860`、tree `44812dcb04763c5c5bb5e307d5ca819eb5c1341b`、build `d3941c81d3119920`。PR #135 head 與 main 完整 tree 相同；21 項相關 Node 測試通過，原始紅綠結果保留於 [Worker 對照](firefox-worker-lifetime.md)。

| 證據 | 結果 |
| --- | --- |
| 核心效能 [40885892195](https://github.com/koviankevin/tflite-explorer/actions/runs/40885892195) | 依完整實際 dependency fingerprint 沿用；不是以版本號或舊綠燈推定 |
| 實體大檔 [40899579343](https://github.com/koviankevin/tflite-explorer/actions/runs/40899579343) | 1,349,965,216 bytes／21,005 OP／非稀疏權重八輪；原政策通過，六個觀測 PID／start-ticks 正常退出；RSS drift 13,881,344 bytes、main heap drift 266,032 bytes |
| Contract [40899584574](https://github.com/koviankevin/tflite-explorer/actions/runs/40899584574) | 新來源完整合約關卡通過 |
| Chromium [40899590990](https://github.com/koviankevin/tflite-explorer/actions/runs/40899590990) | 六個版本切換檢查、33 項原生操作、82 model／44 runtime Workers close；14 次一般輸入視窗與 24 次 IO 生命週期清理；八輪／24 次 CPU、八份完整 IO bytes 比對、自然 60 秒 URL 與六個程序退出通過 |
| Firefox／WebKit [40899573179](https://github.com/koviankevin/tflite-explorer/actions/runs/40899573179) | 各 17 項原生操作、63 model／20 runtime Workers close、14 次輸入清理、19 種 runtime／分佈情境與五組指南；Firefox 指紋 Worker 由 27 個減為四個，四個 native close 都觀察到；獨立 32 個 Blob Worker 對照也全部 close |

各讀取器均在受測 checkout 固定期間真正 exit 0，核對 provider artifact digest／ZIP CRC、job／attempt／時間、原始報告、304 檔 candidate manifest、真實 Worker close 與 source scope。四個門檻與既有 final-page Netron layout 觀察界線未放寬；未把探測逾時改寫為 close。完整[原始 ZIP／中繼資料／獨立讀取器](results/preview31-candidate-evidence.zip)及[檔案 SHA 與退出紀錄](results/preview31-candidate-evidence.json)保留。

CPU／IO 八輪使用 4 MiB const／input／output；它與 1.25 GiB 的開檔／編輯／匯出八輪是兩組不同負載。量測僅適用 Hosted Linux 有限流程，不證明所有模型、所有 OS、連續 Worker heap 峰值或數小時 interpreter。既有搜尋、pattern／v3 草稿、32px／兩種筆電 viewport、TFLite 權重／custom options 及 MLIR SSA／控制流程匯出重開仍通過。

## 發布狀態

[preview.31 固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.31)與[正式站](https://koviankevin.github.io/tflite-explorer/)均已完成獨立核對。凍結來源 `adc870fee659611bf1a0fa78113642c1a3961afc`／tree `a0b7dd0c2cf3f1d904fd131510ce02256209d0d6`／build `3061076374227547`；與上述受測程式的四項 dependency scopes 相同，驗證結果沿用，不重跑成功功能。PR #136 head／merge 完整 tree 一致。

準備 [40903603540](https://github.com/koviankevin/tflite-explorer/actions/runs/40903603540)僅產生原始 ZIP／Pages tar；獨立 reader 核對來源、provider SHA／CRC、304 核心檔與全站 1,406 檔。第一次讀取中繼資料遭 GitHub core API quota 403；原報告保留，等官方重設後只重試 reader，沒有重跑工作流程。另一次乾淨重建的核心 manifest SHA `58f7277b5fcf93b901a1b8a166463cd9762a73503fa83a8fbfe2394eb32f23ff`與原準備包相同。

發布 [40904804639](https://github.com/koviankevin/tflite-explorer/actions/runs/40904804639)的 prepare／deploy／verify_live／release 均 attempt 1 成功。最終獨立 reader 實際 exit 0：全站 1,406 檔 SHA／MIME、root、權威 deployment `7417035286`及四份實際固定下載吻合原準備包。site ID `ebd6b08ec1bb92fb0844c13ecc8710a5980b29589308b5db4e65ffac752ab4bb`；固定 ZIP SHA `e46fbe50582e8ea294d3f20639a9a02fecef4e8591c3a5329e9a765d49c3f349`。舊 preview.30／29 與 legacy preview.7 保留；既有 tag、Release 和成功部署未覆寫或重跑。

正式原生 33 項操作、五組指南、19 種執行／分佈情境、82 model／44 runtime Workers close、14 次一般及 24 次 IO 生命週期輸入清理通過；真正 WHILE invoke 取消／30 秒逾時／恢復與八輪 CPU／IO／自然 URL 釋放也通過。[正式獨立收據](results/preview31-published-final.json)、[原始 provider ZIP／準備失敗及成功／乾淨重建／稽核程式](results/preview31-published-originals.zip)與[逐檔 SHA／實際退出紀錄](results/preview31-published-originals.json)保留。這是本版的交付結果，整體商品等級目標仍在進行。
