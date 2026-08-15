import {
    detectProviderImportCandidates,
    ProviderImportCandidate,
} from './provider-import-detection.util';

describe('detectProviderImportCandidates', () => {
    const only = (
        candidates: ProviderImportCandidate[],
        kind: ProviderImportCandidate['kind']
    ) => candidates.filter((candidate) => candidate.kind === kind);

    it('returns nothing for empty or blank input', () => {
        expect(detectProviderImportCandidates('')).toEqual([]);
        expect(detectProviderImportCandidates('   \n\t ')).toEqual([]);
        expect(
            detectProviderImportCandidates(undefined as unknown as string)
        ).toEqual([]);
    });

    it('returns nothing for prose without credentials or links', () => {
        expect(
            detectProviderImportCandidates(
                'Hello! Thanks for your purchase, enjoy the service.'
            )
        ).toEqual([]);
    });

    describe('xtream detection', () => {
        it('detects a get.php URL and mines the credentials from its query', () => {
            const candidates = detectProviderImportCandidates(
                'Your playlist: http://tv.example.com:8080/get.php?username=alice&password=s3cret&type=m3u_plus&output=ts'
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                confidence: 'high',
                serverUrl: 'http://tv.example.com:8080',
                username: 'alice',
                password: 's3cret',
                suggestedTitle: 'tv.example.com',
            });
        });

        it('offers a get.php link with credentials as a low-ranked plain M3U too', () => {
            const candidates = detectProviderImportCandidates(
                'http://tv.example.com:8080/get.php?username=alice&password=s3cret&type=m3u_plus'
            );

            const m3u = only(candidates, 'm3u-url');
            expect(m3u).toHaveLength(1);
            expect(m3u[0].confidence).toBe('low');
            expect(m3u[0].url).toBe(
                'http://tv.example.com:8080/get.php?username=alice&password=s3cret&type=m3u_plus'
            );
        });

        it('combines a bare player_api.php URL with labeled credentials', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'Server: http://panel.example.org/player_api.php',
                    'Username: bob',
                    'Password: hunter2',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                confidence: 'high',
                serverUrl: 'http://panel.example.org',
                username: 'bob',
                password: 'hunter2',
            });
        });

        it('leans xtream for labeled username+password with a labeled host and port', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'Host: super.tv',
                    'Port: 8080',
                    'User: carol',
                    'Pass: pa55w0rd',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                confidence: 'medium',
                serverUrl: 'http://super.tv:8080',
                username: 'carol',
                password: 'pa55w0rd',
                suggestedTitle: 'super.tv',
            });
        });

        it('still proposes xtream from a credential pair with no server at all', () => {
            const candidates = detectProviderImportCandidates(
                'login: dave\nпароль: qwerty123'
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0].confidence).toBe('low');
            expect(xtream[0].username).toBe('dave');
            expect(xtream[0].password).toBe('qwerty123');
            expect(xtream[0].serverUrl).toBeUndefined();
        });

        it('understands Russian labels', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'Сервер: http://ru.example.net:2500',
                    'Логин: ivan',
                    'Пароль: secret42',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                serverUrl: 'http://ru.example.net:2500',
                username: 'ivan',
                password: 'secret42',
            });
        });

        it('reads decorated reseller messages (math-alphabet labels, arrow separators)', () => {
            // Real-world shape: labels dressed in Unicode math monospace to
            // slip past chat spam filters, ➤ as the separator, ├◉ decoration.
            const candidates = detectProviderImportCandidates(
                [
                    '◉𝙿𝙾𝚁𝚃𝙰𝙻➤ http://tv.example.nl:80/',
                    '├◉𝚄𝚂𝙴𝚁➤ 6b13aa64d3',
                    '├◉𝙿𝙰𝚂𝚂➤ 602bb462ab75',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                serverUrl: 'http://tv.example.nl',
                username: '6b13aa64d3',
                password: '602bb462ab75',
            });
        });

        it.each([
            ['arrow', 'USER ➤ carol\nPASS ➤ pa55'],
            ['triangle', 'User ► carol\nPass ► pa55'],
            ['unicode arrow', 'login → carol\npassword → pa55'],
            ['ascii gt', 'USER > carol\nPASS > pa55'],
            ['spaced dash', 'User - carol\nPass - pa55'],
        ])(
            'accepts the %s label separator',
            (_variant, message) => {
                const xtream = only(
                    detectProviderImportCandidates(message),
                    'xtream'
                );
                expect(xtream).toHaveLength(1);
                expect(xtream[0].username).toBe('carol');
                expect(xtream[0].password).toBe('pa55');
            }
        );

        it('folds negative-circled font labels (🅤🅢🅔🅡 / 🅟🅐🅢🅢) and reads the get.php line', () => {
            // Verbatim reseller message: negative-circled capitals NFKC does
            // not fold, ➤➤ separators, and a "🅜➌🅤 🅛🅘🅢🅣" (M3U LIST) get.php
            // line whose query is the authoritative credential source.
            const candidates = detectProviderImportCandidates(
                [
                    '╭● 🅤🅡🅛 ➤➤ http://raztv.online:80',
                    '├● 🅤🅢🅔🅡 ➤➤ 94U19T3EAQ68DAP',
                    '├● 🅟🅐🅢🅢 ➤➤ 6uU3DX7OP5',
                    '╰● 🅜➌🅤 🅛🅘🅢🅣 ➤➤ http://raztv.online:80/get.php?username=94U19T3EAQ68DAP&password=6uU3DX7OP5&type=m3u_plus',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                serverUrl: 'http://raztv.online',
                username: '94U19T3EAQ68DAP',
                password: '6uU3DX7OP5',
            });
        });

        it('folds regional-indicator fancy text but leaves real flag emoji alone', () => {
            // 🇺🇸🇪🇷 / 🇵🇦🇸🇸 are runs of 3+ regional indicators — fancy text
            // for USER / PASS. 🇹🇷 is a run of exactly two — a real flag that
            // must not fold, or the glued "TR" would break the PORT label's
            // word boundary.
            const candidates = detectProviderImportCandidates(
                [
                    'Server: iptv.example.tv',
                    '🇹🇷PORT: 8080',
                    '🇺🇸🇪🇷 : carol',
                    '🇵🇦🇸🇸 : pa55',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                serverUrl: 'http://iptv.example.tv:8080',
                username: 'carol',
                password: 'pa55',
            });
        });

        it('does not read a hyphenated word as a labeled value', () => {
            expect(
                detectProviderImportCandidates(
                    'Our user-friendly setup takes a minute.'
                )
            ).toEqual([]);
        });

        it('reads an email-shaped username and ignores stats lines (corpus #1)', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'http://lordstreams.live:80',
                    'User=mszala@comcast.net',
                    'Pass=0323910031',
                    '30602 channels',
                    'Validity 27/12/26',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                serverUrl: 'http://lordstreams.live',
                username: 'mszala@comcast.net',
                password: '0323910031',
            });
        });

        it('reads the bare "URL, token, token" handout shape (corpus #2)', () => {
            const candidates = detectProviderImportCandidates(
                'http://alltvmx.com\nVictoria89\nVictoria89'
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                confidence: 'low',
                serverUrl: 'http://alltvmx.com',
                username: 'Victoria89',
                password: 'Victoria89',
            });
        });

        it('does not read prose around a lone URL as bare credentials', () => {
            expect(
                detectProviderImportCandidates(
                    'check out http://example.com\nsee the attached guide\nthanks again'
                )
            ).toEqual([]);
        });

        it('handles indented labels and numeric credentials (corpus #4)', () => {
            const candidates = detectProviderImportCandidates(
                'http://eliplay.onl:8089\nUser: 111\n Pass: 111'
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                serverUrl: 'http://eliplay.onl:8089',
                username: '111',
                password: '111',
            });
        });

        it('prefers the get.php line of a full panel dump (corpus #5)', () => {
            const candidates = detectProviderImportCandidates(
                [
                    '𝙋𝙤𝙧𝙩𝙖𝙡 : http://31.43.191.125',
                    '• 𝘾𝙧𝙚𝙖𝙩𝙚𝙙 : 09/02/2026',
                    '• 𝙀𝙭𝙥 : 10/02/2027',
                    '• 𝙐𝙨𝙚𝙧 : vip6001770656088',
                    '• 𝙋𝙖𝙨𝙨 : c394e34a0504',
                    '• 𝘾𝙤𝙣𝙣 : 1',
                    '• 𝙈𝙖𝙭𝘾𝙤𝙣𝙣 : 1',
                    '• 𝙋𝙤𝙧𝙩 : 8080',
                    '• 𝙎𝙩𝙖𝙩𝙪𝙨 : # OK ✅',
                    '• 𝐌𝟑𝐔 : http://31.43.191.125:8080/get.php?username=vip6001770656088&password=c394e34a0504&type=m3u',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0]).toMatchObject({
                confidence: 'high',
                serverUrl: 'http://31.43.191.125:8080',
                username: 'vip6001770656088',
                password: 'c394e34a0504',
            });
        });

        it('completes a port-less labeled portal URL with the labeled port', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'Portal : http://panel.example.io',
                    'Port : 8080',
                    'User : u1',
                    'Pass : p1',
                ].join('\n')
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream[0].serverUrl).toBe('http://panel.example.io:8080');
        });

        it('treats credentials in the query of a generic URL as xtream', () => {
            const candidates = detectProviderImportCandidates(
                'http://portal.example.io/api?username=eve&password=pw&foo=bar'
            );

            const xtream = only(candidates, 'xtream');
            expect(xtream).toHaveLength(1);
            expect(xtream[0].username).toBe('eve');
            expect(xtream[0].password).toBe('pw');
        });
    });

    describe('stalker detection', () => {
        it('pairs a MAC with a portal-shaped URL at high confidence', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'Portal: http://stb.example.com/stalker_portal/c/',
                    'MAC: 00:1A:79:12:34:56',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0]).toMatchObject({
                confidence: 'high',
                portalUrl: 'http://stb.example.com/stalker_portal/c/',
                macAddress: '00:1A:79:12:34:56',
                suggestedTitle: 'stb.example.com',
            });
        });

        it('accepts /c/ and portal.php shaped URLs as portals', () => {
            for (const url of [
                'http://p.example.com/c/',
                'http://p.example.com/portal.php',
                'http://p.example.com/server/load.php',
            ]) {
                const candidates = detectProviderImportCandidates(
                    `${url}\n00-1A-79-AB-CD-EF`
                );
                const stalker = only(candidates, 'stalker');
                expect(stalker[0]?.portalUrl).toBe(url);
                expect(stalker[0]?.confidence).toBe('high');
            }
        });

        it('falls back to a generic URL at medium confidence', () => {
            const candidates = detectProviderImportCandidates(
                'http://somehost.example.net/tv\nmac: 00:1a:79:aa:bb:cc'
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0].confidence).toBe('medium');
            expect(stalker[0].portalUrl).toBe('http://somehost.example.net/tv');
            expect(stalker[0].macAddress).toBe('00:1A:79:AA:BB:CC');
        });

        it('proposes a low-confidence stalker candidate for a lone MAC', () => {
            const candidates = detectProviderImportCandidates(
                'Ваш MAC 00:1A:79:00:11:22 активирован'
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0].confidence).toBe('low');
            expect(stalker[0].portalUrl).toBeUndefined();
        });

        it('recognizes a bare Infomir MAC but not a bare foreign 12-hex run', () => {
            const infomir = detectProviderImportCandidates('mac 001a79deadbe');
            expect(only(infomir, 'stalker')).toHaveLength(1);
            expect(only(infomir, 'stalker')[0].macAddress).toBe(
                '00:1A:79:DE:AD:BE'
            );

            const foreign = detectProviderImportCandidates(
                'token aabbccddeeff issued'
            );
            expect(only(foreign, 'stalker')).toHaveLength(0);
        });

        it('accepts a labeled non-Infomir MAC', () => {
            const candidates = detectProviderImportCandidates(
                'MAC: A0:B1:C2:D3:E4:F5\nhttp://p.example.com/c/'
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0].macAddress).toBe('A0:B1:C2:D3:E4:F5');
        });

        it('captures serial, device IDs and signatures', () => {
            const deviceId1 = 'a'.repeat(64);
            const deviceId2 = 'b'.repeat(64);
            const signature1 = 'c'.repeat(64);
            const signature2 = 'd'.repeat(64);
            const candidates = detectProviderImportCandidates(
                [
                    'Portal: http://stb.example.com/c/',
                    'MAC: 00:1A:79:12:34:56',
                    'Serial Number: 0123456789AB',
                    `Device ID: ${deviceId1}`,
                    `Device ID 2: ${deviceId2}`,
                    `Signature: ${signature1}`,
                    `Signature 2: ${signature2}`,
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker[0]).toMatchObject({
                serialNumber: '0123456789AB',
                deviceId1,
                deviceId2,
                signature1,
                signature2,
            });
        });

        it('rejects non-hex device IDs and signatures instead of guessing', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'MAC: 00:1A:79:12:34:56',
                    'Device ID: see-attachment',
                    'Signature: n/a',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker[0].deviceId1).toBeUndefined();
            expect(stalker[0].signature1).toBeUndefined();
        });

        it('does not read a MAC out of a 64-hex device ID blob', () => {
            const candidates = detectProviderImportCandidates(
                `device id: ${'001a79'.repeat(10)}aabb`
            );

            expect(only(candidates, 'stalker')).toHaveLength(0);
        });

        it('produces one candidate per MAC when several are handed out', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'http://multi.example.com/c/',
                    '00:1A:79:11:11:11',
                    '00:1A:79:22:22:22',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(2);
            expect(stalker.map((candidate) => candidate.macAddress)).toEqual([
                '00:1A:79:11:11:11',
                '00:1A:79:22:22:22',
            ]);
        });

        it('reads a dual "DEVICE ID=> 1&2 <hex>" line into both device slots and "S N" as serial', () => {
            const deviceHex =
                'FCE5A3B00FA5E2B9207E23FC205536314200BEE0FB2FCF0608FB97B6C7337E7F';
            const candidates = detectProviderImportCandidates(
                [
                    'http://tv.saartv.cc/stalker_portal/c',
                    'MAC=> 00:1A:79:00:E3:C9',
                    'EXP=> 2030-01-13',
                    'MAX => 10000',
                    'ADULT PASS=> 7700',
                    'S N=> F2DD20855EE0C',
                    `DEVICE ID=> 1&2 ${deviceHex}`,
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0]).toMatchObject({
                portalUrl: 'http://tv.saartv.cc/stalker_portal/c',
                macAddress: '00:1A:79:00:E3:C9',
                serialNumber: 'F2DD20855EE0C',
                deviceId1: deviceHex,
                deviceId2: deviceHex,
            });
            // The parental-control PIN is not the account password.
            expect(stalker[0].password).toBeUndefined();
        });

        it('reads a Turkish-labeled decorated portal message', () => {
            const candidates = detectProviderImportCandidates(
                [
                    '⚙️➤System : MediaHack Pro v7.7 (MAC)',
                    '🔌➤Portal Type : Stalker / XUI (/c/)',
                    '✅➤Tarama Zamanı: 2026-03-05 13:28:23',
                    '🌍➤Portal : http://b1.jinbox.nl:80/c/',
                    '🆔➤MAC ADRESİ: 00:1A:79:B4:EB:EB',
                    '📆➤Son Tarih : Süresiz',
                    '🖥➤Plan : MAG/MAC',
                    '🔊➤ɢᴏʀᴜɴᴛᴜ: Var 👍',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0]).toMatchObject({
                portalUrl: 'http://b1.jinbox.nl:80/c/',
                macAddress: '00:1A:79:B4:EB:EB',
            });
        });

        it('reads a scanner dump with Real/Panel URLs and bold-italic labels (corpus #3)', () => {
            const candidates = detectProviderImportCandidates(
                [
                    '├○ 𝑹𝒆𝒂𝒍 ➤ http://main.light-ott.net:80/c/',
                    '├○ 𝑷𝒂𝒏𝒆𝒍 ➤ http://main.light-ott.net/c/',
                    '├○ 𝑴𝒂𝒄 ➤ 00:1A:79:f5:cd:04',
                    '├○ 𝑷𝒂𝒏𝒆𝒍 𝑻𝒚𝒑𝒆 ➤ portal.php',
                    '├○ 𝑬𝒙𝒑 ➤ July 26, 2027, 12:41 pm',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0]).toMatchObject({
                confidence: 'high',
                portalUrl: 'http://main.light-ott.net:80/c/',
                macAddress: '00:1A:79:F5:CD:04',
            });
        });

        it('produces one candidate per MAC of a multi-account list (corpus #6)', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'http://mag.tivi-one-iptv.net/c/',
                    '00:1A:79:61:31:34  13/01/2027',
                    '00:1A:79:9C:E8:78  31/12/2027 (513 Days)',
                    '00:1A:79:A0:E3:66  18/08/2027 (378 Days)',
                    '00:1A:79:AD:85:3E  16/08/2027 (377 Days)',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(4);
            expect(
                stalker.every(
                    (candidate) =>
                        candidate.portalUrl === 'http://mag.tivi-one-iptv.net/c/'
                )
            ).toBe(true);
            expect(stalker.map((candidate) => candidate.macAddress)).toEqual([
                '00:1A:79:61:31:34',
                '00:1A:79:9C:E8:78',
                '00:1A:79:A0:E3:66',
                '00:1A:79:AD:85:3E',
            ]);
        });

        it('reads separator-less SN and a decorated ¹💥² dual device ID (corpus #8)', () => {
            const deviceHex =
                'AD8D35940A3FA14EA07451780224114F276D0F3BB4427E5351436F60ED6BF0BA';
            const candidates = detectProviderImportCandidates(
                [
                    'http://tv.saartv.cc/stalker_portal/c/',
                    'Mac 00:1a:79:01:07:06',
                    '𝐄𝐗𝐏 𝐃𝐚𝐭𝐞 2026-08-07',
                    '🔥 🆅🅿️🅽 Toronto',
                    '𝐒𝐍 38415545307A3',
                    `𝐃𝐞𝐯𝐢𝐜𝐞𝐈𝐃 ¹💥² ${deviceHex}`,
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0]).toMatchObject({
                portalUrl: 'http://tv.saartv.cc/stalker_portal/c/',
                macAddress: '00:1A:79:01:07:06',
                serialNumber: '38415545307A3',
                deviceId1: deviceHex,
                deviceId2: deviceHex,
            });
        });

        it('ignores scanner footers and status prose around a portal (corpus #9)', () => {
            const candidates = detectProviderImportCandidates(
                [
                    '├○ 𝑺𝒄𝒂𝒏𝒏𝒆𝒅 𝑩𝒚 ➤ ★☆★ 𝓜𝓲𝓱𝓪𝓳𝓵𝓸 𝓘𝓿𝓲𝓬 ★☆★',
                    '├○ 𝑺𝒄𝒂𝒏 𝑫𝒂𝒕𝒆 / 𝑻𝒊𝒎𝒆 ➤ 11.08.2026. • 11:38:54',
                    '├○ 𝑹𝒆𝒂𝒍 ➤ http://kamariato.com:80',
                    '├○ 𝑷𝒂𝒏𝒆𝒍 ➤ http://kamariato.com:80/c/',
                    '├○ 𝑴𝒂𝒄 ➤ 00:1A:79:f1:6a:9f',
                    '├○ 𝑷𝒂𝒏𝒆𝒍 𝑻𝒚𝒑𝒆 ➤ portal.php',
                    '├○ 𝑬𝒙𝒑 ➤ July 12, 2026, 12:00 am -30 Days',
                    '├○ 𝑽𝒑𝒏 ➤  𝑁𝑜 𝐶𝑙𝑖𝑒𝑛𝑡 𝐼𝑃 𝐴𝑑𝑑𝑟𝑒𝑠𝑠',
                    '├○ 𝑰𝒎𝒂𝒈𝒆 ➤  𝐼𝑛𝑣𝑎𝑙𝑖𝑑 𝑂𝑝𝑝𝑠',
                    '└──➢ 𝑴𝑨𝑪 𝑷𝑹𝑶 𝑨𝑻𝑳𝑨𝑺',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0]).toMatchObject({
                portalUrl: 'http://kamariato.com:80/c/',
                macAddress: '00:1A:79:F1:6A:9F',
            });
            expect(only(candidates, 'xtream')).toHaveLength(0);
        });

        it('reads a [+]-prefixed dump with serial, device ID and signature (corpus #11)', () => {
            const candidates = detectProviderImportCandidates(
                [
                    '[+] Panel: http://mag.jee-ott.xyz:80/c',
                    '[+] Real: mag.jee-ott.xyz',
                    '[+] Mac: 00:1B:79:48:3A:90',
                    '[+] Exp.: February 27, 2027, 7:33 pm',
                    '[+] ᴍᴀᴄ ꜱᴛᴀᴛᴜꜱ: ᴍᴀᴄ ᴏꜰꜰ🥺',
                    '[+] ᴍ3ᴜ ꜱᴛᴀᴛᴜꜱ: ᴏꜰꜰʟɪɴᴇ😔',
                    '[+] ᴄʜᴀɴɴᴇʟCategories: 684',
                    '[+] m3u_Url: ',
                    '',
                    '[+] Serial: 862E1CDB82415',
                    '[+] Device ID: FA9CBD1857D1D8A57BF1A03542B928CB90779C7CE2673CAC85A5FD4F8B7756E5',
                    '[+] Signature: A48D3EDCCC09B580CD19A07C8B0A9C44F1D00377CEE9913EE2ADCD858776FD67',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(1);
            expect(stalker[0]).toMatchObject({
                portalUrl: 'http://mag.jee-ott.xyz:80/c',
                macAddress: '00:1B:79:48:3A:90',
                serialNumber: '862E1CDB82415',
                deviceId1:
                    'FA9CBD1857D1D8A57BF1A03542B928CB90779C7CE2673CAC85A5FD4F8B7756E5',
                signature1:
                    'A48D3EDCCC09B580CD19A07C8B0A9C44F1D00377CEE9913EE2ADCD858776FD67',
            });
            expect(stalker[0].deviceId2).toBeUndefined();
        });

        it('does not cross-pair global identity labels onto multiple MACs', () => {
            // First-match-wins labels cannot say WHOSE serial/device ID they
            // are once a second MAC appears — and a device ID submitted with
            // the wrong MAC gets pinned by the portal permanently. Multi-MAC
            // candidates must therefore carry portal + MAC only.
            const candidates = detectProviderImportCandidates(
                [
                    'Portal: http://multi.example.com/c/',
                    'MAC: 00:1A:79:11:11:11',
                    `Device ID: ${'a'.repeat(64)}`,
                    'SN: AAAA1111BBBB2',
                    'MAC: 00:1A:79:22:22:22',
                ].join('\n')
            );

            const stalker = only(candidates, 'stalker');
            expect(stalker).toHaveLength(2);
            for (const candidate of stalker) {
                expect(candidate.portalUrl).toBe(
                    'http://multi.example.com/c/'
                );
                expect(candidate.deviceId1).toBeUndefined();
                expect(candidate.serialNumber).toBeUndefined();
            }
        });

        it('surfaces every MAC of a long multi-account list', () => {
            const macs = Array.from(
                { length: 6 },
                (_, index) => `00:1A:79:0${index}:0${index}:0${index}`
            );
            const candidates = detectProviderImportCandidates(
                ['http://long.example.com/c/', ...macs].join('\n')
            );

            expect(only(candidates, 'stalker')).toHaveLength(6);
        });

        it('gives labeled credentials to the stalker candidate, not a competing xtream guess', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'Portal: http://stb.example.com/c/',
                    'MAC: 00:1A:79:12:34:56',
                    'Login: stbuser',
                    'Password: stbpass',
                ].join('\n')
            );

            expect(only(candidates, 'xtream')).toHaveLength(0);
            const stalker = only(candidates, 'stalker');
            expect(stalker[0].username).toBe('stbuser');
            expect(stalker[0].password).toBe('stbpass');
        });
    });

    describe('m3u detection', () => {
        it('detects .m3u and .m3u8 links at high confidence', () => {
            const candidates = detectProviderImportCandidates(
                'List 1: https://lists.example.com/main.m3u\nList 2: https://lists.example.com/backup.m3u8'
            );

            const m3u = only(candidates, 'm3u-url');
            expect(m3u).toHaveLength(2);
            expect(m3u.every((c) => c.confidence === 'high')).toBe(true);
            expect(m3u[0].url).toBe('https://lists.example.com/main.m3u');
            expect(m3u[0].suggestedTitle).toBe('lists.example.com');
        });

        it('strips trailing punctuation from a link found in prose', () => {
            const candidates = detectProviderImportCandidates(
                'Your playlist (https://lists.example.com/main.m3u).'
            );

            expect(only(candidates, 'm3u-url')[0].url).toBe(
                'https://lists.example.com/main.m3u'
            );
        });

        it('does not turn an .m3u link with query credentials into an xtream server', () => {
            const candidates = detectProviderImportCandidates(
                'https://lists.example.com/files/list.m3u8?username=u&password=p'
            );

            expect(only(candidates, 'xtream')).toHaveLength(0);
            expect(only(candidates, 'm3u-url')).toHaveLength(1);
        });

        it('routes a pasted playlist body to the raw-text import', () => {
            const body =
                '#EXTM3U\n#EXTINF:-1 tvg-id="one",Channel One\nhttp://streams.example.com/1.ts';
            const candidates = detectProviderImportCandidates(body);

            expect(candidates).toEqual([
                { kind: 'm3u-text', confidence: 'high', text: body },
            ]);
        });
    });

    describe('mixed messages and ranking', () => {
        it('surfaces every source found in a combined provider message', () => {
            const candidates = detectProviderImportCandidates(
                [
                    'Xtream: http://x.example.com:8080/get.php?username=u1&password=p1',
                    'Backup M3U: http://x.example.com:8080/files/backup.m3u',
                    'Stalker portal: http://s.example.com/c/',
                    'MAC: 00:1A:79:99:88:77',
                ].join('\n')
            );

            expect(only(candidates, 'stalker')).toHaveLength(1);
            expect(only(candidates, 'xtream')).toHaveLength(1);
            expect(only(candidates, 'm3u-url').length).toBeGreaterThanOrEqual(1);
            // High-confidence candidates sort ahead of low-confidence ones.
            const ranks = candidates.map((candidate) => candidate.confidence);
            const firstLow = ranks.indexOf('low');
            const lastHigh = ranks.lastIndexOf('high');
            expect(firstLow === -1 || lastHigh < firstLow).toBe(true);
        });

        it('dedupes an URL pasted twice', () => {
            const candidates = detectProviderImportCandidates(
                'https://lists.example.com/main.m3u\nhttps://lists.example.com/main.m3u'
            );

            expect(only(candidates, 'm3u-url')).toHaveLength(1);
        });

        it('caps the number of returned candidates', () => {
            const urls = Array.from(
                { length: 12 },
                (_, index) => `https://lists.example.com/list-${index}.m3u`
            ).join('\n');

            expect(
                detectProviderImportCandidates(urls).length
            ).toBeLessThanOrEqual(16);
        });
    });
});
