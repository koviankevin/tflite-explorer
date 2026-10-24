# 精簡 MLIR 連線局部展開驗證（2026-10-24）

顯示層新增逐段展開；不更動解析、pattern 定義與匯出 IR。點精簡連線、展開後的路徑或側欄按鈕可切換；共享輔助節點去重並保留其他展開路徑。新增輔助節點不參與框選。每次最多顯示 512 個局部輔助節點，超出時顯示原因。

## 本次選測

- `mlir-slice-graph`、`mlir-layout`、`mlir-projection`、`pattern-selection`、`rectangle-selection`：40 通過，1 個需原生工具的案例先略過；另外設定 `MLIR_OPT` 補跑該案例通過（合計 41 通過）。
- 左／右匯合各自展開、共享節點去重、分別收起及還原；迴圈回跳與 loop-carried SSA 展開時不展開出口。
- 14／32px、水平／垂直方向的有限節點位置與有效連線；Netron 輸出名稱不由不同節點重複定義。
- 瀏覽器實際滑鼠點連線標籤、Enter／Space、側欄逐段收起、全部收起；改字級與方向後狀態保留。
- 展開 17 個輔助節點時拖曳框選，儲存結果仍為 5 blocks／6 原始 OP；搜尋得到 1 筆。
- 實際下載 pattern JSON 與局部 MLIR、重新選檔開啟、沿用新 pattern 搜尋 1 筆；重新開啟預設恢復 6 OP 精簡圖。
- 下載的 pattern 在 240 組來源模型得到 240 組唯一匹配；4 個改動分支、匯合、回跳與傳值的負例皆為 0。
- 下載的 MLIR 本機檢查無 diagnostics；原生 `iree-opt --allow-unregistered-dialect --mlir-print-op-generic` 退出碼 0，compiler print 後仍匹配 1 筆。保留 custom op 的長名稱、屬性與 64-bit 整數。
- 390×844／32px 瀏覽器 viewport：側欄長路徑名稱換行，沒有頁面水平溢出或工具列重疊；模型圖可在自身區域平移。這是桌面瀏覽器 viewport 驗證，未宣稱手機實機驗證。

原生未註冊 dialect 模式僅驗證語法、SSA、控制流程與適用的 dominance；公司 dialect 的語意驗證需公司工具。先前 8 次穩定重匯出結果沿用，匯出器本次未修改。
