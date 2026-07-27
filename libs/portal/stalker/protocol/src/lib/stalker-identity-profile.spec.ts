import {
    MAG250_MINIMAL_PROFILE_ID,
    createStalkerIdentityProfile,
} from './stalker-identity-profile';

describe('Stalker coherent identity profile', () => {
    it('builds the versioned public MAG250 minimal preset', () => {
        const profile = createStalkerIdentityProfile({
            macAddress: '00-1a-79-00-00-01',
        });

        expect(profile).toMatchObject({
            macAddress: '00:1A:79:00:00:01',
            preset: { id: MAG250_MINIMAL_PROFILE_ID, version: 1 },
            headers: {
                'Accept-Language': 'en-US',
                'User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
                'X-User-Agent': 'Model: MAG250',
            },
            managedCookies: {
                mac: '00:1A:79:00:00:01',
                stb_lang: 'en',
                timezone: 'UTC',
            },
        });
    });

    it('omits blank native identity fields instead of inventing values', () => {
        const profile = createStalkerIdentityProfile({
            deviceId1: '',
            deviceId2: ' ',
            macAddress: '00:1A:79:00:00:01',
            serialNumber: '',
            signature1: ' ',
            signature2: '',
        });

        expect(profile.profileParameters).not.toEqual(
            expect.objectContaining({
                device_id: expect.anything(),
                device_id2: expect.anything(),
                serial: expect.anything(),
                signature: expect.anything(),
                signature2: expect.anything(),
            })
        );
        expect(profile.metrics).toEqual({
            mac: '00:1A:79:00:00:01',
            model: 'MAG250',
            type: 'STB',
        });
    });

    it('forwards explicit identity and transport overrides unchanged', () => {
        const profile = createStalkerIdentityProfile({
            deviceId1: 'Device-One',
            deviceId2: 'Device-Two',
            macAddress: '00:1A:79:00:00:01',
            origin: 'https://origin.test',
            referer: 'https://landing.test/c/',
            serialNumber: 'Serial-AbC',
            signature1: 'Sig-One',
            signature2: 'Sig-Two',
            userAgent: 'Custom UA/1.0',
            xUserAgent: 'Model: Custom',
        });

        expect(profile.headers).toMatchObject({
            Origin: 'https://origin.test',
            Referer: 'https://landing.test/c/',
            'User-Agent': 'Custom UA/1.0',
            'X-User-Agent': 'Model: Custom',
        });
        expect(profile.profileParameters).toMatchObject({
            device_id: 'Device-One',
            device_id2: 'Device-Two',
            serial: 'Serial-AbC',
            signature: 'Sig-One',
            signature2: 'Sig-Two',
        });
    });

    it('normalizes one locale, language, and timezone tuple', () => {
        const profile = createStalkerIdentityProfile({
            language: 'DE',
            locale: 'de_DE',
            macAddress: '00:1A:79:00:00:01',
            timezone: ' Europe/Berlin ',
        });

        expect(profile.headers['Accept-Language']).toBe('de-DE');
        expect(profile.managedCookies).toMatchObject({
            stb_lang: 'de',
            timezone: 'Europe/Berlin',
        });
        expect(profile.profileParameters).toMatchObject({
            language: 'de',
            timezone: 'Europe/Berlin',
        });
        expect(profile.profileParameters).not.toHaveProperty('locale');
    });

    it('adds only present random, serial, and device_id2 values to metrics', () => {
        const profile = createStalkerIdentityProfile({
            deviceId1: 'not-the-uid',
            deviceId2: 'actual-uid',
            handshakeRandom: 'run-random',
            macAddress: '00:1A:79:00:00:01',
            serialNumber: 'serial-value',
        });

        expect(profile.metrics).toEqual({
            mac: '00:1A:79:00:00:01',
            model: 'MAG250',
            random: 'run-random',
            serial: 'serial-value',
            type: 'STB',
            uid: 'actual-uid',
        });
    });

    it('forwards an explicitly traced firmware tuple without deriving it', () => {
        const profile = createStalkerIdentityProfile({
            apiSignature: 'api-signature',
            firmwareVersion: 'ImageDescription: traced',
            hardwareVersion: '1.7-BD-00',
            hardwareVersion2: 'native-hash',
            imageVersion: '218',
            macAddress: '00:1A:79:00:00:01',
            numberOfBanks: '2',
            prehash: 'traced-prehash',
            videoOutput: 'hdmi',
        });

        expect(profile.profileParameters).toMatchObject({
            api_signature: 'api-signature',
            hw_version: '1.7-BD-00',
            hw_version_2: 'native-hash',
            image_version: '218',
            num_banks: '2',
            prehash: 'traced-prehash',
            ver: 'ImageDescription: traced',
            video_out: 'hdmi',
        });
    });

    it.each([
        '001A79000001',
        '00:1A:79:00:00',
        'GG:1A:79:00:00:01',
    ])('rejects invalid MAC input %s', (macAddress) => {
        expect(() => createStalkerIdentityProfile({ macAddress })).toThrow(
            'invalid-identity-input'
        );
    });
});
