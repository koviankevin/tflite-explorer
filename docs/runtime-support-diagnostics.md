# Runtime 不支援的 OP／版本分類

本項已於 v1.12.5 正式交付，完整來源與固定下載見文末收據。下方保留候選當時的原始證據及範圍。模型、測試輸入及診斷在本機處理，runtime 仍需手動啟動。

## 原因與範圍

真正的標準 Interpreter 對 TRANSPOSE version 999 回報 `INVALID_ARGUMENT: Can't initialize model`，詳細日誌則寫出找不到該 builtin 版本。原程式只從最外層錯誤文字判斷是否不支援，導致這種情況顯示「失敗」。最小實際 WASM 測試先重現此誤分類；保留原診斷、只改外層錯誤文字的對照確認原因，四行原始日誌並未遺失。

這次新增的註冊錯誤判斷僅限 **compile 階段明確的 builtin／version 註冊診斷**，會顯示「未能驗證」，並附 `failureKind: unsupported-kernel`、kernel、version 及原始訊息。畫面建議改用支援該 OP／版本的 runtime 驗證。通用初始化失敗、孤立的 Registration failed、已確認的 tensor metadata 及輸入錯誤維持失敗；Invoke 階段不使用舊的註冊訊息重分類。

比對限最後 12 行、每行 512 字元，沒有新增日誌收集、模型上傳、runtime 自動執行、timer／GC／RSS 規則調整或遠端推論。這是 runtime 能否驗證的分類，不構成模型合法性、任意 kernel 或數值等價保證。

## 實際回歸

96 項相關 Node 檢查通過、零失敗／略過，包含真正 AOT Interpreter、通用錯誤負例、日誌界線、原有 value-dependent／Softmax 數值、IO 部分保存、session 取消清理，以及發布證據拒絕案例。Chrome 157.0.8103.51／Edge 157.0.4341.60、1280×640／32px 各三個實際選檔／指定 raw BIN 情境通過：

| 合成情境 | 結果 | IO 與清理 |
| --- | --- | --- |
| TRANSPOSE version 999 | 未能驗證；保留缺少註冊版本與通用錯誤 | 未編譯／Invoke；不產生 IO 下載 |
| version 1，輸入 permutation `[2, 0]` | 真正 runtime 輸入錯誤仍失敗 | 保存兩份原始 input；沒有虛構 output |
| 同一份 version 1 模型，輸入 `[1, 0]` | 通過 | 兩份 input 與實際 output `[1, 4, 2, 5, 3, 6]` 的 bytes／數值吻合 |

後兩個案例的模型 bytes 完全相同，輸入 SHA-256 分別綁定，避免將不同輸入造成的失敗混為 kernel 不支援。每端三個模型、三個手動 runtime 及一個 layout Worker 全部關閉，SDK browser.close 返回；本次沒有 OS process reap、Windows 大檔 RSS 或數小時負載主張。

第一次 IO 對照的測試預期失敗也保留：重複 axes `[0, 0]` 在這個舊 Interpreter 可能完成 Invoke，但應用會以輸出 shape 不符判失敗並保存實際 output。已另加回歸，使用出界 axis 2 作為確定的 native Invoke-error 對照；沒有把此錯誤輸出改標為成功。

v1.12.5 起正式 HTTPS 必須保留原 54 項並加入本組第 55 項；缺少證據、改動模型／輸入 hash、錯誤分類、錯誤數值或 Worker 未關閉均拒絕。舊固定版本的原本案例範圍保留。

## 證據與待完成項目

[候選摘要](results/runtime-support-candidate.json)與[原始合成證據](results/runtime-support-candidate-evidence.zip)保留實際模型／BIN／IO、截圖、red／green、診斷對照及來源。封存 57 檔、562,706 bytes，SHA-256 `70c380f059acca752bd845c68b0471157762dad4bf5e1ad39c75f7f30fd88432`。受測為 dirty build `ac4f4f0d0a22e4cd`，355 核心檔；來源檔 hash 與建置 manifest 已比對，仍不是乾淨 PR／main 或正式發布證據。

接下來完成必要 PR、來源相同的關卡、固定產物準備、正式站與固定 Release 核對。整體商品等級目標、Windows 大檔適用性及其他 OP 規則仍維持原範圍。

## 乾淨主分支關卡已核對，尚未發布

PR #308 的實際受測 tree 與合併來源 `1716885e40849c2206c2a2ab66082906f4e84560` 相同；完整 Node 為 1,199 項通過、35 項既有環境條件略過。83 項發布契約及九筆 PR 核心效能樣本通過。新主分支的核心相依範圍仍為同一組 93 檔，沿用並重新認證主分支 [43959891843](https://github.com/koviankevin/tflite-explorer/actions/runs/43959891843) 的有效證據。

乾淨 build `de01ad978fc50ef0`、355 核心檔已重建並核對[完整四關卡收據](results/runtime-support-v1.12.5-main-gates.json)。新來源的 [大檔八輪](https://github.com/koviankevin/tflite-explorer/actions/runs/43970625515)、[契約](https://github.com/koviankevin/tflite-explorer/actions/runs/43970635278)及 [55 項站台操作](https://github.com/koviankevin/tflite-explorer/actions/runs/43970648605)均完成原始 artifact digest、ZIP CRC、報告來源、依賴 fingerprint 及必要案例核對。

實體 1,349,965,216-byte／21,005 OP 八輪於 2026-11-16 22:30:40.471Z 至 22:47:07.440Z 完成，1,978 筆觀察：RSS 漂移 127,811,584 B（121.89 MiB），低於原 128 MiB 上限；斜率 1,181,520.46 B／輪，peak growth 518,684,672 B，main heap 漂移 241,280 B。保留接近門檻的實際數字，不宣稱所有環境有同樣餘量。57 個觀察到的 Worker 終止、六個程序身分正常退出。

完整、局部及組合共 24 份匯出 SHA-256 與前次 metadata 來源的成功八輪完全相同，權重、opaque custom options 及重開 pattern 皆通過。此大檔關卡沒有執行模型推論；它不代表 1 GiB Interpreter 或 Windows 大檔 RSS 已驗收。接下來仍待固定產物 prepare／publish、正式 HTTPS 與固定 Release 核對，目前正式版維持 v1.12.4。

## v1.12.5 正式交付

[v1.12.5](https://github.com/koviankevin/tflite-explorer/releases/tag/v1.12.5)，build `4f77b6421b63d044`。明確缺少 builtin OP／版本時顯示「未能驗證」並保留原始診斷，真正的 tensor／輸入錯誤維持「失敗」。355 個核心檔、全站 1,559 檔、55 項正式 HTTPS 操作及四份實際固定下載均核對；Chrome／Edge 各三個 32px 情境通過。新來源的 1.25 GiB／21,005 OP 八輪依原政策通過，RSS 漂移 127,811,584 B。見[正式交付收據](results/runtime-support-v1.12.5-published.json)及[分類範圍](runtime-support-diagnostics.md#v1125-正式交付)。模型全程本機處理，interpreter 由使用者手動啟動；runtime 不支援的結果仍需其他工具驗證。

必要 PR 受測 tree 與合併後相同，四項來源綁定關卡及原始報告已核對；核心相依範圍相同而沿用有效主分支證據。發布、正式 HTTPS 與固定 Release 使用同一份準備產物，成功部署未重跑；本次有限驗收不擴大為 Windows 大檔、任意 kernel、數值等價或完整商品化已完成。
