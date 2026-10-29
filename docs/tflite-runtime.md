# TFLite 手動執行檢查

目前固定公開版為 [preview.28](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.28)／build `b1a823b72e94f81b`。新版示範原模型／編輯後 × 全 0／亂數四種 CPU 情境通過，並保留 14 種既有情境與實際 raw BIN／IO ZIP；一般讀取、編輯、匯出仍不自動推論。舊示範下載檔不會自動補參數，需重新開啟新版示範，見 [根因](demo-runtime.md)與[正式交付](contextual-model-editing.md#preview28-正式交付)。

開檔、編輯、一般匯出不會載入 interpreter，也不會自動跑推論。preview.28 的手動檢查位於編輯工作區，會使用原模型或草稿候選。開發中的 preview.29 將它拆成獨立「執行模型」工作區，只跑目前分頁已開啟的 TFLite；編輯／組合與局部模型必須先匯出並開啟，見[工作區契約](model-runtime-workspace.md)。兩版均由使用者指定 model inputs，再按「以這組輸入執行一次」啟動本機 LiteRT.js 2.6.0 CPU WASM。

每個 input 分別選零值、帶 seed／範圍的亂數或 raw `.bin`。面板顯示名稱、shape、dtype、所需 bytes；多輸入需逐項對應。raw 資料採 little-endian，byte 數須完全一致，沒有自動 dtype 轉換。boolean 限 0／1；量化資料使用原始整數值。零值指儲存值 0，不推測各 channel 的數學零點。索引、mask、token IDs 等有語意限制的輸入需由使用者提供有效資料，亂數不保證合法。

模型、測試資料、結果與診斷均留在本機；runtime JS／WASM 與網站一起封裝，無 CDN 或遠端模型服務。每次檢查使用獨立 Worker，完成、失敗、取消及 30 秒逾時均終止。可取消而保留草稿，取消不啟動下載。支援模型上限 128 MiB，保守估算 `3 × 檔案 + 2 × tensor bytes + 64 MiB` 限 512 MiB，輸入／輸出合計限 16 MiB。這是提前配置估算，**不是 kernel scratch 或整個瀏覽器 RSS 的硬上限**；大型模型仍可探索、編輯及匯出，應交給 native runtime 驗證。

結果分為通過、失敗、未能驗證。載入／編譯與執行分別記錄；有些 kernel 在第一次執行才配置／prepare，不能把成功載入當成成功執行。缺少 custom kernel、動態／未知 shape、不支援 dtype、資源超額、初始化失敗、取消或逾時不算通過。檢查涵蓋主 subgraph 與一組輸入，不宣稱所有 signatures、分支、迴圈路徑、精度或與原模型等價；失敗也須結合 runtime／輸入語意判讀。

「下載測試 input／output」保存 ZIP：`inputs-N.bin`、實際存在的 `outputs-N.bin`、`manifest.json`，含 dtype／shape、little-endian、資料來源／seed、執行狀態與候選模型標準 SHA-256（無 WebCrypto 時明確為 null）。執行失敗但已有 inputs 時可以保存部分記錄，沒有 outputs 會保持空清單。ZIP 不含模型或權重；每次只保留最近一次，改草稿、換 signature 選項或關閉模型後釋放。下載須由使用者按鈕操作。

同一份未變更的已檢查候選可直接匯出，報告包含該次實際狀態；一般匯出未跑 runtime 時保留未驗證，不把舊草稿的成功套用到新草稿。Runtime 失敗不禁止結構匯出，方便帶到公司 runtime 處理，報告仍保留失敗。

輸出 shape 推導目前涵蓋部分逐元素 unary、ADD／MUL／SUB／DIV 等 broadcast、SQUEEZE、單輸入且 options 固定的 RESHAPE。dtype／量化仍由參考 tensor 明確指定；未知、動態、per-axis 量化維度衝突或未實作的 OP 保留參考並顯示原因。舊 v1 編輯草稿未帶 `inferOutputs` 時維持原行為。

LiteRT 來源、精確 npm integrity、原始檔 hashes、Apache-2.0 LICENSE 與 NOTICE 保留於 `vendor/litert/2.6.0/`。公開 runtime 不包含公司的 custom kernels。此功能與公司 runtime 相容性、任意 builtin 組合皆可執行及整體商品等級完成是不同的驗收範圍。

本機實際 CPU WASM 已驗證 ADD 的 `[1,2] + [3,4] = [4,6]`、raw 多輸入、ZIP bytes，以及不合法 broadcast／output shape 的失敗。Hosted 原生選檔／下載、14 吋 32px、取消與正式部署證據尚待本次 CI；未完成前不列為已交付。

首次候選 [40697650768](https://github.com/koviankevin/tflite-explorer/actions/runs/40697650768) 的既有 29 項操作通過，但新 runtime 初始化失敗：部署來源格式白名單未複製 `.wasm`，請求取得 404 文字。保留失敗，不以 Node 原始碼成功代替打包後的瀏覽器成功。新增實際打包回歸在修正前以 ENOENT 失敗、修正後通過；產物 verifier 另拒絕刪去 WASM 後重新製作的完整 manifest。版本子路徑下的實際 Worker／官方 loader 也在 Node VM 以打包檔重現失敗，修正後成功執行；瀏覽器重測仍需取得後續證據。

## 候選驗收與發布證據

來源 `2b93eb536d0216e404115abd71a6bd6adac739b2`／tree `5ace35a2f605d91d144fe937691535c50f58a428`，公開候選 build `8b8cf831fe326d69`。本機乾淨來源重新建置得到相同 build，291 個檔案含固定 WASM。四個 main 手動關卡已由 provider／artifact digest／ZIP CRC／原始政策與來源 fingerprint 獨立核對，見 [完整收據](results/preview19-main-gates-2026-10-28.json)：core [40700051621](https://github.com/koviankevin/tflite-explorer/actions/runs/40700051621)、實體八輪 [40700040776](https://github.com/koviankevin/tflite-explorer/actions/runs/40700040776)、contract [40700046256](https://github.com/koviankevin/tflite-explorer/actions/runs/40700046256)、site [40700035612](https://github.com/koviankevin/tflite-explorer/actions/runs/40700035612)。

修正後 Hosted Chromium 的 [30 項原生操作](results/preview19-ui-fixed-2026-10-28.json)、[provider 核對](results/preview19-ui-fixed-2026-10-28-review.json)與 [原始 ZIP](results/preview19-ui-fixed-2026-10-28.zip)保留。新流程確實使用兩份 raw .bin：ADD 輸出 `[4,6]`、MUL 輸出 `[3,8]`，實際下載 ZIP 的 Python CRC、輸入／輸出 bytes、模型 SHA 與修改報告一致；三個 runtime Workers 全部關閉，取消與錯誤案例明確區分失敗／未驗證。一般匯出零 runtime Worker／零 runtime asset 請求；14 吋 1366×640／1280×640、32px 版面通過。完整舊功能與 MLIR SSA／控制流程仍通過，沒有測手機。

首次 [失敗原始報告](results/preview19-ui-initial-2026-10-28.json)、[provider 核對](results/preview19-ui-initial-2026-10-28-review.json)及 [原始 ZIP](results/preview19-ui-initial-2026-10-28.zip)保留，未以後續成功覆寫。上述仍是候選結果；正式部署、正式網址及固定 Release 尚待受控發布確認。兩小時長測獨立執行，不是本次部署前置條件。

## Signature 對應防護（preview.20 候選）

額外實際 CPU 測試確認：LiteRT 的預設 signature 可以指向 subgraph 1；同樣的 dtype／shape 不能證明正在檢查主 subgraph 0。因此僅接受沒有顯式 signatures，或唯一、完整且順序明確對應主 subgraph 0 的 signature；多 signatures、其他目標、部分介面、重排或重複名稱一律在讀取模型 body／啟動 WASM 前標為未能驗證。一般探索、編輯及結構匯出不受影響。後續可另外加入明確的 signature 選擇與 tensor 對應，但本版不猜測。

新回歸在修正前以錯誤的 eligible=true 失敗，修正後拒絕這些歧義且不讀 body；唯一主 signature 的實際 CPU 執行仍通過。preview.19 固定版本不覆寫，修正以 preview.20 另行發布；正式部署證據待補。

## Preview.19 固定發布與 preview.20 修正候選

Preview.19 已以來源 `9109ad74b02feb56c813205da1ba0f3a0e700111`／build `a417b012ff88996d` 固定發布；[40703563130](https://github.com/koviankevin/tflite-explorer/actions/runs/40703563130) 的 prepare／deploy／verify_live／release 全成功，attempt 1。[獨立正式核對](results/preview19-publication-review-2026-10-28.json)確認 1,336 檔及 root／MIME、30 項原生操作、35 個模型及三個 runtime Workers 關閉、四份實際 Release 下載與原準備 bytes 一致。後續發現的 signature 對應防護以新版本修正，未覆寫此固定 tag。

Preview.20 候選來源 `6894850777a03074132cc1feea6c932ef20adeba`／tree `a5719e28709067d44f24bd7cbc1f9414abb8f08c`，build `e4f6ad92496e19b0`、291 個核心檔。四關卡 [獨立 provider／digest／CRC／原始政策／相依核對](results/preview20-main-gates-2026-10-28.json)通過：core 沿用 [40700051621](https://github.com/koviankevin/tflite-explorer/actions/runs/40700051621)，其實際相依 fingerprint 未變；新 browser [40705658510](https://github.com/koviankevin/tflite-explorer/actions/runs/40705658510)、contract [40705665776](https://github.com/koviankevin/tflite-explorer/actions/runs/40705665776)、site [40705653002](https://github.com/koviankevin/tflite-explorer/actions/runs/40705653002)成功。

[原始候選操作](results/preview20-ui-candidate-2026-10-28.json)、[核對](results/preview20-ui-candidate-2026-10-28-review.json)與 [provider ZIP](results/preview20-ui-candidate-2026-10-28.zip)保留；30 項主檢查及六種 runtime 情境通過，新增跨 subgraph signature 明確未驗證且零新 runtime Worker，其他 raw .bin／IO ZIP／取消／錯誤／custom 情境維持。36 個模型及三個 runtime Workers 全部關閉，零 pageerror。這是新版候選證據，正式 preview.20 部署尚待受控發布確認；兩小時較早版本的長測另列，不冒充本來源的長測。

## Preview.20 正式交付

正式固定來源為 `dfe824290c02c9028d4d550132547714db5bb0e4`／tree `50bd00a70c0aa007681d2c3d33727e9ce14571a6`，build `198292d7511b0f2d`。[準備 40709384112](https://github.com/koviankevin/tflite-explorer/actions/runs/40709384112) 的 [完整 Pages tar／固定 ZIP 獨立核對](results/preview20-prepared-review-2026-10-28.json)成功後，以精確 build／site ID 執行 [發布 40710364198](https://github.com/koviankevin/tflite-explorer/actions/runs/40710364198)，prepare／deploy／verify_live／release 全成功，attempt 1。

[正式交付獨立核對](results/preview20-publication-review-2026-10-28.json)確認正式站 1,354 檔、root／MIME／所有 SHA 與原準備 snapshot 一致；30 項原生操作含六種 runtime 情境通過，36 個模型及三個 runtime Workers 關閉，八份編輯匯出收據與四份 [固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.20) 實際下載 bytes 均符合原準備包。部署權威 run／job／site ID 及獨立 root 也一致。

操作為「編輯模型」→ 右側「檢查能否執行（選用）」→ 每個 input 選 raw .bin、零值或亂數 → 手動執行 →「下載測試 input／output」。開檔、一般匯出不自動執行；資料仍全程本機。執行最多 30 秒，可取消；128 MiB 模型、16 MiB IO、custom kernel／動態 shape／signature 及精度限制仍適用。正式 14 吋 1366×640／1280×640、32px 流程已驗證；沒有測手機。
