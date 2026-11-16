# Runtime 不支援的 OP／版本分類

本項是尚未發布的 v1.12.5 候選，正式站與固定 Release 維持 v1.12.4。模型、測試輸入及診斷在本機處理，runtime 仍需手動啟動。

## 原因與範圍

真正的標準 Interpreter 對 TRANSPOSE version 999 回報 `INVALID_ARGUMENT: Can't initialize model`，詳細日誌則寫出找不到該 builtin 版本。原程式只從最外層錯誤文字判斷是否不支援，導致這種情況顯示「失敗」。最小實際 WASM 測試先重現此誤分類；保留原診斷、只改外層錯誤文字的對照確認原因，四行原始日誌並未遺失。

現在只有 **compile 階段明確的 builtin／version 註冊診斷**會分類為「未能驗證」，並附 `failureKind: unsupported-kernel`、kernel、version 及原始訊息。畫面建議改用支援該 OP／版本的 runtime 驗證。通用初始化失敗、孤立的 Registration failed、tensor metadata 及輸入錯誤維持失敗；Invoke 階段不使用舊的註冊訊息重分類。

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
