# Custom OP 引用契約（開發中）

未知 custom options 可能包含原始 tensor／buffer 編號。公開版預設保留未知格式的所有編號及資料；模型、pattern 或草稿不能載入可執行 hook。契約只由公開核心的已審核註冊或受信任的內網建置提供。

預覽、切圖及組合匯出共用一個引用計畫。符合契約時保留原始 tensor／buffer table 編號，清除未引用 buffer 的 payload，未使用 tensor 對已清除資料的 buffer 連結改指向保留的空 buffer 0；options 原始 bytes 不重寫。被 options 引用的 tensor／buffer 及量化依賴會納入保留範圍；被隱含使用且沒有選取區內 producer／常數資料的值補為模型輸入。

任一 custom 的名稱／版本／格式不符、options 延遲或外部儲存、未知 metadata 或 legacy metadata 引用不明，整個選取區維持完整保留。已符合格式卻引用不存在的 tensor／buffer，會拒絕匯出並指出 subgraph、OP 與編號。保留模式不等於 custom kernel 已驗證。

## 公開已知格式

`TFLite_Detection_PostProcess` v1 的契約對照 TensorFlow 固定來源 [detection_postprocess.cc](https://github.com/tensorflow/tensorflow/blob/7bc5d217d3bd79426527d0055fd3b54812f52e93/tensorflow/lite/kernels/detection_postprocess.cc)：三個 tensor inputs、四個 outputs，options 僅接受官方的封閉 scalar 欄位清單。未識別欄位不猜測為無引用，而改為完整保留。

專用 FlexBuffers reader 不遞迴展開 vector／map／string，最多 64 KiB、64 個 scalar 欄位及 64-byte key，先檢查所有範圍／數量，拒絕不安全整數、非有限值、重複 key、未知型別與非法 offset。這只是保留引用的判定，不取代 shape／NMS 數值語意或 runtime 檢查。公開手動 interpreter 的既有 custom 限制不變。

## 內網擴充

沿用 [獨立 profile](intranet-release.md#公司-dialect-設定)，在受信任的 `dialects/index.js` 額外 export `tfliteCustomContracts`；既有只 export `mlirDialects` 的擴充仍相容。公開包不複製此目錄；內網包產物使用獨立 registry。模型不能提供或覆寫這個 export。

```js
export const mlirDialects = [];
export const tfliteCustomContracts = [{
  interfaceVersion: 1,
  customCode: 'company.public_example',
  versionMin: 1,
  versionMax: 1,
  coverage: 'local-ports-options-only',
  options: {
    format: 'fixed-u32-le',
    byteLength: 12,
    prefix: [80, 82, 69, 70],
    references: [
      { offset: 4, kind: 'tensor' },
      { offset: 8, kind: 'buffer', optional: true }
    ]
  }
}];
```

此例宣告固定 12-byte 格式、四個 magic bytes 與兩個 little-endian uint32 引用；`optional: true` 僅將 `0xffffffff` 當成沒有引用。各欄位不得重疊或超出 payload。可加 `inputCount`／`outputCount` 限制；名稱和版本範圍重疊、未知欄位或不相容 interface 會報錯。註冊最多 256 份契約，每份最多 128 個引用，設定會複製並凍結。

`coverage` 是擴充作者對實際 kernel 的完整聲明：除了列出的 ports、options 引用及標準 metadata，不能隱含讀取其他 tensor、buffer、operator、subgraph、外部檔案或未選取的狀態。核心只能檢查宣告格式及索引存在性，不能證明私有 kernel 遵守聲明；公司實際契約與 runtime 正負例留在內網驗收。沒有這項保證時不要註冊契約，維持完整保留。

## 驗收範圍

已增加小型正負例：明確與隱含引用、optional sentinel、不存在的引用、未知版本／prefix／metadata、外部 options、同名版本重疊、模型自帶註冊無效、量化依賴與預覽／實際 bytes。公開 Detection PostProcess 介面有切圖、組合、權重／options 保留及三次匯出重開；另以 2 MiB 未引用資料確認不會建立其 File slice。

打包後 Windows Chrome／Edge 在 1280×640、32px，以原生選檔測公開 Detection PostProcess → Reshape、未知版本及 custom 雙輸出 → Add；預覽、儲存 pattern、唯一匹配、下載切圖／報告及重開均有報告。公開流程已取得實際 exit 0；合成內網流程報告通過，但原工具輸出遺失且 handle 已不存在，未取得退出碼，不把報告冒充程序退出證據，也未重跑。沒有執行 custom runtime。

獨立讀取器重新驗證兩份建置的逐檔 manifest／來源，確認公開 JS／JSON 不含合成內網契約、內網包拒絕公開發布，並重新解析十二份下載檔，核對 ports、原編號、custom options、所有保留 buffer bytes 及報告的每段 provenance。公開已知格式由 527,304 bytes 降為 3,384 bytes；未知版本仍為 527,656 bytes；合成私有格式僅在帶契約的內網包縮至 3,608 bytes，公開包仍保留 1,052,192 bytes。各重開 pattern 均只有一筆；全部觀察到的 Workers 原生 close，無 pageerror 或 runtime 請求。

[階段收據](results/product-readiness-stage2.json)與[原始證據](results/product-readiness-stage2-originals.zip)保留失敗的單 OP 測例、修正後兩節點測例、模型、下載、報告、截圖、公開 kernel 來源及獨立檢查程式。原本單 OP 不符合既有 pattern 最少兩節點規則；只改測例，沒有放寬應用規則。仍待新版本正式關卡與部署。

本功能尚未發布，整體「商品等級」目標及 Windows 大模型記憶體等工作仍在進行。
