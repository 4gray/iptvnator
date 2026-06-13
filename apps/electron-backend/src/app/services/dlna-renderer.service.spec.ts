import {
    buildSsdpSearchRequest,
    buildUpnpActionBody,
    isTrustedSsdpLocation,
    parseRendererDescription,
    parseSsdpResponse,
} from './dlna-renderer.service';

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
                location:
                    'http://192.168.1.50:1400/xml/device_description.xml',
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
            isTrustedSsdpLocation(
                'file:///etc/passwd',
                '192.168.1.50'
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
});
