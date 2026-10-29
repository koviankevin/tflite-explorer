# 測試輸入視窗的回呼與控制項清理

preview.31 候選修正手動執行的輸入視窗。原本成功／取消時雖清空可見欄位，`edit-runtime-run.onclick` 仍持有 `specs` 的 getter、已移出 DOM 的控制項與最後選取的 File；沒有 pending promise 時，session reset 也直接返回。這是 callback ownership 的清理缺口，前一輪有限 RSS 通過不證明沒有任何物件被保留。

隔離重現直接呼叫真正 `runtimeInputsUI`、輸入驗證與共用亂數控制項，只模擬必要 DOM，不啟動瀏覽器／interpreter，也不用 WeakRef 或強制 GC。[初始五項失敗](results/input-cleanup31-unit.zip)包含成功／三種取消後仍有回呼、明確保留的舊確認函式能關閉新請求，以及 showModal 失敗留下控制項。這個舊回呼案例是單元層的 ownership 重播，不宣稱已在原生使用者事件中量到相同競態。

只先解除按鈕回呼時，[單一變因結果](results/input-cleanup31-unit.zip)為三項成功、兩項仍失敗，確認還需要請求身分與開窗失敗清理。最後每次 choose 在 showModal 前建立獨立 promise ticket，舊 ticket 的確認直接忽略；所有 close／reset 都解除 onclick、移除控制項並清空錯誤，成功仍將同一個 File 回傳給目前這次手動執行。錯誤 BIN 保持視窗及表單可修正，showModal 失敗也清理後傳回原因。

[相關二十四項測試](results/input-cleanup31-unit.zip)成功，包含五項新回歸、session 來源／generation 隔離、真實 CPU ADD、raw little-endian、IO ZIP、錯誤 shape／broadcast 與 Worker deadline。正式 native 驗收將在既有流程 read-only 觀察：Escape／取消後，以及完成 CPU 後，dialog 關閉、controls／file inputs 為零、onclick 為 null、錯誤清空；八輪的二十四次成功執行也逐次檢查。不操作 app API 或模擬 DOM click 取代原生互動。

候選保留手動啟動、所有原有資源限制、正常 URL 期限與自然 GC；沒有修改 interpreter kernel 或匯出格式。新版部署、固定 Release、正式原生與八輪量測仍待驗收，不以單元檢查代替正式交付。整體商品等級目標仍在進行。

原始 red／unlink-probe／green 輸出以 ZIP 內同名 `.log` 保留，包含原有空白；[SHA／byte 清單](results/input-cleanup31-unit.json)記錄原始 bytes、exit code 與成功／失敗數，不將格式正規化當成原始紀錄。

首輪 Chromium candidate 已驗到十四組清理及八輪二十四次 CPU；Firefox／WebKit 則另發現[共用 decoder 的 import side effect](model-reader-isolation.md)，已定位並修正，仍須完整核對新來源，不能將早先 Chromium 成功當成修正版的正式交付。
