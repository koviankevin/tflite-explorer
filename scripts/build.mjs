import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { fixture } from '../test/fixture.mjs';
await mkdir('dist', { recursive: true });
await cp('vendor', 'dist/vendor', { recursive: true });
await cp('src', 'dist/src', { recursive: true });
let html = await readFile('vendor/netron/index.html', 'utf8');
html = html.replace('<html lang="en">', '<html lang="zh-Hant">')
    .replace('<title>Netron</title>', '<title>TFLite 模型探索器</title>')
    .replace('Visualizer for neural network, deep learning and machine learning models.', '在本機搜尋 TFLite layers、tensors 與 operator 連接模式。')
    .replace("script-src 'self'; frame-src 'none'", "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'")
    .replace('<script type="text/javascript" src="index.js"></script>', '<script type="module" src="src/app.js"></script>\n<link rel="stylesheet" href="src/app.css">')
    .replaceAll('href="grapher.css"', 'href="vendor/netron/grapher.css"')
    .replaceAll('href="favicon.ico"', 'href="vendor/netron/favicon.ico"')
    .replaceAll('href="icon.png"', 'href="vendor/netron/icon.png"')
    .replace('<body class="welcome spinner">', `<body class="welcome">\n${await readFile('src/shell.html', 'utf8')}`);
// App styles must follow the retained Netron inline stylesheet.
html = html.replace('<link rel="stylesheet" href="src/app.css">', '').replace('</head>', '<link rel="stylesheet" href="src/app.css">\n</head>');
await writeFile('dist/index.html', html);
const translations = new Map([
    ['Node Properties', '節點詳細資料'], ['Tensor Properties', 'Tensor 詳細資料'], ['Connection Properties', '連接詳細資料'],
    ['Model Properties', '模型詳細資料'], ['Graph Properties', 'Subgraph 詳細資料'], ['Inputs', '輸入'], ['Outputs', '輸出'], ['Attributes', '屬性'],
    ['type', null], ['name', null], ['identifier', null]
]);
let view = await readFile('dist/vendor/netron/view.js', 'utf8');
for (const [en, zh] of translations) if (zh) view = view.replaceAll(`'${en}'`, `'${zh}'`);
await writeFile('dist/vendor/netron/view.js', view);
const demo = fixture({ graphCount: 2, repeats: 4 });
const buffer = new Uint8Array(demo.totalBytes); buffer.set(demo.data);
await writeFile('dist/demo.tflite', buffer);
await cp('vendor/netron/LICENSE', 'dist/LICENSE-Netron.txt');
console.log('Built dist/: local file processing, worker parsing, search and Netron diagrams.');
