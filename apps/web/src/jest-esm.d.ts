/**
 * Jest's ESM module-mocking API is not part of `@types/jest`, but the ESM
 * Jest workspace (`jest.web-esm.workspace.ts`) relies on it. The signature
 * mirrors `Jest['unstable_mockModule']` from `@jest/environment`.
 */
declare namespace jest {
    function unstable_mockModule<T = unknown>(
        moduleName: string,
        moduleFactory: () => T | Promise<T>,
        options?: { virtual?: boolean }
    ): typeof jest;
}
