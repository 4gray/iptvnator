import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { EventEmitter } from 'events';
import {
    buildSsdpSearchRequest,
    buildUpnpActionBody,
    DlnaRendererService,
    isReceiverFetchableUrl,
    isTrustedSsdpLocation,
    parseRendererDescription,
    parseSsdpResponse,
} from './dlna-renderer.service';
import { enforceAbsoluteRequestTimeout } from './dlna-protocol';

describe('DLNA renderer protocol helpers', () => {
    it('builds a standards-compliant MediaRenderer discovery request', () => {
        expect(buildSsdpSearchRequest()).toContain('M-SEARCH * HTTP/1.1\r\n');
        expect(buildSsdpSearchRequest()).toContain(
            'ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n'
        );
        expect(buildSsdpSearchRequest()).toContain('MX: 2\r\n');
    });

    it('parses case-insensitive SSDP response headers', () => {
        const response = parseSsdpResponse(
            [
                'HTTP/1.1 200 OK',
                'CACHE-CONTROL: max-age=1800',
                'Location: http://192.168.1.50:1400/xml/device_description.xml',
                'USN: uuid:renderer-1::urn:schemas-upnp-org:device:MediaRenderer:1',
                '',
                '',
            ].join('\r\n')
        );

        expect(response).toEqual(
            expect.objectContaining({
                location: 'http://192.168.1.50:1400/xml/device_description.xml',
                usn: 'uuid:renderer-1::urn:schemas-upnp-org:device:MediaRenderer:1',
            })
        );
    });

    it('pins description requests to the private SSDP responder', () => {
        expect(
            isTrustedSsdpLocation(
                'http://tv.local:1400/device.xml',
                '192.168.1.50'
            )
        ).toBe(true);
        expect(
            isTrustedSsdpLocation(
                'http://attacker.example/device.xml',
                '203.0.113.10'
            )
        ).toBe(false);
        expect(
            isTrustedSsdpLocation('file:///etc/passwd', '192.168.1.50')
        ).toBe(false);
        expect(
            isTrustedSsdpLocation('http://localhost/device.xml', '127.0.0.1')
        ).toBe(false);
        expect(
            isTrustedSsdpLocation(
                'http://renderer.local/device.xml',
                '169.254.10.20'
            )
        ).toBe(false);
    });

    it('extracts renderer identity and AVTransport control URL from XML', () => {
        const description = parseRendererDescription(
            `<?xml version="1.0"?>
            <root>
              <device>
                <friendlyName>Living Room &amp; TV</friendlyName>
                <modelName>Example Renderer</modelName>
                <UDN>uuid:renderer-1</UDN>
                <serviceList>
                  <service>
                    <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
                    <controlURL>/MediaRenderer/AVTransport/Control</controlURL>
                  </service>
                </serviceList>
              </device>
            </root>`
        );

        expect(description).toEqual({
            friendlyName: 'Living Room & TV',
            modelName: 'Example Renderer',
            udn: 'uuid:renderer-1',
            avTransportControlUrl: '/MediaRenderer/AVTransport/Control',
        });
    });

    it('escapes untrusted media values in UPnP SOAP actions', () => {
        const body = buildUpnpActionBody('SetAVTransportURI', {
            InstanceID: '0',
            CurrentURI: 'https://example.com/live?a=1&b=<bad>',
            CurrentURIMetaData: '',
        });

        expect(body).toContain(
            'https://example.com/live?a=1&amp;b=&lt;bad&gt;'
        );
        expect(body).not.toContain('<bad>');
    });

    it.each([
        'http://localhost/live.m3u8',
        'http://127.0.0.1/live.m3u8',
        'http://169.254.169.254/latest/meta-data',
        'http://[::1]/live.m3u8',
        'http://[fe80::1]/live.m3u8',
        'http://224.0.0.1/live.m3u8',
    ])(
        'rejects unsafe receiver targets at the IPC boundary: %s',
        async (url) => {
            expect(isReceiverFetchableUrl(url)).toBe(false);

            const service = new DlnaRendererService();
            const rendererCache = (
                service as unknown as {
                    renderers: Map<string, object>;
                }
            ).renderers;
            rendererCache.set('renderer-1', {
                id: 'renderer-1',
                name: 'TV',
                address: '192.168.1.50',
                controlUrl: 'http://192.168.1.50/control',
                expiresAt: Date.now() + 60_000,
            });

            await expect(
                service.startPlayback('renderer-1', {
                    streamUrl: url,
                    title: 'Unsafe',
                })
            ).resolves.toEqual(
                expect.objectContaining({
                    success: false,
                })
            );
        }
    );

    it.each([
        'http://192.168.1.20/live.m3u8',
        'http://10.0.0.20/live.m3u8',
        'https://stream.example/live.m3u8',
    ])('allows receiver-fetchable LAN and public targets: %s', (url) => {
        expect(isReceiverFetchableUrl(url)).toBe(true);
    });

    it('rejects malformed renderer IPC playback payloads', async () => {
        const service = new DlnaRendererService();
        const rendererCache = (
            service as unknown as {
                renderers: Map<string, object>;
            }
        ).renderers;
        rendererCache.set('renderer-1', {
            id: 'renderer-1',
            name: 'TV',
            address: '192.168.1.50',
            controlUrl: 'http://192.168.1.50/control',
            expiresAt: Date.now() + 60_000,
        });

        await expect(
            service.startPlayback(
                'renderer-1',
                null as unknown as ResolvedPortalPlayback
            )
        ).resolves.toEqual({
            success: false,
            error: 'Invalid DLNA playback request.',
        });
    });

    it('enforces and clears the absolute DLNA request deadline', () => {
        jest.useFakeTimers();
        const request = new EventEmitter() as EventEmitter & {
            destroy: jest.Mock;
        };
        request.destroy = jest.fn();

        enforceAbsoluteRequestTimeout(request, 100);
        jest.advanceTimersByTime(100);
        expect(request.destroy).toHaveBeenCalledWith(
            new Error('DLNA renderer request timed out.')
        );

        request.destroy.mockClear();
        enforceAbsoluteRequestTimeout(request, 100);
        request.emit('close');
        jest.advanceTimersByTime(100);
        expect(request.destroy).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});
