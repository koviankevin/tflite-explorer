# 亂數參考 tensor 缺失防護（preview.24）

Preview.23 的新增 OP 亂數表單在沒有可用 tensor 參考時，會在錯誤處理區外讀取不存在的 signature，造成整個進階表單被原始 TypeError 取代。損壞的 signature JSON 也有同一問題。

本機直接重播實際初始化 callback 已重現例外；完整 UI 模組的最小 DOM 回歸在修正前兩項失敗、一項合法 float32 成功。修正將參考查找與解析納入錯誤處理，缺少參考時顯示原因並停用空選單／產生按鈕；保留已選 OP 和其他表單。沒有更動亂數演算法、模型 writer、權重或推論。

修正後七項 Node 檢查通過：實際 Flatbuffer 序列化並解析只有 optional input 的公開 custom fixture、複製後的真實編輯草稿、損壞／null／不支援型別、合法 float32 命令，以及既有型別亂數規則。另有四項實際 callback 的合成 metadata 重播通過。這些尚不是瀏覽器原生操作或部署證據。

Preview.24 的 Hosted 原生選檔與複製 custom fixture 已確認表單保留、空參考與產生按鈕停用、原因文字存在，沒有額外 interpreter／下載。候選、主分支與正式交付證據如下；固定 preview.19～preview.23 保留原驗收範圍。

## 候選原生驗收

[40799126680](https://github.com/koviankevin/tflite-explorer/actions/runs/40799126680)，來源 `2c758d37f9a8d4cd69140fcb141266b3d0df8e00`／tree `b2d54b7feef4f0097d9e325567f1fc92463d4806`，乾淨重建為 build `f39865b7ab420e4d`。[獨立核對](results/reference24-candidate-review-2026-10-29.json)已驗 provider digest、ZIP CRC、來源與原始報告；[版本切換 ZIP](results/reference24-candidate-site-2026-10-29.zip)及[原生操作 ZIP](results/reference24-candidate-native-2026-10-29.zip)保留。

六種切換、30 項原生操作與九種 runtime 情境通過，新增 optional-only custom OP 的原生選檔／複製確認表單仍掛載、沒有可選參考時停用選單與產生按鈕、提供原因且保留新增 OP，沒有額外推論／下載。原 raw .bin、CPU／IO ZIP、32px 取消焦點等情境仍通過；37 個模型與四個 runtime Workers 均關閉，沒有 page errors。


## 主分支發布關卡

主分支來源 `b22ffdccfce8c991b15709419a5b8bac8c5b3ec3`／tree `b2d54b7feef4f0097d9e325567f1fc92463d4806` 與候選完整 tree 一致；乾淨重建為 build `7cdef2178e357298`。main [site 40799735463](https://github.com/koviankevin/tflite-explorer/actions/runs/40799735463) 的 [原始切換](results/reference24-main-site-2026-10-29.zip)、[原始操作](results/reference24-main-native-2026-10-29.zip)及[獨立核對](results/reference24-main-native-review-2026-10-29.json)保留；六種切換、30 項原生操作、九種 runtime 情境與兩種 32px 原生鍵盤取消皆通過；optional-input custom OP 的表單保留、空參考／產生按鈕停用及原因文字也通過，沒有額外推論或下載。

[四關卡獨立核對](results/reference24-main-gates-review-2026-10-29.json)已驗 API／provider digest／ZIP CRC／原始政策與依賴指紋。Core 沿用未改動的 main 40700051621；新 browser 40799729271、contract 40799732347、site 40799735463 成功，不將 PR 綠燈當成可發布 main 證據。

[實體八輪程序核對](results/reference24-main-owned-review-2026-10-29.json)另驗原固定完整／局部模型 hash、權重／custom options、pattern 正負例、24 個模型與八個完整指紋 Workers。兩輪暖機後 RSS 漂移 10,633,216 bytes、斜率 3035721.143 bytes／輪，觀察到的 6 個 PID／start-ticks 身分正常關閉後全部退出，沒有強制清理。這是有限八輪／取樣證據，不當成新兩小時或其他引擎驗收。

上述是主分支候選及發布前證據，正式 Pages／固定 Release 仍須精確準備與發布後核對；不可先視為已部署。


## preview.24 正式交付

固定 [Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.24)／[正式站](https://koviankevin.github.io/tflite-explorer/)為 build `d0676e3b7609c608`，來源 `f9984335b7196eb066cbe85f44673de0dcd3b42f`／tree `101d8828ad52f91183515248e7dada85fbd96663`。準備 [40801429782](https://github.com/koviankevin/tflite-explorer/actions/runs/40801429782) 的[完整產物審閱](results/preview24-prepared-2026-10-29.json)及[獨立乾淨重建](results/preview24-rebuild-2026-10-29.json)通過，293 個核心檔案 manifest 與實際內容一致，再以精確 build／site ID 執行 [40802364346](https://github.com/koviankevin/tflite-explorer/actions/runs/40802364346)；四個工作全部在 attempt 1 成功。

[最終獨立核對](results/preview24-published-2026-10-29.json)核對原始 provider ZIP digest／CRC、job／來源／時段、正式站 1,376 檔 SHA／MIME、root 與權威 deployment，以及四份固定 Release 實際下載 bytes 全等於原準備包。正式站 30 項原生操作與九種相關情境通過；optional-only custom OP 複製後表單保留、空參考／亂數產生按鈕停用、原因文字正確，沒有額外推論或下載。37 個模型與四個 runtime Workers 全部關閉；原 raw .bin、CPU ADD／MUL、IO ZIP、型別範圍與取消／不支援等流程仍通過。

原始 ZIP：[正式站驗證](results/preview24-live-release-verification-2026-10-29.zip)、[Release 驗證](results/preview24-published-release-verification-2026-10-29.zip)。完整 [site manifest](results/preview24-site-manifest-2026-10-29.json) SHA `b385747a74dc13e46b6722ff1439ef4fa8544f177e23ee093df9f7d68dab7695`，site ID `0ed4da304bce56d8dbbb4f8ce9ae18bc86284fe14fcfee4c8e79fa66af194c9f`，固定部署 ZIP SHA `e78342b686841d77acef831199b40867974db4d0f46db1b27583c04b2c89c6a6`。保留 preview.23／preview.22 namespaces 及 legacy preview.7，既有固定 tag 不覆寫。

本輪只驗收外網公開合成資料；未測手機、公司模型或個人瀏覽器。其他 OS、完整螢幕閱讀器及數小時 runtime 等範圍仍見 [已知問題](known-issues.md)。

### 本機產物下載逾時紀錄

第一次本機審閱在下載完整網站 artifact 時觸及 120 秒的網路期限，只收到 7,798,784／28,996,258 bytes，沒有通過整份 ZIP 認證。[失敗紀錄](results/preview24-local-transfer-failure-2026-10-29.json)已移除本機工作路徑，原始未修改紀錄與不完整檔仍保留於本機。

[傳輸核對](results/preview24-local-transfer-review-2026-10-29.json)確認失敗資料等於後續完整且已認證 artifact 的 byte prefix；只將本機下載期限由 120 秒改成 600 秒，原來源、大小、provider digest、ZIP CRC、tar／部署包與資產檢查全部保留。對同一個成功準備 run／同一 artifact 做一次唯讀下載重試後完成審閱；沒有重跑 GitHub 工作流程、修改應用測試期限或重跑成功部署。
