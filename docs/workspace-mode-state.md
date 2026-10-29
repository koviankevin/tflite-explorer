# 工作區按鈕選取狀態

Preview.26 從組合編輯返回探索後，探索與「加入組合草稿」可能同時顯示選取；關閉再開啟或結果分頁也可能帶著舊標示。根因是 `mode(false)` 更新探索／編輯兩個按鈕，組合按鈕僅在另一條 availability 路徑更新。

原生回歸先在未修正的應用執行：[40824341555](https://github.com/koviankevin/tflite-explorer/actions/runs/40824341555)，實際 checkout `c89d5c875f7f7ca5720038341ef36769622eea51`／tree `ff0bd6ea9c8a927a5b40a90158a59aae2da19438`／build `3ffca960dc8ef6bb`。[原始 provider ZIP](results/workspace-mode-red-2026-10-29.zip)與[來源／digest／CRC 獨立核對](results/workspace-mode-red-review-2026-10-29.json)保留 failed：點返回探索後，`aria-pressed` 為 `[true,false,true]`，預期 `[true,false,false]`。不是把缺少測試案例當成通過。

現在集中更新三個按鈕，模式切換、相同模式重設與 availability 都使用相同規則，僅當前工作區被選中。修改只處理導覽標示；模型、接線、草稿格式及 interpreter 行為沿用既有實作。

原生測試直接觀察三個按鈕及編輯區顯示狀態，涵蓋探索／編輯／組合切換、結果與來源分頁、大型 v2 還原和關閉再開。1.25 GiB 草稿、完整權重／options、Undo／Redo、32px 及匯出 bytes 仍走原有驗收。修正後成功結果及正式發布尚待取得，不能只以修改程式宣稱已修好正式站。


## 修正後候選與主分支驗收

相同原生回歸在 [40824746786](https://github.com/koviankevin/tflite-explorer/actions/runs/40824746786) 通過，PR head `d34dbd61d38f9be459ed2ece3279f52d4b65a3f5`／實際 checkout `a7a4933dfc737637bdd4a9a8829d69b4d8b4bc07`，與合併後 main `fec0a55767fc54748214b6f1e5bea051ddf5028f` 完整 tree 一致。[原始 ZIP](results/workspace-mode-candidate-2026-10-29.zip)、[獨立核對](results/workspace-mode-candidate-review-2026-10-29.json)與[修正後實際重開畫面](results/workspace-mode-candidate-reopen-2026-10-29.png)保留；返回探索僅探索按鈕被選中。1.25 GiB v1／v2 草稿、取消、接線、Redo／32px 視角、固定輸出 SHA、權重／options 及八個模型 Worker 原生關閉仍通過。舊 red 產物維持 failed。

Main build `dd965e93fb955856`／tree `1e1b7f9e1c34699116984fb9d22ed890d829f02e`，獨立乾淨重建與 [site 40825241058](https://github.com/koviankevin/tflite-explorer/actions/runs/40825241058) 相符。[原始切換 ZIP](results/workspace-mode-main-site-2026-10-29.zip)、[原生 ZIP](results/workspace-mode-main-native-2026-10-29.zip)及[獨立核對](results/workspace-mode-main-review-2026-10-29.json)驗六種版本切換、30 項原生操作、14 種 runtime／參數／組合情境、47 個模型／六個 runtime Workers 關閉；12 次工作區狀態逐筆重新核對，探索／編輯／組合及來源／結果分頁都互斥並與顯示面板一致。1366×640／1280×640／32px、實際 raw BIN CPU／IO ZIP、TFLite／MLIR pattern 及匯出重開仍通過。

[八輪 40825205066](https://github.com/koviankevin/tflite-explorer/actions/runs/40825205066) 的[原始 ZIP](results/workspace-mode-main-physical-2026-10-29.zip)及[獨立核對](results/workspace-mode-main-physical-review-2026-10-29.json)通過原 v3 限制：1.25 GiB／21,005 OP 每輪完整改模、子模型與組合匯出重開、權重／options、固定 hashes、pattern 正負例、40 個模型及 16 個指紋 Workers 原生 close；兩輪暖機後 RSS 漂移 10022912 bytes、斜率 1740800 bytes／輪，main heap 漂移 382404 bytes、取樣峰值 999264256 bytes，均在原門檻內。觀察到的 6 個 PID／start-ticks 全部正常退出，無強制清理。

[四項 main 關卡認證](results/workspace-mode-main-gates-review-2026-10-29.json)驗 provider digest／CRC、來源、所有原始數值與 scope fingerprint；[contract 原始 ZIP](results/workspace-mode-main-contract-2026-10-29.zip)保留。browser／contract／site 使用新 main 結果，core 40700051621 的模組 scope 完全相同而沿用。所有嚴格核對均實際 exit 0 後才寫入這批追蹤檔。正式 preview.27 仍待發布與驗證，不以 main 成功替代正式部署。
