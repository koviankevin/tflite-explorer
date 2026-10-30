# 資料庫連線失敗重試候選

目前正式站仍為 [preview.34](preview34.md#發布狀態)。本候選只調整探索草稿、編輯草稿及 pattern 清單的連線生命週期，尚未發布；不改資料庫名稱、版本、資料格式、保存上限或既有記錄。

## 問題與修正

三個資料庫 adapter 原先用 `connection ||= new Promise(...)` 保存連線結果，只在 request 的 `error`／`blocked` 事件中清除快取。如果 `indexedDB.open()` 同步拋出錯誤，事件不會執行，後續呼叫會重用同一個失敗 Promise，無法真正重試。[IndexedDB 規範](https://www.w3.org/TR/IndexedDB-3/#dom-idbfactory-open)允許在取得 storage key 失敗時同步拋出 `SecurityError`；這不代表已在特定正式站瀏覽器遇到或量到發生頻率。

候選明確記住每次連線嘗試。失敗時，只有快取仍指向該次嘗試才清除；同步拋錯與非同步 request 失敗都適用。多個同時讀取仍共用一個嘗試。被阻擋的舊 request 若延遲成功，會立即關閉該連線；舊 request 的失敗或舊 database 的 `versionchange` 不會清除新連線。

## 驗證範圍

使用實際三個 adapter，僅替換 IndexedDB 開啟／事件邊界，以 Node 回歸測試重現：

- 同步拒絕後再次開啟：舊程式只呼叫一次 `open()`；候選會再嘗試並正常讀取。
- 同時讀取共用嘗試，非同步失敗仍可重試。
- 被阻擋的舊 request 延遲失敗不使新連線失效；延遲成功則關閉舊連線。
- 已被替換的 database 延遲 `versionchange` 不會清掉新連線。

十五項連線測試在舊程式有九項失敗、六項正向控制通過；修改後，連同既有草稿、history、衝突、格式及跨 block pattern 測試共 52 項通過。測試不是 IndexedDB 實作，也不冒充實際瀏覽器權限切換、磁碟已滿或斷電驗收。preview.34 的真實 20 份容量上限／備份／移除／重試流程保持原有發布證據。

正式站尚未更新此候選；未啟動新的瀏覽器矩陣、大檔長測或部署。
