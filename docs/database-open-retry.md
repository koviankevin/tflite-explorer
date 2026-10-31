# 資料庫連線失敗重試與穩定版驗收

本頁記錄連線重試與 [v1.1.0 穩定版驗收](model-safety.md#正式發布)的交付：當時 build `9338194b51c14371`、來源 `697d9dfb6d128a522ac213c10cf8f072f643cab9`。現行正式版本以 [README](../README.md) 為準；這項修正沒有改變資料庫名稱、版本、資料格式、保存上限及既有記錄。

## 問題與修正

三個資料庫 adapter 原先用 `connection ||= new Promise(...)` 保存連線結果，只在 request 的 `error`／`blocked` 事件中清除快取。如果 `indexedDB.open()` 同步拋出錯誤，事件不會執行，後續呼叫會重用同一個失敗 Promise，無法真正重試。[IndexedDB 規範](https://www.w3.org/TR/IndexedDB-3/#dom-idbfactory-open)允許在取得 storage key 失敗時同步拋出 `SecurityError`；這不代表已在特定正式站瀏覽器遇到或量到發生頻率。

現在明確記住每次連線嘗試。失敗時，只有快取仍指向該次嘗試才清除；同步拋錯與非同步 request 失敗都適用。多個同時讀取仍共用一個嘗試。被阻擋的舊 request 若延遲成功，會立即關閉該連線；舊 request 的失敗或舊 database 的 `versionchange` 不會清除新連線。

## 驗證範圍

使用實際三個 adapter，僅替換 IndexedDB 開啟／事件邊界，以 Node 回歸測試重現：

- 同步拒絕後再次開啟：舊程式只呼叫一次 `open()`；候選會再嘗試並正常讀取。
- 同時讀取共用嘗試，非同步失敗仍可重試。
- 被阻擋的舊 request 延遲失敗不使新連線失效；延遲成功則關閉舊連線。
- 已被替換的 database 延遲 `versionchange` 不會清掉新連線。

十五項連線測試在舊程式有九項失敗、六項正向控制通過；修改後，連同既有草稿、history、衝突、格式及跨 block pattern 測試共 52 項通過。測試不是 IndexedDB 實作，也不冒充實際瀏覽器權限切換、磁碟已滿或斷電驗收。preview.34 的真實 20 份容量上限／備份／移除／重試流程保持原有發布證據。

## 穩定版的驗收選擇

原本少數 driver 只以 `0.2.0-preview.N` 的編號選擇示範模型執行、輸入清理及容量／重試案例；改名 v1.0.0 後會把這些選項算成 false。這是測試覆蓋缺口，不表示網站功能消失。共享的選擇函式現在只對明確的舊 preview 保留既有例外，穩定版、未來版本及其他有效標籤都要求完整現行案例；缺少或無效版本資料直接失敗。

保留 preview.28／31／34 三個邊界，涵蓋 v1.0.0、v1.0.1、次版／主版、預發行及 build metadata。重構時先保留舊判斷，七項測試中穩定版／未知標籤／無效資料三項重現失敗，四項歷史正向控制通過；修正後連同既有發布／桌面政策共 13 項通過。Hosted driver 報告明列實際選用的 `releaseFeatures`，供獨立核對。Firefox／WebKit 的 driver 共用判斷，但不新增這兩個引擎的執行。

[v1.0.1 已交付](v1.0.1.md#發布狀態)：主分支原生、大檔八輪、原始 provider 及正式站／四份固定下載均完成獨立核對。必要關卡沿用 main-only 規則，沒有改 workflow、安全、RSS 或 timer 上限。
