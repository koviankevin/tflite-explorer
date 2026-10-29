# preview.31 候選與發布證據

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

尚未準備或部署 preview.31；正式站與固定 Release 仍為 preview.30。發布前需以更新後的 `release-evidence.json` 核對最終凍結來源，受控 prepare、原始準備包與乾淨重建一致，再提升同一份產物並核對正式站／固定下載。既有 tag、Release 與部署結果不覆寫。
