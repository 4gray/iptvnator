import {
    mkdtemp,
    lstat,
    link,
    readFile,
    rename,
    rm,
    writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeCatchupPartial } from './download-catchup-finalize';

jest.mock('node:fs/promises', () => {
    const actual = jest.requireActual('node:fs/promises');
    return { ...actual, link: jest.fn(actual.link) };
});
const actualLink =
    jest.requireActual<typeof import('node:fs/promises')>(
        'node:fs/promises'
    ).link;

describe('archive file promotion', () => {
    let directory: string;
    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'archive-promotion-'));
        jest.mocked(link).mockImplementation(actualLink);
    });
    afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
    });
    async function prepare() {
        const path = join(directory, 'show.ts');
        const reservation = {
            path,
            partialPath: path + '.part',
            filename: 'show.ts',
        };
        await writeFile(reservation.partialPath, 'validated bytes');
        const identity = await lstat(reservation.partialPath);
        return { reservation, identity };
    }
    it('rejects a same-sized replacement between transfer and promotion', async () => {
        const { reservation, identity } = await prepare();
        await rename(reservation.partialPath, join(directory, 'original'));
        await writeFile(reservation.partialPath, 'untrusted bytes');
        await expect(
            finalizeCatchupPartial(reservation, identity, identity.size)
        ).rejects.toThrow('changed');
        expect(await readFile(reservation.partialPath, 'utf8')).toBe(
            'untrusted bytes'
        );
        await expect(lstat(reservation.path)).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });
    it('rejects a replacement during link promotion without leaving a completed file', async () => {
        const { reservation, identity } = await prepare();
        jest.mocked(link).mockImplementationOnce(async (from, to) => {
            await rename(from, join(directory, 'original'));
            await writeFile(from, 'untrusted bytes');
            await actualLink(from, to);
        });
        await expect(
            finalizeCatchupPartial(reservation, identity, identity.size)
        ).rejects.toThrow('changed');
        await expect(lstat(reservation.path)).rejects.toMatchObject({
            code: 'ENOENT',
        });
        expect(await readFile(reservation.partialPath, 'utf8')).toBe(
            'untrusted bytes'
        );
    });
    it.each(['ENOTSUP', 'EACCES'])(
        'copies from the verified descriptor when hardlinks fail with %s',
        async (code) => {
            const { reservation, identity } = await prepare();
            jest.mocked(link).mockImplementationOnce(async (from) => {
                await rename(from, join(directory, 'original'));
                await writeFile(from, 'untrusted bytes');
                throw Object.assign(new Error('unsupported'), { code });
            });
            await expect(
                finalizeCatchupPartial(reservation, identity, identity.size)
            ).resolves.toBe(identity.size);
            expect(await readFile(reservation.path, 'utf8')).toBe(
                'validated bytes'
            );
            expect(await readFile(reservation.partialPath, 'utf8')).toBe(
                'untrusted bytes'
            );
        }
    );
    it('promotes the verified file and removes its partial', async () => {
        const { reservation, identity } = await prepare();
        await expect(
            finalizeCatchupPartial(reservation, identity, identity.size)
        ).resolves.toBe(identity.size);
        expect(await readFile(reservation.path, 'utf8')).toBe(
            'validated bytes'
        );
        await expect(lstat(reservation.partialPath)).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });
    it('never overwrites an occupied final destination', async () => {
        const { reservation, identity } = await prepare();
        await writeFile(reservation.path, 'keep me');
        await expect(
            finalizeCatchupPartial(reservation, identity, identity.size)
        ).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(reservation.path, 'utf8')).toBe('keep me');
    });
});
