# TFLite OP 靜態 shape 與可變輸入檢查

Preview.25 的 `CONCATENATION` catalog／port 表將 Netron metadata 的 `list: true` 讀成固定一個輸入，合法的雙輸入模型因此無法匯出。`SQUEEZE` 的推導失敗則退回參考 tensor，而匯出只比較元素總數，使非單位維度的錯誤 axes 仍被接受。三項實際 catalog／workspace 匯出回歸在修正前全部失敗。

現在 catalog 與 port 表保留可變輸入，draft 推導及匯出共用靜態 transform 規則：

- `CONCATENATION` 檢查至少一個輸入、dtype、axis、rank、非 axis 維度、axis 維度和與 int32 上限，並推導新的輸出 shape。
- `SQUEEZE` 檢查 axes 範圍與指定維度必須為 1，驗證實際輸出 shape／dtype。負 axis 與重複 axis 依 kernel 規則處理；同一維度只移除一次。
- 動態／未知 shape 不自行猜測；scalar concat 的常數條件保留 runtime 驗證。靜態輸出不符時，即使關閉自動推導也不能匯出。

規則核對固定 TensorFlow `87a97a3655fdf006ac1e9b7a6a41fec45022fe3c` 的官方 [SQUEEZE kernel](https://github.com/tensorflow/tensorflow/blob/87a97a3655fdf006ac1e9b7a6a41fec45022fe3c/tensorflow/lite/kernels/squeeze.cc#L38) 與 [CONCATENATION kernel](https://github.com/tensorflow/tensorflow/blob/87a97a3655fdf006ac1e9b7a6a41fec45022fe3c/tensorflow/lite/kernels/concatenation.cc#L126)。這是 metadata 層的規則，不宣稱涵蓋任意版本、量化或所有 kernels。

本機十九項相關測試通過，含三個原失敗、正負 axes／dtype／rank／空維度／溢位、動態與 scalar 保守處理、Undo／Redo 後真正匯出重開、既有草稿／亂數與 64-bit 參數。Hosted 候選與 main 原生案例已通過：1280×640／32px 的錯誤 SQUEEZE 拒絕匯出且保留草稿；雙輸入 CONCATENATION 匯出 `[1,4]`，由使用者手動執行 raw BIN 後核對 CPU／IO ZIP 的 `[1,2,3,4]`，再實際選檔重開並搜尋定位。

這些修改已隨 preview.26 完成正式部署；一般開檔、編輯及匯出不自動啟動 interpreter。


相關 shape 正負例已納入 [組合功能的候選與主分支驗收](model-composition.md#候選與主分支驗收)，包含實際 CPU 與 IO ZIP；已隨 [preview.26 正式交付](model-composition.md#preview26-正式交付)完成共同發布。
