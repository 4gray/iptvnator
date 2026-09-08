import { type BigIntStats } from 'node:fs';
import { archiveFileStats } from './download-catchup-stats';
import {
    archiveFileIdentity,
    sameArchiveFileIdentity,
} from './download-catchup-output';
import { parseArchiveFinalization } from './download-catchup-journal';

function stats(ino: string) {
    return archiveFileStats({
        dev: BigInt(1),
        ino: BigInt(ino),
        birthtimeMs: BigInt(1000),
        birthtimeNs: BigInt('1000123456'),
        size: BigInt(188),
        nlink: BigInt(1),
        isFile: () => true,
    } as BigIntStats);
}
it('round-trips 64-bit Windows file references without losing ownership proof', () => {
    const file = stats('18446744073709551000');
    const identity = archiveFileIdentity(file);
    const proof = parseArchiveFinalization(
        JSON.stringify({
            version: 1,
            phase: 'transfer',
            filePath: '/archive.ts',
            partialIdentity: identity,
        })
    );
    expect(proof?.partialIdentity.ino).toBe('18446744073709551000');
    expect(sameArchiveFileIdentity(file, proof!.partialIdentity)).toBe(true);
    expect(identity.birthtimeMs).toBe(1000.123456);
});
it('distinguishes adjacent file references that collide when converted to Number', () => {
    const a = stats('18446744073709551000');
    const b = stats('18446744073709551001');
    expect(Number(a.ino)).toBe(Number(b.ino));
    expect(sameArchiveFileIdentity(a, b)).toBe(false);
});

it('rejects already-rounded numeric ownership evidence', () => {
    const rounded = {
        dev: 1,
        ino: Number('18446744073709551000'),
        birthtimeMs: 1000,
    };
    expect(sameArchiveFileIdentity(rounded, rounded)).toBe(false);
    expect(() => archiveFileIdentity(rounded)).toThrow(
        'identity is unavailable'
    );
});
