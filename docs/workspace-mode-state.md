# 工作區按鈕選取狀態

Preview.26 從組合編輯返回探索後，探索與「加入組合草稿」可能同時顯示選取；關閉再開啟或結果分頁也可能帶著舊標示。根因是 `mode(false)` 更新探索／編輯兩個按鈕，組合按鈕僅在另一條 availability 路徑更新。

原生回歸先在未修正的應用執行：[40824341555](https://github.com/koviankevin/tflite-explorer/actions/runs/40824341555)，實際 checkout `c89d5c875f7f7ca5720038341ef36769622eea51`／tree `ff0bd6ea9c8a927a5b40a90158a59aae2da19438`／build `3ffca960dc8ef6bb`。[原始 provider ZIP](results/workspace-mode-red-2026-10-29.zip)與[來源／digest／CRC 獨立核對](results/workspace-mode-red-review-2026-10-29.json)保留 failed：點返回探索後，`aria-pressed` 為 `[true,false,true]`，預期 `[true,false,false]`。不是把缺少測試案例當成通過。

現在集中更新三個按鈕，模式切換、相同模式重設與 availability 都使用相同規則，僅當前工作區被選中。修改只處理導覽標示；模型、接線、草稿格式及 interpreter 行為沿用既有實作。

原生測試直接觀察三個按鈕及編輯區顯示狀態，涵蓋探索／編輯／組合切換、結果與來源分頁、大型 v2 還原和關閉再開。1.25 GiB 草稿、完整權重／options、Undo／Redo、32px 及匯出 bytes 仍走原有驗收。修正後成功結果及正式發布尚待取得，不能只以修改程式宣稱已修好正式站。
