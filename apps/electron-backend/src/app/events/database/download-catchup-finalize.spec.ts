import { archiveFileStats } from './download-catchup-stats';
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
import { existsSync, statSync } from 'node:fs';
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
    it('rejects a replacement during link promotion without deleting the unowned entry', async () => {
        const { reservation, identity } = await prepare();
        jest.mocked(link).mockImplementationOnce(async (from, to) => {
            await rename(from, join(directory, 'original'));
            await writeFile(from, 'untrusted bytes');
            await actualLink(from, to);
        });
        await expect(
            finalizeCatchupPartial(reservation, identity, identity.size)
        ).rejects.toThrow('changed');
        expect(await readFile(reservation.path, 'utf8')).toBe(
            'untrusted bytes'
        );
        expect(await readFile(reservation.partialPath, 'utf8')).toBe(
            'untrusted bytes'
        );
    });
    it('does not claim the identity of a destination replaced after link succeeds', async () => {
        const { reservation, identity } = await prepare();
        jest.mocked(link).mockImplementationOnce(async (from, to) => {
            await actualLink(from, to);
            await rename(to, join(directory, 'linked-original'));
            await writeFile(to, 'untrusted bytes');
        });
        await expect(
            finalizeCatchupPartial(reservation, identity, identity.size)
        ).rejects.toThrow('changed');
        expect(await readFile(reservation.path, 'utf8')).toBe(
            'untrusted bytes'
        );
        expect(await readFile(reservation.partialPath, 'utf8')).toBe(
            'validated bytes'
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
            ).resolves.toEqual({
                size: identity.size,
                identity: expect.objectContaining({
                    dev: expect.any(String),
                    ino: expect.any(String),
                }),
            });
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
        ).resolves.toEqual({
            size: identity.size,
            identity: expect.objectContaining({
                dev: expect.any(String),
                ino: expect.any(String),
            }),
        });
        expect(await readFile(reservation.path, 'utf8')).toBe(
            'validated bytes'
        );
        await expect(lstat(reservation.partialPath)).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });
    it.each(['hardlink', 'copy'])(
        'records write-ahead identity before %s can publish complete bytes',
        async (mode) => {
            const { reservation, identity } = await prepare();
            if (mode === 'copy')
                jest.mocked(link).mockRejectedValueOnce(
                    Object.assign(new Error('unsupported'), { code: 'ENOTSUP' })
                );
            let checkpoints = 0;
            await finalizeCatchupPartial(
                reservation,
                identity,
                identity.size,
                async (expected) => {
                    checkpoints++;
                    if (checkpoints === 1) {
                        expect(expected).toEqual(
                            expect.objectContaining({
                                dev: identity.dev,
                                ino: identity.ino,
                            })
                        );
                        await expect(
                            lstat(reservation.path)
                        ).rejects.toMatchObject({ code: 'ENOENT' });
                    } else {
                        const created = archiveFileStats(
                            await lstat(reservation.path)
                        );
                        expect(created).toEqual(
                            expect.objectContaining({
                                dev: expected.dev,
                                ino: expected.ino,
                                size: 0,
                            })
                        );
                    }
                }
            );
            expect(checkpoints).toBe(mode === 'copy' ? 2 : 1);
        }
    );
    it('never overwrites an occupied final destination', async () => {
        const { reservation, identity } = await prepare();
        await writeFile(reservation.path, 'keep me');
        await expect(
            finalizeCatchupPartial(reservation, identity, identity.size)
        ).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(reservation.path, 'utf8')).toBe('keep me');
    });
    it.each(['pause', 'cancel'])(
        'stops an in-progress fallback copy on %s',
        async () => {
            const { reservation } = await prepare();
            const bytes = Buffer.alloc(192 * 1024, 0x47);
            await writeFile(reservation.partialPath, bytes);
            const identity = await lstat(reservation.partialPath);
            jest.mocked(link).mockRejectedValueOnce(
                Object.assign(new Error('unsupported'), { code: 'ENOTSUP' })
            );
            let observedBytes = 0;
            await expect(
                finalizeCatchupPartial(
                    reservation,
                    identity,
                    bytes.length,
                    undefined,
                    () => {
                        observedBytes = existsSync(reservation.path)
                            ? statSync(reservation.path).size
                            : 0;
                        return observedBytes > 0;
                    }
                )
            ).rejects.toThrow('interrupted');
            expect(observedBytes).toBeGreaterThan(0);
            expect(observedBytes).toBeLessThan(bytes.length);
            expect(await readFile(reservation.partialPath)).toEqual(bytes);
            await expect(lstat(reservation.path)).rejects.toMatchObject({
                code: 'ENOENT',
            });
        }
    );
});
