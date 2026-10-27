// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=e67611582982ec3f';
export const mlirDialects = validateDialectAdapters([]);
