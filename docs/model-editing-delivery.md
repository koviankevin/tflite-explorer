# preview.10 實際模型編輯交付

已部署 [正式網站](https://koviankevin.github.io/tflite-explorer/) 並發布 [固定 Release](https://github.com/koviankevin/tflite-explorer/releases/tag/v0.2.0-preview.10)，只更新 GitHub。功能包括圈選時 Alt＋拖曳平移、直接編輯所選 pattern 草稿、開啟本次匯出結果，以及 [TFLite／MLIR 實際 OP 編輯](model-editing.md)。原始模型保留，輸出成功後以新模型重新開啟。

凍結來源 `478f65d6afea0484d05c200d1d51d9ecc0d7079b`、tree `8d54d773fd9772faffc4b628eba74230718e4b6f`、build `f2591e6d3d458f9f`。四項 main 驗收及原始報告見 [最終來源驗收](model-editing.md#最終來源驗收)。文件／run 索引變更後，四項執行依賴 fingerprint 均一致；prepare 重新核對 GitHub API、provider digest、原始 policy 和乾淨候選重建，沒有以版本號或舊綠燈代替來源驗證。

[準備 40522228659](https://github.com/koviankevin/tflite-explorer/actions/runs/40522228659) 成功後，獨立下載 Pages tar 與四份固定交付資產，核對 digest、CRC、完整快照及 core ZIP；[準備審閱](results/preview10-prepared-review-2026-10-27.json) 通過。之後使用審閱過的確切 build／site ID 執行 [正式發布 40522876435](https://github.com/koviankevin/tflite-explorer/actions/runs/40522876435)，首次 attempt 的 prepare／deploy／verify_live／release 全部成功。

- [正式 HTTP 報告](results/preview10-live-http-2026-10-27.json)：1,246 檔逐檔 SHA／MIME 及無 query 的 root 核對通過。
- [正式原生操作報告](results/preview10-live-ui-2026-10-27.json)：16 項操作、21 個模型 Worker 關閉、八份實際修改模型及報告下載／重開通過。TFLite 三份保留資料的 byte ranges 比對通過；MLIR 五份沒有權重 ranges，明列 not-applicable，未宣稱 native compiler 執行。
- [固定 Release 報告](results/preview10-fixed-release-2026-10-27.json) 與 [獨立最終核對](results/preview10-publication-review-2026-10-27.json)：重新驗證實際成功 job 時段、artifact ID、attempt、provider digest／CRC／報告，並重新下載四份 Release 資產，與原準備 bytes 全部一致。

完整 site ID `b7c453c93b54b285f01b3cc8f51b1556b5b08215e0c448da4b6a10a833ea5e2b`；site manifest SHA-256 `8281506344e830688d12787c3cd074de13844edcf5a7ee1145dbd8852fa1f064`；root SHA-256 `508eadf54918c76f57049a0d30f67993acf03c0b7633ceea7f9066a34c2dc74d`。權威 deployment `7361415260`／job `122254781541`／attempt 1 與實際 live index、root 一致。保留 preview.9、preview.8 namespaces，永久 baseline 與原 root lazy-load 檔案繼續使用 preview.7，不能拿 root release.json 判斷現行版。

固定 ZIP `model-lens-public-0.2.0-preview.10-f2591e6d3d458f9f.zip` 為 29,538,925 bytes，SHA-256 `4093a71fff94593dad3f87d228db49d870c4497520a4f5e0a388378de8a5fea2`。原樣內網部署可用此 ZIP；有公司 profile／adapter 時固定同名 tag 後重新建置並驗收，不覆蓋私有擴充。包內文件記錄準備當時的階段；本頁保留後續正式部署證據，不重新產生或替換已發布的固定資產。

本輪全部使用公開合成資料和 hosted Linux Chromium。TFLite 新增以既有 OP 為範本；未提供任意 OP catalog／kernel shape inference，未執行推論或公司 dialect／custom kernel verifier。八輪大檔量測與桌面／手機 viewport 檢查不能代替長時間效能、實機、其他引擎或公司實模驗收；[商品等級目標](product-readiness.md) 仍進行中。
