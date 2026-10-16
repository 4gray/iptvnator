// Jest's ESM loader exposes a JSON module only as a default export, while the
// app imports `{ version }` from '@package' so esbuild can tree-shake the rest
// of package.json out of the bundle. This stub serves the real file's fields
// as named exports for tests.
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
    readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')
);

export const version = packageJson.version;
export default packageJson;
