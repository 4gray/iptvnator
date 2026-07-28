import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { writeXtreamExclusiveArtifact } from './xtream-exclusive-artifact-writer';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(
        directories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true }))
    );
});

describe('Xtream exclusive artifact writer', () => {
    it('durably writes exact bytes and returns their receipt', async () => {
        const directory = await createDirectory();
        const path = join(directory, 'raw.json');
        const content = '{"safe":true}';

        const receipt = await writeXtreamExclusiveArtifact(path, content);

        assert.deepEqual(receipt, {
            absolutePath: path,
            bytes: Buffer.byteLength(content),
            sha256: sha256(content),
        });
        assert.equal(await readFile(path, 'utf8'), content);
    });

    it('never truncates or replaces an existing artifact', async () => {
        const directory = await createDirectory();
        const path = join(directory, 'raw.json');
        await writeFile(path, 'original', 'utf8');

        await assert.rejects(
            writeXtreamExclusiveArtifact(path, 'replacement'),
            /Xtream artifact path is not exclusively writable/
        );
        assert.equal(await readFile(path, 'utf8'), 'original');
    });

    it('rejects a final-component symlink and relative paths', async () => {
        const directory = await createDirectory();
        const target = join(directory, 'target.json');
        const alias = join(directory, 'alias.json');
        await writeFile(target, 'target', 'utf8');
        await symlink(target, alias);

        await assert.rejects(
            writeXtreamExclusiveArtifact(alias, 'replacement'),
            /Xtream artifact path is not exclusively writable/
        );
        await assert.rejects(
            writeXtreamExclusiveArtifact('relative.json', '{}'),
            /Xtream artifact path is not exclusively writable/
        );
        assert.equal(await readFile(target, 'utf8'), 'target');
    });

    it('rejects empty payloads before creating a file', async () => {
        const directory = await createDirectory();
        const path = join(directory, 'empty.json');

        await assert.rejects(
            writeXtreamExclusiveArtifact(path, ''),
            /Xtream artifact path is not exclusively writable/
        );
        await assert.rejects(readFile(path), { code: 'ENOENT' });
    });
});

async function createDirectory(): Promise<string> {
    const directory = await mkdtemp(
        join(tmpdir(), 'iptvnator-xtream-exclusive-')
    );
    directories.push(directory);
    return directory;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
