import {
    link,
    lstat,
    mkdtemp,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    cleanupCatchupFile,
    cleanupCatchupPartial,
} from './download-catchup-cleanup';

jest.mock('node:fs/promises', () => {
    const actual = jest.requireActual('node:fs/promises');
    return {
        ...actual,
        rename: jest.fn(actual.rename),
        link: jest.fn(actual.link),
    };
});
const actual =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
let directory: string;
beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'archive-cleanup-'));
    jest.mocked(rename).mockReset().mockImplementation(actual.rename);
    jest.mocked(link).mockReset().mockImplementation(actual.link);
});
afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
});
async function prepare() {
    const path = join(directory, 'show.ts.part');
    await writeFile(path, 'archive');
    return { path, identity: await lstat(path) };
}
it('removes the captured owned entry and its empty quarantine', async () => {
    const { path, identity } = await prepare();
    await cleanupCatchupFile(path, identity);
    expect(await readdir(directory)).toEqual([]);
});
it('preserves a replacement at the public pathname after atomic capture', async () => {
    const { path, identity } = await prepare();
    jest.mocked(rename).mockImplementationOnce(async (from, to) => {
        await actual.rename(from, to);
        await writeFile(from, 'replacement');
    });
    await cleanupCatchupFile(path, identity);
    expect(await readFile(path, 'utf8')).toBe('replacement');
    expect(await readdir(directory)).toEqual(['show.ts.part']);
});
it('restores a replacement that arrives before atomic capture', async () => {
    const { path, identity } = await prepare();
    jest.mocked(rename).mockImplementationOnce(async (from, to) => {
        await actual.rename(from, join(directory, 'original'));
        await writeFile(from, 'replacement');
        await actual.rename(from, to);
    });
    await expect(cleanupCatchupFile(path, identity)).rejects.toThrow(
        'preserved an unrelated recovery file'
    );
    expect(await readFile(path, 'utf8')).toBe('replacement');
    expect(await readFile(join(directory, 'original'), 'utf8')).toBe('archive');
});
it.each(['EEXIST', 'ENOTSUP'])(
    'retains a captured replacement if restoring it fails with %s',
    async (code) => {
        const { path, identity } = await prepare();
        await actual.rename(path, join(directory, 'original'));
        await writeFile(path, 'replacement');
        jest.mocked(link).mockRejectedValueOnce(
            Object.assign(new Error('cannot restore'), { code })
        );
        const warning = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        try {
            await expect(cleanupCatchupFile(path, identity)).rejects.toThrow(
                'cannot restore'
            );
            const quarantine = (await readdir(directory)).find((entry) =>
                entry.startsWith('.iptvnator-cleanup-')
            );
            if (!quarantine)
                throw new Error('Expected a retained recovery directory');
            expect(
                await readFile(join(directory, quarantine, 'entry'), 'utf8')
            ).toBe('replacement');
            expect(warning).toHaveBeenCalled();
        } finally {
            warning.mockRestore();
        }
    }
);

it('preserves an unopened partial and removes it only with matching ownership', async () => {
    const { path } = await prepare();
    const final = path.slice(0, -'.part'.length);
    expect(await cleanupCatchupPartial(final, undefined)).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('archive');
    expect(await cleanupCatchupPartial(final, await lstat(path))).toBe(true);
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
});
