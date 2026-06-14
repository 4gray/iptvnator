import { SaxesParser } from 'saxes';

export const AV_TRANSPORT_SERVICE =
    'urn:schemas-upnp-org:service:AVTransport:1';

export interface RendererDescription {
    friendlyName: string;
    modelName: string;
    udn: string;
    avTransportControlUrl: string;
}

export function parseRendererDescription(
    xml: string
): RendererDescription | null {
    const values: Partial<RendererDescription> = {};
    let currentServiceType = '';
    let currentControlUrl = '';
    const elements: Array<{ name: string; text: string }> = [];
    const parser = new SaxesParser();

    parser.on('opentag', (tag) => {
        elements.push({ name: localName(tag.name), text: '' });
    });
    parser.on('text', (text) => {
        const current = elements.at(-1);
        if (current) current.text += text;
    });
    parser.on('closetag', () => {
        const current = elements.pop();
        if (!current) return;
        const value = current.text.trim();

        switch (current.name) {
            case 'friendlyName':
                values.friendlyName ||= value;
                break;
            case 'modelName':
                values.modelName ||= value;
                break;
            case 'UDN':
                values.udn ||= value;
                break;
            case 'serviceType':
                currentServiceType = value;
                break;
            case 'controlURL':
                currentControlUrl = value;
                break;
            case 'service':
                if (currentServiceType === AV_TRANSPORT_SERVICE) {
                    values.avTransportControlUrl = currentControlUrl;
                }
                currentServiceType = '';
                currentControlUrl = '';
                break;
        }
    });

    try {
        parser.write(xml).close();
    } catch {
        return null;
    }

    if (!values.friendlyName || !values.avTransportControlUrl) {
        return null;
    }

    return {
        friendlyName: values.friendlyName,
        modelName: values.modelName ?? '',
        udn: values.udn ?? '',
        avTransportControlUrl: values.avTransportControlUrl,
    };
}

export function buildUpnpActionBody(
    action: string,
    values: Record<string, string>
): string {
    const fields = Object.entries(values)
        .map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`)
        .join('');
    return (
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
        's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
        `<s:Body><u:${action} xmlns:u="${AV_TRANSPORT_SERVICE}">` +
        `${fields}</u:${action}></s:Body></s:Envelope>`
    );
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function localName(name: string): string {
    return name.split(':').at(-1) ?? name;
}
