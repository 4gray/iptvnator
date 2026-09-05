import {
    mkdtempSync,
    mkdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
    readFileSync,
    lstatSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { selectLegacyProfile, copyLegacyIndexedDb } from './legacy-profile';

describe('packaged legacy profile compatibility', () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'iptvnator-profile-test-'));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));
    it('finds v0.19 storage before a fresh packaged renderer creates an empty database', () => {
        const legacy = join(root, 'electron-backend');
        mkdirSync(join(legacy, 'IndexedDB', 'file__0.indexeddb.leveldb'), {
            recursive: true,
        });
        expect(selectLegacyProfile(root, join(root, 'IPTVnator'))).toBe(legacy);
    });
    it('preserves an already used current profile, even when it contains no playlists', () => {
        mkdirSync(
            join(
                root,
                'electron-backend',
                'IndexedDB',
                'file__0.indexeddb.leveldb'
            ),
            { recursive: true }
        );
        const current = join(root, 'IPTVnator');
        mkdirSync(join(current, 'IndexedDB'), { recursive: true });
        expect(selectLegacyProfile(root, current)).toBeNull();
    });
    it('does not select an unrelated or absent profile', () => {
        expect(selectLegacyProfile(root, join(root, 'IPTVnator'))).toBeNull();
    });
    it('copies symlinked legacy storage into independent regular files', async () => {
        const legacy = join(root, 'legacy'),
            original = join(root, 'original');
        const snapshot = join(root, 'snapshot');
        mkdirSync(legacy);
        mkdirSync(original);
        writeFileSync(join(original, 'synthetic.ldb'), 'original data');
        symlinkSync(original, join(legacy, 'IndexedDB'), 'junction');
        await copyLegacyIndexedDb(legacy, snapshot);
        expect(lstatSync(join(snapshot, 'IndexedDB')).isSymbolicLink()).toBe(
            false
        );
        writeFileSync(
            join(snapshot, 'IndexedDB', 'synthetic.ldb'),
            'Chromium snapshot write'
        );
        expect(readFileSync(join(original, 'synthetic.ldb'), 'utf8')).toBe(
            'original data'
        );
    });
    it('keeps a current main-process config even before Chromium storage exists', () => {
        mkdirSync(
            join(
                root,
                'electron-backend',
                'IndexedDB',
                'file__0.indexeddb.leveldb'
            ),
            { recursive: true }
        );
        const current = join(root, 'IPTVnator');
        mkdirSync(current);
        writeFileSync(join(current, 'config.json'), '{}');
        expect(selectLegacyProfile(root, current)).toBeNull();
    });
});
