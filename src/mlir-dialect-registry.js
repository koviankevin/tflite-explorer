// Internal builds replace the OUTPUT registry through --profile, not this file.
// Models and remote URLs never supply executable adapters.
import {validateDialectAdapters} from './mlir-dialect-contract.js?v=fc124b8183a7a475';
export const mlirDialects = validateDialectAdapters([]);
