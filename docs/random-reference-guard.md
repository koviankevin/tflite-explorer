# 亂數參考 tensor 缺失防護（候選）

Preview.23 的新增 OP 亂數表單在沒有可用 tensor 參考時，會在錯誤處理區外讀取不存在的 signature，造成整個進階表單被原始 TypeError 取代。損壞的 signature JSON 也有同一問題。

本機直接重播實際初始化 callback 已重現例外；完整 UI 模組的最小 DOM 回歸在修正前兩項失敗、一項合法 float32 成功。修正將參考查找與解析納入錯誤處理，缺少參考時顯示原因並停用空選單／產生按鈕；保留已選 OP 和其他表單。沒有更動亂數演算法、模型 writer、權重或推論。

修正後七項 Node 檢查通過：實際 Flatbuffer 序列化並解析只有 optional input 的公開 custom fixture、複製後的真實編輯草稿、損壞／null／不支援型別、合法 float32 命令，以及既有型別亂數規則。另有四項實際 callback 的合成 metadata 重播通過。這些尚不是瀏覽器原生操作或部署證據。

Preview.24 候選新增 Hosted 原生選檔與複製此 custom fixture 的檢查，應確認表單保留、空參考與產生按鈕停用、說明可見，並沒有額外 interpreter／下載。固定 preview.19～preview.23 保留原驗收範圍。瀏覽器、主分支關卡及正式交付仍待完成；正式站目前維持 preview.23。
