# 本機診斷驗收（2026-10-27）

版本 `0.2.0-preview.5`，Windows、Node.js 24.19.0、實際 Edge。只使用公開／合成測試模型；所有 `SECRET_*` 名稱是這次建立的測試字串。版本來源及正式交付內容以 release metadata 與 manifest 為準。

## 選測

診斷及保存／視角相關 36 項通過：`diagnostics`、`workspace-session`、`workspace`、`pattern-store`、`svg-viewport`、`overview-canvas`。後續針對診斷邊界小修，與匯出／cross-block 相關 43 項通過：`diagnostics`、`mlir-cross-block`、`tflite-export`、`custom-export`、`export-report`。兩批中的 diagnostics 重疊，不加總為不同測試。

驗證錯誤物件的 message／stack／未知 name 不保留、變動或拋例外的 name getter 不洩漏、報告再次過濾未知欄位、版本缺失／混用、未知數值使用 null、清除前的未完成操作不重現，以及 10,000 次操作後仍僅 64 筆、JSON 不超過 64 KiB。白名單測試另放入內網擴充名稱／版本／指紋、草稿身分、搜尋及 pattern 字串，確認沒有進入輸出。

## 實際檔案與介面

- 實際選擇內容無效的 TFLite，畫面顯示格式錯誤；診斷只留下 open／Error 與耗時。下載 JSON 與預覽全文相等，沒有檔名、原始錯誤、模型資料的測試標記。
- 實際選擇包含分支、匯合、迴圈及合成私有 namespace 的 generic MLIR，重新選模恢復五個 blocks 的五個 OP，填入測試 pattern 名稱。診斷只保留粗略規模及狀態，沒有 namespace／SSA／pattern 名稱，下載仍與預覽全文相等。
- Escape 關閉診斷後，五個選取及 picking=true 保留，焦點回到版本按鈕。清除診斷後事件為零，仍可從五個選取匯出局部 MLIR。
- 局部 MLIR 下載後 native IREE `iree-opt.exe --allow-unregistered-dialect` 檢查成功；實際重開仍匹配一次。此為 generic 語法檢查，不代表公司 dialect 語意或 runtime 數值等價性。
- 新候選產物 `28ae7e13d1449323` 實際選擇 custom TFLite，搜尋 `InternalSplitFoo` 得到一筆；診斷不包含該搜尋字串。暫時將本機生成的 release.json 改名，實際 HTTP 404 時仍能預覽／下載，releaseStatus=unavailable、版本欄位為 null。測後恢復原檔。
- 圖字 32px、390×844 CSS viewport，診斷視窗 left=18、right=357，document clientWidth／scrollWidth 同為 375px，按鈕換行與 JSON 換行正常；Escape 不取消模型選取。

候選 `68e4a30e3b1c3c3b` 執行初始私有標記與 MLIR 流程，`28ae7e13d1449323` 補測未知數值、過濾後錯誤分類與下載返回時的世代保護後的產物。這些小修不改變已驗收的正常報告欄位或模型操作。正式部署另核對固定來源及完整性；未以本輪驗收宣稱整個商品等級目標完成。
