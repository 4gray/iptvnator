export interface StalkerIdentityRevisionInput {
    presetId: string;
    presetVersion: number;
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
    prehash?: string;
    apiSignature?: string;
    firmwareVersion?: string;
    imageVersion?: string;
    hardwareVersion?: string;
    hardwareVersion2?: string;
    numberOfBanks?: string;
    videoOutput?: string;
    userAgent?: string;
    xUserAgent?: string;
    referer?: string;
    origin?: string;
    refererPolicy?: string;
    originPolicy?: string;
    locale?: string;
    language?: string;
    timezone?: string;
    profileOverrides?: Readonly<Record<string, string>>;
}

const IDENTITY_FIELD_ORDER: readonly (keyof Omit<
    StalkerIdentityRevisionInput,
    'profileOverrides'
>)[] = [
    'presetId',
    'presetVersion',
    'serialNumber',
    'deviceId1',
    'deviceId2',
    'signature1',
    'signature2',
    'prehash',
    'apiSignature',
    'firmwareVersion',
    'imageVersion',
    'hardwareVersion',
    'hardwareVersion2',
    'numberOfBanks',
    'videoOutput',
    'userAgent',
    'xUserAgent',
    'referer',
    'origin',
    'refererPolicy',
    'originPolicy',
    'locale',
    'language',
    'timezone',
];

export function serializeStalkerPrincipalInput(username: string): Uint8Array {
    const value = new TextEncoder().encode(username);
    const result = new Uint8Array(value.byteLength + 4);
    const view = new DataView(result.buffer);
    view.setUint32(0, value.byteLength, false);
    result.set(value, 4);
    return result;
}

export function serializeStalkerIdentityRevision(
    input: StalkerIdentityRevisionInput
): string {
    const fields = IDENTITY_FIELD_ORDER.map((field) =>
        serializeField(field, input[field])
    );
    const overrideFields = Object.entries(input.profileOverrides ?? {})
        .sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
        )
        .map(([key, value]) => serializeField(`override.${key}`, value));

    return ['stalker-identity-revision:v1', ...fields, ...overrideFields].join(
        '\n'
    );
}

function serializeField(
    field: string,
    value: string | number | undefined
): string {
    if (value === undefined) {
        return `${field}=absent`;
    }
    const serialized = String(value);
    const length = new TextEncoder().encode(serialized).byteLength;
    return `${field}=present:${length}:${serialized}`;
}
