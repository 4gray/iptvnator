import { join } from 'path';
import { pathToFileURL } from 'url';
import { resolveLocalEpgSourcePath } from './epg-local-source-path';

describe('resolveLocalEpgSourcePath', () => {
    const file = join(process.cwd(), 'epg', 'guide v2.xml.gz');

    it('maps a file URL and the plain path to the same normalized path', () => {
        expect(resolveLocalEpgSourcePath(pathToFileURL(file).href)).toBe(file);
        expect(resolveLocalEpgSourcePath(` ${file} `)).toBe(file);
        expect(
            resolveLocalEpgSourcePath(join(file, '..', 'guide v2.xml.gz'))
        ).toBe(file);
    });

    it('returns null for remote links, relative paths and empty values', () => {
        expect(
            resolveLocalEpgSourcePath('https://epg.example.org/guide.xml')
        ).toBeNull();
        expect(resolveLocalEpgSourcePath('epg/guide.xml')).toBeNull();
        expect(resolveLocalEpgSourcePath('')).toBeNull();
        expect(resolveLocalEpgSourcePath('file://')).toBeNull();
    });
});
