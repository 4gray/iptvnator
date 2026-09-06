import {
    buildRequestOrigin,
    resolveMarketingPosterUrls,
} from './marketing-poster-url';

type RequestLike = Parameters<typeof buildRequestOrigin>[0];

function request(
    protocol: string,
    headers: Record<string, string | undefined>
): RequestLike {
    return {
        protocol,
        get: (name: string) => headers[name.toLowerCase()],
    };
}

describe('marketing poster URLs', () => {
    it('uses the forwarded public origin for relative poster paths', () => {
        const req = request('http', {
            host: 'stalker-mock:3210',
            'x-forwarded-host': 'demo.example:9443',
            'x-forwarded-proto': 'https',
        });
        const payload = {
            js: {
                data: [
                    {
                        cover: '/assets/marketing/poster/black-harbor.png',
                        screenshot_uri:
                            '/assets/marketing/poster/black-harbor.png',
                    },
                ],
            },
        };

        expect(
            resolveMarketingPosterUrls(payload, buildRequestOrigin(req))
        ).toEqual({
            js: {
                data: [
                    {
                        cover: 'https://demo.example:9443/assets/marketing/poster/black-harbor.png',
                        screenshot_uri:
                            'https://demo.example:9443/assets/marketing/poster/black-harbor.png',
                    },
                ],
            },
        });
    });

    it('resolves channel logo paths the same way as posters', () => {
        const req = request('http', { host: 'localhost:3210' });

        expect(
            resolveMarketingPosterUrls(
                { logo: '/assets/marketing/logo/aurora-news.svg?size=256x256' },
                buildRequestOrigin(req)
            )
        ).toEqual({
            logo: 'http://localhost:3210/assets/marketing/logo/aurora-news.svg?size=256x256',
        });
    });

    it('preserves unrelated URLs and values', () => {
        const payload = {
            cover: 'https://picsum.photos/seed/movie/300/450',
            count: 1,
        };

        expect(
            resolveMarketingPosterUrls(
                payload,
                buildRequestOrigin(request('http', { host: 'localhost:3210' }))
            )
        ).toEqual(payload);
    });
});
