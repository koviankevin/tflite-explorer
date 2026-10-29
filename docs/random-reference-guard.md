# 亂數參考 tensor 缺失防護（候選）

Preview.23 的新增 OP 亂數表單在沒有可用 tensor 參考時，會在錯誤處理區外讀取不存在的 signature，造成整個進階表單被原始 TypeError 取代。損壞的 signature JSON 也有同一問題。

本機直接重播實際初始化 callback 已重現例外；完整 UI 模組的最小 DOM 回歸在修正前兩項失敗、一項合法 float32 成功。修正將參考查找與解析納入錯誤處理，缺少參考時顯示原因並停用空選單／產生按鈕；保留已選 OP 和其他表單。沒有更動亂數演算法、模型 writer、權重或推論。

修正後七項 Node 檢查通過：實際 Flatbuffer 序列化並解析只有 optional input 的公開 custom fixture、複製後的真實編輯草稿、損壞／null／不支援型別、合法 float32 命令，以及既有型別亂數規則。另有四項實際 callback 的合成 metadata 重播通過。這些尚不是瀏覽器原生操作或部署證據。

Preview.24 新增 Hosted 原生選檔與複製此 custom fixture 的檢查，確認表單保留、空參考與產生按鈕停用、原因文字存在，並沒有額外 interpreter／下載。固定 preview.19～preview.23 保留原驗收範圍。候選與主分支結果如下；正式交付仍待完成，目前正式站維持 preview.23。

## 候選原生驗收

[40799126680](https://github.com/koviankevin/tflite-explorer/actions/runs/40799126680)，來源 `2c758d37f9a8d4cd69140fcb141266b3d0df8e00`／tree `b2d54b7feef4f0097d9e325567f1fc92463d4806`，乾淨重建為 build `f39865b7ab420e4d`。[獨立核對](results/reference24-candidate-review-2026-10-29.json)已驗 provider digest、ZIP CRC、來源與原始報告；[版本切換 ZIP](results/reference24-candidate-site-2026-10-29.zip)及[原生操作 ZIP](results/reference24-candidate-native-2026-10-29.zip)保留。

六種切換、30 項原生操作與九種 runtime 情境通過，新增 optional-only custom OP 的原生選檔／複製確認表單仍掛載、沒有可選參考時停用選單與產生按鈕、提供原因且保留新增 OP，沒有額外推論／下載。原 raw .bin、CPU／IO ZIP、32px 取消焦點等情境仍通過；37 個模型與四個 runtime Workers 均關閉，沒有 page errors。


## 主分支發布關卡

主分支來源 `b22ffdccfce8c991b15709419a5b8bac8c5b3ec3`／tree `b2d54b7feef4f0097d9e325567f1fc92463d4806` 與候選完整 tree 一致；乾淨重建為 build `7cdef2178e357298`。main [site 40799735463](https://github.com/koviankevin/tflite-explorer/actions/runs/40799735463) 的 [原始切換](results/reference24-main-site-2026-10-29.zip)、[原始操作](results/reference24-main-native-2026-10-29.zip)及[獨立核對](results/reference24-main-native-review-2026-10-29.json)保留；六種切換、30 項原生操作、九種 runtime 情境與兩種 32px 原生鍵盤取消皆通過；optional-input custom OP 的表單保留、空參考／產生按鈕停用及原因文字也通過，沒有額外推論或下載。

[四關卡獨立核對](results/reference24-main-gates-review-2026-10-29.json)已驗 API／provider digest／ZIP CRC／原始政策與依賴指紋。Core 沿用未改動的 main 40700051621；新 browser 40799729271、contract 40799732347、site 40799735463 成功，不將 PR 綠燈當成可發布 main 證據。

[實體八輪程序核對](results/reference24-main-owned-review-2026-10-29.json)另驗原固定完整／局部模型 hash、權重／custom options、pattern 正負例、24 個模型與八個完整指紋 Workers。兩輪暖機後 RSS 漂移 10,633,216 bytes、斜率 3035721.143 bytes／輪，觀察到的 6 個 PID／start-ticks 身分正常關閉後全部退出，沒有強制清理。這是有限八輪／取樣證據，不當成新兩小時或其他引擎驗收。

上述是主分支候選及發布前證據，正式 Pages／固定 Release 仍須精確準備與發布後核對；不可先視為已部署。
