import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

describe('Stalker hash loader in NodeNext consumers', () => {
    it('resolves its dynamic imports in backend builds as well as browser builds', () => {
        const loaderPath = join(__dirname, 'stalker-protocol-hash.loader.ts');
        const { importedFiles } = ts.preProcessFile(
            readFileSync(loaderPath, 'utf8'),
            true
        );
        expect(importedFiles.length).toBeGreaterThan(0);

        for (const { fileName } of importedFiles) {
            const resolution = ts.resolveModuleName(
                fileName,
                loaderPath,
                {
                    module: ts.ModuleKind.NodeNext,
                    moduleResolution: ts.ModuleResolutionKind.NodeNext,
                },
                ts.sys,
                undefined,
                undefined,
                // import() uses ESM resolution even from a CommonJS file.
                ts.ModuleKind.ESNext
            );
            expect(resolution.resolvedModule).toBeDefined();
        }
    });
});
