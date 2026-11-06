import { suggestXtreamFromUrl } from './url-xtream-suggestion';

describe('suggestXtreamFromUrl', () => {
    it.each([
        ['secret!', 'secret!'],
        ["sec'ret", "sec'ret"],
        ['secret.', 'secret.'],
        ['secret%23', 'secret#'],
        ['p%2Bss', 'p+ss'],
        ['Ｓecret!', 'Ｓecret!'],
    ])(
        'preserves URL credentials without prose cleanup: %s',
        (encoded, password) => {
            expect(
                suggestXtreamFromUrl(
                    `https://panel.example/get.php?username=alice&password=${encoded}`
                )
            ).toMatchObject({
                username: 'alice',
                password,
            });
        }
    );

    it('preserves punctuation and Unicode in usernames', () => {
        expect(
            suggestXtreamFromUrl(
                "https://panel.example/get.php?username=Ａli'ce&password=secret!"
            )
        ).toMatchObject({
            username: "Ａli'ce",
            password: 'secret!',
        });
    });

    it('recognizes a provider link while preserving the server path, port and decoded credentials', () => {
        expect(
            suggestXtreamFromUrl(
                'https://panel.example:8443/base/get.php?username=alice%2Btv&password=p%26ss&type=m3u_plus&output=ts'
            )
        ).toMatchObject({
            kind: 'xtream',
            serverUrl: 'https://panel.example:8443/base',
            username: 'alice+tv',
            password: 'p&ss',
        });
    });

    it.each([
        '',
        'not a URL',
        'ftp://panel.example/get.php?username=a&password=b',
        'https://a:b@panel.example/get.php?username=a&password=b',
        'https://panel.example/list.m3u?username=a&password=b',
        'https://panel.example/download?username=a&password=b',
        'https://panel.example/get.php?username=a',
        'https://panel.example/get.php?username=a&password=',
        'https://panel.example/get.php?username=a&username=b&password=c',
        'https://panel.example/get.php?username=a&password=b&password=c',
        'https://panel.example/get.php?username=a&password=b&token=required',
        'https://panel.example/get.php?username=a&password=b#provider-token',
    ])('keeps unsupported or ambiguous links on the M3U path: %s', (url) => {
        expect(suggestXtreamFromUrl(url)).toBeNull();
    });
});
