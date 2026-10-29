# 手動執行的鍵盤取消焦點

公開 preview.22 的「指定測試輸入」視窗以 Escape 取消後，草稿保持不變，但焦點落到 BODY；需要重新 Tab 找到原按鈕。[40792919821](https://github.com/koviankevin/tflite-explorer/actions/runs/40792919821) 在 Hosted Chromium 對固定正式 build `04aa44009821ed92` 重現，前面 29 項操作通過，沒有 page errors。取消前後沒有 runtime Worker／runtime 資源請求或新下載。

診斷來源為 `9b16be756c8164e6cb13504dbbabb3ad63740689`，只增加原生鍵盤回歸，正式應用與部署未改。[原始 provider ZIP](results/runtime-keyboard-original-failure-2026-10-29.zip)及[獨立核對](results/runtime-keyboard-original-failure-review-2026-10-29.json)保留 digest／CRC、job／來源／正式應用身分及原始錯誤；不把這次回歸失敗寫成原 30 項操作當時未通過。

候選 preview.23 在候選準備的 busy 狀態解除、按鈕重新啟用後，才將取消輸入的焦點回到「檢查能否執行」。使用 preventScroll 保留視角；仍要求同一代模型，reset／換模型後不回復過期焦點。只改取消輸入視窗的完成路徑，不更動推論、權重、資料上限或 Worker 行為。

回歸保留原 Escape 案例，並增加 1280×640／32px、鍵盤取消按鈕、草稿／圖形視角保留與零額外 Worker／下載檢查。已固定的 preview.19～preview.22 保留原驗收範圍，這個新焦點要求用於 preview.23 及後續版本；不覆寫舊固定版本。

## 候選驗收

[40793768468](https://github.com/koviankevin/tflite-explorer/actions/runs/40793768468)，來源 `a4ecbb470247e660841512a1b3dabfb8681022f3`／tree `6539da9af858b423d7d1113a81d5b85f201c3613`，乾淨來源重建的 build 為 `028d7e236780b7cd`。[獨立核對](results/runtime-keyboard-candidate-review-2026-10-29.json)已驗兩份原始 provider ZIP 的 digest／CRC、job／來源、完整候選版本及原始報告，前後來源不變。

六種隔離版本切換、30 項原生操作及八種 runtime 情境通過。1280×640／32px 下，Escape 與原生鍵盤取消按鈕皆返回已啟用的 `edit-runtime-check`，兩次草稿與圖形視角相同，沒有新增 interpreter Worker／資源請求或下載。後續 raw .bin、CPU ADD／MUL、實際 IO ZIP bytes、型別範圍拒絕、執行取消、kernel 錯誤、custom／signature 未驗證等原有檢查也通過；36 個模型與四個 runtime Workers 全部關閉，無 page errors。

原始 ZIP：[版本切換](results/runtime-keyboard-candidate-site-2026-10-29.zip)、[原生操作](results/runtime-keyboard-candidate-native-2026-10-29.zip)。這仍是 Hosted Linux Chromium 的合成候選驗收；主分支關卡及正式交付待完成，不將候選當成已部署，也不代表其他引擎或螢幕閱讀器已驗收。


## 主分支發布關卡

主分支來源 `6e5a497250dcab3e48b4af4a7793585ef2876ef8`／tree `2a506d9f3cd09f1143b4e5d33ef5984dbd4d49bb` 與候選完整 tree 一致；乾淨重建為 build `4c6780f635f45935`。main [site 40794531713](https://github.com/koviankevin/tflite-explorer/actions/runs/40794531713) 的 [原始切換](results/runtime23-main-site-2026-10-29.zip)、[原始操作](results/runtime23-main-native-2026-10-29.zip)及[獨立核對](results/runtime23-main-native-review-2026-10-29.json)保留；六種切換、30 項原生操作、八種 runtime 情境與兩種 32px 原生鍵盤取消皆通過。

[四關卡獨立核對](results/runtime23-main-gates-review-2026-10-29.json)已驗 API／provider digest／ZIP CRC／原始政策與依賴指紋。Core 沿用未改動的 main 40700051621；新 browser 40794523540、contract 40794528046、site 40794531713 成功，不將 PR 綠燈當成可發布 main 證據。

[實體八輪程序核對](results/runtime23-main-owned-review-2026-10-29.json)另驗原固定完整／局部模型 hash、權重／custom options、pattern 正負例、24 個模型與八個完整指紋 Workers。兩輪暖機後 RSS 漂移 6,291,456 bytes、斜率 2926416.457 bytes／輪，觀察到的 6 個 PID／start-ticks 身分正常關閉後全部退出，沒有強制清理。這是有限八輪／取樣證據，不當成新兩小時或其他引擎驗收。

上述是主分支候選及發布前證據，正式 Pages／固定 Release 仍須精確準備與發布後核對；不可先視為已部署。


## preview.23 正式交付

固定 [Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.23)／[正式站](https://koviankevin.github.io/tflite-explorer/)為 build `3cc83fdeb25322bb`，來源 `94af79132ee37bc11219ab87b458d5664c434b34`／tree `8cd81df05d574fbefd0dc714a7f8ef166d9638d8`。準備 [40796409594](https://github.com/koviankevin/tflite-explorer/actions/runs/40796409594) 的[原始產物審查](results/preview23-prepared-2026-10-29.json)及[獨立乾淨重建](results/preview23-rebuild-2026-10-29.json)通過，完整核心 manifest 與 293 檔內容一致，再以精確 build／site ID 執行 [40796884645](https://github.com/koviankevin/tflite-explorer/actions/runs/40796884645)。prepare／deploy／verify_live／release 全在 attempt 1 成功，沒有重跑。

[最終獨立核對](results/preview23-published-2026-10-29.json)在凍結來源上下載原始 provider ZIP，重驗 digest／CRC、job／attempt／時段、正式站 1,375 檔 SHA／MIME、root 與權威 deployment。正式站 30 項操作與八種 runtime 情境通過；Escape 及原生鍵盤取消按鈕於 1280×640／32px 皆返回啟用的原按鈕，草稿與視角保持，零新增推論／下載。36 個模型與四個 runtime Workers 全部關閉；原始 raw .bin、CPU ADD／MUL、實際 IO ZIP／bytes 與錯誤／取消／不支援狀態保留。四份實際固定 Release 下載均與原準備 bytes 完全一致。

原始 provider ZIP：[正式站驗證](results/preview23-live-release-verification-2026-10-29.zip)、[Release 驗證](results/preview23-published-release-verification-2026-10-29.zip)。完整 [site manifest](results/preview23-site-manifest-2026-10-29.json) SHA 為 `bf0dbddaf192f3ecc0b12a8d98a32cb0cffb67b1cd3b85b500455c380be7417a`，site ID `c128cb85bc1b80b9fd3ebcbf508734a52537f89f0af58e55bd40c0fabc18e920`，部署 ZIP SHA `5b2e7ee7370e68449d7350d6500a58ee8a45e26601fbafee8dcceb08b4295b2f`。保留 preview.22／preview.21 namespaces 及 legacy preview.7；既有固定 tag 不覆寫。

本輪只驗外網公開合成資料，未啟動個人瀏覽器、未測手機或公司模型，也不把取消視窗的焦點修正說成所有鍵盤／螢幕閱讀器、所有 OS 或數小時 runtime 驗收完成。
