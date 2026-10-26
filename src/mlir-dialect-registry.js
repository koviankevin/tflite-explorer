// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=44c61533b3e74ddf';
export const mlirDialects = validateDialectAdapters([]);
