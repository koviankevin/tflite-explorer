export function modelFormat(name) {
    if (/\.(tflite|lite)$/i.test(name)) return 'tflite';
    if (/\.mlir$/i.test(name)) return 'mlir';
    throw new Error('請選擇 .tflite、.lite 或文字 .mlir 檔案。');
}
