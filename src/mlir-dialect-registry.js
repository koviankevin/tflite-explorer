// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=9b5c4d02768d6a08';
export const mlirDialects = validateDialectAdapters([]);
