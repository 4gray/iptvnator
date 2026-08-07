import {
    InlinePlaybackPlayer,
    PlaybackDiagnosticCode,
    PlaybackDiagnosticSource,
    type PlaybackDiagnostic,
} from './diagnostics/playback-diagnostics.model';
import {
    PlaybackEngineFamily,
    PlaybackRecommendationReason,
    PlaybackSourceKind,
    type PlaybackRecommendation,
    type PlaybackRecommendationContext,
    type PlaybackRecommendationPriority,
    type PlaybackRecommendationTarget,
    type PlaybackTargetCapability,
} from './playback-recommendation.model';
import { recommendPlaybackRecovery } from './playback-recommendation-policy';
import { createPlaybackTargetCapabilities } from './playback-target-capabilities';

interface ContextOptions {
    readonly diagnostic?: PlaybackDiagnostic;
    readonly code?: PlaybackDiagnosticCode;
    readonly sourceKind?: PlaybackSourceKind;
    readonly activeTarget?: PlaybackRecommendationTarget;
    readonly attemptedTargets?: ReadonlySet<PlaybackRecommendationTarget>;
    readonly targetCapabilities?: readonly PlaybackTargetCapability[];
    readonly managedExternalPlayersAvailable?: boolean;
    readonly drm?: 'none' | 'untransferable';
    readonly externalTransferable?: boolean;
    readonly alternativeSourceCount?: number;
}

function diagnostic(code: PlaybackDiagnosticCode): PlaybackDiagnostic {
    return {
        code,
        source: PlaybackDiagnosticSource.Source,
        sourceUrl: 'https://example.com/stream',
        container: '',
        audioCodecs: [],
        videoCodecs: [],
    };
}

function context(options: ContextOptions = {}): PlaybackRecommendationContext {
    const sourceKind = options.sourceKind ?? PlaybackSourceKind.Hls;
    return {
        diagnostic:
            options.diagnostic ??
            diagnostic(
                options.code ?? PlaybackDiagnosticCode.UnknownPlaybackError
            ),
        activeTarget: options.activeTarget ?? InlinePlaybackPlayer.VideoJs,
        attemptedTargets: options.attemptedTargets ?? new Set(),
        targetCapabilities:
            options.targetCapabilities ??
            createPlaybackTargetCapabilities({
                sourceKind,
                managedExternalPlayersAvailable:
                    options.managedExternalPlayersAvailable ?? true,
            }),
        source: {
            kind: sourceKind,
            isLive: false,
            drm: options.drm ?? 'none',
            externalTransferable: options.externalTransferable ?? true,
        },
        alternativeSourceCount: options.alternativeSourceCount ?? 1,
    };
}

function unsupportedShakaBrowserDiagnostic(): PlaybackDiagnostic {
    return {
        ...diagnostic(PlaybackDiagnosticCode.UnknownPlaybackError),
        source: PlaybackDiagnosticSource.Shaka,
        container: 'mpd',
        mimeType: 'application/dash+xml',
        runtimeSupport: 'shaka-browser-unsupported',
    };
}

function retry(
    reason: PlaybackRecommendationReason,
    priority: PlaybackRecommendationPriority = 'primary'
): PlaybackRecommendation {
    return { action: 'retry', reason, priority };
}

function alternative(
    priority: PlaybackRecommendationPriority = 'secondary'
): PlaybackRecommendation {
    return {
        action: 'alternative-source',
        reason: PlaybackRecommendationReason.AlternativeSourceAvailable,
        priority,
    };
}

function player(
    target: PlaybackRecommendationTarget,
    reason: PlaybackRecommendationReason,
    priority: PlaybackRecommendationPriority = 'secondary'
): PlaybackRecommendation {
    return { action: 'player', target, reason, priority };
}

function untrustedCapabilityMatrix(
    entry: unknown
): readonly PlaybackTargetCapability[] {
    return Object.freeze([
        ...createPlaybackTargetCapabilities({
            sourceKind: PlaybackSourceKind.Hls,
            managedExternalPlayersAvailable: true,
        }),
        entry,
    ]) as readonly PlaybackTargetCapability[];
}

function sparseCapabilityMatrix(): readonly PlaybackTargetCapability[] {
    const capabilities: unknown[] = [
        ...createPlaybackTargetCapabilities({
            sourceKind: PlaybackSourceKind.Hls,
            managedExternalPlayersAvailable: true,
        }),
    ];
    capabilities.length += 1;
    return Object.freeze(capabilities) as readonly PlaybackTargetCapability[];
}

describe('recommendPlaybackRecovery', () => {
    it.each([
        {
            name: 'network error',
            input: context({ code: PlaybackDiagnosticCode.NetworkError }),
            expected: [
                retry(PlaybackRecommendationReason.RetryTransientFailure),
                alternative(),
            ],
        },
        {
            name: 'unknown playback error',
            input: context({
                code: PlaybackDiagnosticCode.UnknownPlaybackError,
            }),
            expected: [
                retry(PlaybackRecommendationReason.RetryUnknownFailure),
                alternative(),
            ],
        },
        {
            name: 'browser access error',
            input: context({ code: PlaybackDiagnosticCode.BrowserAccessError }),
            expected: [
                player(
                    'mpv',
                    PlaybackRecommendationReason.ExternalBrowserAccess,
                    'primary'
                ),
                player(
                    'vlc',
                    PlaybackRecommendationReason.ExternalBrowserAccess
                ),
                alternative(),
            ],
        },
        {
            name: 'unsupported codec',
            input: context({ code: PlaybackDiagnosticCode.UnsupportedCodec }),
            expected: [
                player(
                    'mpv',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                    'primary'
                ),
                player(
                    'vlc',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
                alternative(),
            ],
        },
        {
            name: 'unsupported container',
            input: context({
                code: PlaybackDiagnosticCode.UnsupportedContainer,
            }),
            expected: [
                player(
                    'mpv',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                    'primary'
                ),
                player(
                    'vlc',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
                alternative(),
            ],
        },
        {
            name: 'HLS VHS decode error',
            input: context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                sourceKind: PlaybackSourceKind.Hls,
                activeTarget: InlinePlaybackPlayer.VideoJs,
            }),
            expected: [
                player(
                    InlinePlaybackPlayer.Html5,
                    PlaybackRecommendationReason.DifferentEngineFamily,
                    'primary'
                ),
                player(
                    'mpv',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
                player(
                    'vlc',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
            ],
        },
        {
            name: 'HLS hls.js decode error on HTML5',
            input: context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                sourceKind: PlaybackSourceKind.Hls,
                activeTarget: InlinePlaybackPlayer.Html5,
            }),
            expected: [
                player(
                    InlinePlaybackPlayer.VideoJs,
                    PlaybackRecommendationReason.DifferentEngineFamily,
                    'primary'
                ),
                player(
                    'mpv',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
                player(
                    'vlc',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
            ],
        },
        {
            name: 'HLS hls.js decode error on ArtPlayer',
            input: context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                sourceKind: PlaybackSourceKind.Hls,
                activeTarget: InlinePlaybackPlayer.ArtPlayer,
            }),
            expected: [
                player(
                    InlinePlaybackPlayer.VideoJs,
                    PlaybackRecommendationReason.DifferentEngineFamily,
                    'primary'
                ),
                player(
                    'mpv',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
                player(
                    'vlc',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
            ],
        },
        ...[PlaybackSourceKind.MpegTs, PlaybackSourceKind.Native].map(
            (sourceKind) => ({
                name: `${sourceKind} decode error`,
                input: context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    sourceKind,
                }),
                expected: [
                    player(
                        'mpv',
                        PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                        'primary'
                    ),
                    player(
                        'vlc',
                        PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                    ),
                    alternative(),
                ],
            })
        ),
        {
            name: 'DASH decode error',
            input: context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                sourceKind: PlaybackSourceKind.Dash,
                activeTarget: InlinePlaybackPlayer.Html5,
            }),
            expected: [
                player(
                    'mpv',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                    'primary'
                ),
                player(
                    'vlc',
                    PlaybackRecommendationReason.ExternalCodecOrContainerSupport
                ),
                alternative(),
            ],
        },
        {
            name: 'untransferable DASH DRM error',
            input: context({
                code: PlaybackDiagnosticCode.DrmOrEncryption,
                sourceKind: PlaybackSourceKind.Dash,
                activeTarget: InlinePlaybackPlayer.Html5,
                drm: 'untransferable',
            }),
            expected: [alternative('primary')],
        },
    ])(
        'returns exact ordered recommendations for $name',
        ({ input, expected }) => {
            expect(recommendPlaybackRecovery(input)).toEqual(expected);
        }
    );

    it('excludes the active target and every attempted player target', () => {
        const recommendations = recommendPlaybackRecovery(
            context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                activeTarget: InlinePlaybackPlayer.VideoJs,
                attemptedTargets: new Set([
                    InlinePlaybackPlayer.Html5,
                    'mpv',
                    'vlc',
                ]),
            })
        );

        expect(recommendations).toEqual([alternative('primary')]);
        expect(
            recommendations.some(
                (recommendation) =>
                    recommendation.action === 'player' &&
                    recommendation.target === InlinePlaybackPlayer.VideoJs
            )
        ).toBe(false);
    });

    it('promotes the first surviving result and marks later results secondary', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.UnsupportedCodec,
                    attemptedTargets: new Set(['mpv']),
                })
            )
        ).toEqual([
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                'primary'
            ),
            alternative(),
        ]);
    });

    it('caps results at three after filtering', () => {
        const recommendations = recommendPlaybackRecovery(
            context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                activeTarget: InlinePlaybackPlayer.VideoJs,
            })
        );

        expect(recommendations).toHaveLength(3);
        expect(recommendations).toEqual([
            player(
                InlinePlaybackPlayer.Html5,
                PlaybackRecommendationReason.DifferentEngineFamily,
                'primary'
            ),
            player(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
        ]);
    });

    it('uses one canonical representative per distinct HLS engine family', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    activeTarget: InlinePlaybackPlayer.VideoJs,
                    managedExternalPlayersAvailable: false,
                })
            )
        ).toEqual([
            player(
                InlinePlaybackPlayer.Html5,
                PlaybackRecommendationReason.DifferentEngineFamily,
                'primary'
            ),
            alternative(),
        ]);
    });

    it('does not substitute ArtPlayer when canonical HTML5 is unavailable', () => {
        const targetCapabilities = createPlaybackTargetCapabilities({
            sourceKind: PlaybackSourceKind.Hls,
            managedExternalPlayersAvailable: true,
        }).map((capability) =>
            capability.kind === 'inline' &&
            capability.target === InlinePlaybackPlayer.Html5
                ? { ...capability, available: false }
                : capability
        );

        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    targetCapabilities,
                })
            )
        ).toEqual([
            player(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                'primary'
            ),
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            alternative(),
        ]);
    });

    it('does not substitute ArtPlayer when canonical HTML5 was attempted', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    attemptedTargets: new Set([InlinePlaybackPlayer.Html5]),
                })
            )
        ).toEqual([
            player(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                'primary'
            ),
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            alternative(),
        ]);
    });

    it('excludes an inline family already attempted through a sibling target', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    activeTarget: InlinePlaybackPlayer.VideoJs,
                    attemptedTargets: new Set([InlinePlaybackPlayer.ArtPlayer]),
                })
            )
        ).toEqual([
            player(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                'primary'
            ),
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            alternative(),
        ]);
    });

    it('keeps managed external recovery for exact clear DASH browser-support evidence', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    diagnostic: unsupportedShakaBrowserDiagnostic(),
                    sourceKind: PlaybackSourceKind.Dash,
                    activeTarget: InlinePlaybackPlayer.Html5,
                })
            )
        ).toEqual([
            player(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport,
                'primary'
            ),
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            alternative(),
        ]);
    });

    it.each([
        {
            name: 'PWA runtime',
            options: { managedExternalPlayersAvailable: false },
        },
        {
            name: 'untransferable ClearKey DRM',
            options: { drm: 'untransferable' as const },
        },
    ])('suppresses DASH browser-support fallback in $name', ({ options }) => {
        expect(
            recommendPlaybackRecovery(
                context({
                    diagnostic: unsupportedShakaBrowserDiagnostic(),
                    sourceKind: PlaybackSourceKind.Dash,
                    activeTarget: InlinePlaybackPlayer.Html5,
                    ...options,
                })
            )
        ).toEqual([alternative('primary')]);
    });

    it('ignores capability array order when choosing canonical HTML5', () => {
        const targetCapabilities = [
            ...createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            }),
        ].reverse();

        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    targetCapabilities,
                })
            )
        ).toEqual([
            player(
                InlinePlaybackPlayer.Html5,
                PlaybackRecommendationReason.DifferentEngineFamily,
                'primary'
            ),
            player(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
        ]);
    });

    it('uses canonical Video.js for an ArtPlayer hls.js failure', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    activeTarget: InlinePlaybackPlayer.ArtPlayer,
                })
            )
        ).toEqual([
            player(
                InlinePlaybackPlayer.VideoJs,
                PlaybackRecommendationReason.DifferentEngineFamily,
                'primary'
            ),
            player(
                'mpv',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
            player(
                'vlc',
                PlaybackRecommendationReason.ExternalCodecOrContainerSupport
            ),
        ]);
    });

    it('excludes external players for untransferable DRM', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.DrmOrEncryption,
                    drm: 'untransferable',
                })
            )
        ).toEqual([
            player(
                InlinePlaybackPlayer.Html5,
                PlaybackRecommendationReason.CompatibleDrmPath,
                'primary'
            ),
            alternative(),
        ]);
    });

    it('excludes external players when the source is not transferable', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.UnsupportedContainer,
                    externalTransferable: false,
                })
            )
        ).toEqual([alternative('primary')]);
    });

    it('excludes unavailable managed external capabilities', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.BrowserAccessError,
                    managedExternalPlayersAvailable: false,
                })
            )
        ).toEqual([alternative('primary')]);
    });

    it.each([
        {
            name: 'missing',
            capabilities: createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            }).filter(
                (capability) =>
                    capability.target !== InlinePlaybackPlayer.VideoJs
            ),
        },
        {
            name: 'duplicate',
            capabilities: [
                ...createPlaybackTargetCapabilities({
                    sourceKind: PlaybackSourceKind.Hls,
                    managedExternalPlayersAvailable: true,
                }),
                {
                    kind: 'inline' as const,
                    target: InlinePlaybackPlayer.VideoJs,
                    available: true,
                    engineFamily: null,
                },
            ],
        },
        {
            name: 'unavailable',
            capabilities: createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Unknown,
                managedExternalPlayersAvailable: true,
            }),
        },
        {
            name: 'null-family',
            capabilities: [
                {
                    kind: 'inline' as const,
                    target: InlinePlaybackPlayer.VideoJs,
                    available: true,
                    engineFamily: null,
                },
                ...createPlaybackTargetCapabilities({
                    sourceKind: PlaybackSourceKind.Hls,
                    managedExternalPlayersAvailable: true,
                }).slice(1),
            ],
        },
    ])(
        'fails closed for a $name active inline capability',
        ({ capabilities }) => {
            expect(
                recommendPlaybackRecovery(
                    context({
                        code: PlaybackDiagnosticCode.MediaDecodeError,
                        targetCapabilities: capabilities,
                    })
                )
            ).toEqual([
                retry(PlaybackRecommendationReason.RetryUnknownFailure),
                alternative(),
            ]);
        }
    );

    it.each([
        {
            name: 'duplicate MPV availability records',
            sourceKind: PlaybackSourceKind.Hls,
            activeTarget: InlinePlaybackPlayer.VideoJs,
            capabilities: [
                ...createPlaybackTargetCapabilities({
                    sourceKind: PlaybackSourceKind.Hls,
                    managedExternalPlayersAvailable: true,
                }),
                {
                    kind: 'external' as const,
                    target: 'mpv' as const,
                    available: false,
                },
            ],
        },
        {
            name: 'duplicate inline records with contradictory family and availability',
            sourceKind: PlaybackSourceKind.Hls,
            activeTarget: InlinePlaybackPlayer.VideoJs,
            capabilities: [
                ...createPlaybackTargetCapabilities({
                    sourceKind: PlaybackSourceKind.Hls,
                    managedExternalPlayersAvailable: true,
                }),
                {
                    kind: 'inline' as const,
                    target: InlinePlaybackPlayer.Html5,
                    available: false,
                    engineFamily: PlaybackEngineFamily.Vhs,
                },
            ],
        },
        {
            name: 'wrong target and kind pairing',
            sourceKind: PlaybackSourceKind.Hls,
            activeTarget: InlinePlaybackPlayer.VideoJs,
            capabilities: [
                ...createPlaybackTargetCapabilities({
                    sourceKind: PlaybackSourceKind.Hls,
                    managedExternalPlayersAvailable: true,
                }).filter((capability) => capability.target !== 'mpv'),
                {
                    kind: 'inline',
                    target: 'mpv',
                    available: true,
                    engineFamily: PlaybackEngineFamily.HlsJs,
                } as unknown as PlaybackTargetCapability,
            ],
        },
        {
            name: 'missing canonical target record',
            sourceKind: PlaybackSourceKind.Hls,
            activeTarget: InlinePlaybackPlayer.VideoJs,
            capabilities: createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            }).filter(
                (capability) =>
                    capability.target !== InlinePlaybackPlayer.ArtPlayer
            ),
        },
        {
            name: 'future target record',
            sourceKind: PlaybackSourceKind.Hls,
            activeTarget: InlinePlaybackPlayer.VideoJs,
            capabilities: [
                ...createPlaybackTargetCapabilities({
                    sourceKind: PlaybackSourceKind.Hls,
                    managedExternalPlayersAvailable: true,
                }),
                {
                    kind: 'external',
                    target: 'future-player',
                    available: true,
                } as unknown as PlaybackTargetCapability,
            ],
        },
        {
            name: 'future engine family',
            sourceKind: PlaybackSourceKind.Hls,
            activeTarget: InlinePlaybackPlayer.VideoJs,
            capabilities: createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            }).map((capability) =>
                capability.kind === 'inline' &&
                capability.target === InlinePlaybackPlayer.ArtPlayer
                    ? ({
                          ...capability,
                          engineFamily: 'future-family',
                      } as unknown as PlaybackTargetCapability)
                    : capability
            ),
        },
        {
            name: 'source kind and engine family mismatch',
            sourceKind: PlaybackSourceKind.Hls,
            activeTarget: InlinePlaybackPlayer.VideoJs,
            capabilities: createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            }).map((capability) =>
                capability.kind === 'inline' &&
                capability.target === InlinePlaybackPlayer.VideoJs
                    ? {
                          ...capability,
                          engineFamily: PlaybackEngineFamily.HlsJs,
                      }
                    : capability
            ),
        },
        {
            name: 'available null-family path',
            sourceKind: PlaybackSourceKind.Dash,
            activeTarget: InlinePlaybackPlayer.Html5,
            capabilities: createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Dash,
                managedExternalPlayersAvailable: true,
            }).map((capability) =>
                capability.kind === 'inline' &&
                capability.target === InlinePlaybackPlayer.VideoJs
                    ? { ...capability, available: true }
                    : capability
            ),
        },
    ])(
        'fails closed for $name in the complete capability context',
        ({ sourceKind, activeTarget, capabilities }) => {
            expect(
                recommendPlaybackRecovery(
                    context({
                        code: PlaybackDiagnosticCode.MediaDecodeError,
                        sourceKind,
                        activeTarget,
                        targetCapabilities: capabilities,
                    })
                )
            ).toEqual([
                retry(PlaybackRecommendationReason.RetryUnknownFailure),
                alternative(),
            ]);
        }
    );

    it('omits an unavailable alternative when capability validation fails', () => {
        const targetCapabilities = [
            ...createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            }),
            {
                kind: 'external' as const,
                target: 'mpv' as const,
                available: false,
            },
        ];

        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.UnsupportedCodec,
                    targetCapabilities,
                    alternativeSourceCount: 0,
                })
            )
        ).toEqual([retry(PlaybackRecommendationReason.RetryUnknownFailure)]);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['number', 42],
        ['string', 'invalid-capability'],
        ['boolean', true],
    ])('fails closed for a %s capability entry', (_name, entry) => {
        const targetCapabilities = untrustedCapabilityMatrix(entry);

        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    targetCapabilities,
                })
            )
        ).toEqual([
            retry(PlaybackRecommendationReason.RetryUnknownFailure),
            alternative(),
        ]);
    });

    it('fails closed for a sparse capability array without mutating it', () => {
        const targetCapabilities = sparseCapabilityMatrix();
        const keysBefore = Object.keys(targetCapabilities);
        const lengthBefore = targetCapabilities.length;

        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    targetCapabilities,
                })
            )
        ).toEqual([
            retry(PlaybackRecommendationReason.RetryUnknownFailure),
            alternative(),
        ]);
        expect(Object.keys(targetCapabilities)).toEqual(keysBefore);
        expect(targetCapabilities).toHaveLength(lengthBefore);
    });

    it.each([
        PlaybackDiagnosticCode.NetworkError,
        PlaybackDiagnosticCode.UnknownPlaybackError,
    ])('keeps %s total with malformed capabilities', (code) => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code,
                    targetCapabilities: untrustedCapabilityMatrix(null),
                })
            )
        ).toEqual([
            retry(
                code === PlaybackDiagnosticCode.NetworkError
                    ? PlaybackRecommendationReason.RetryTransientFailure
                    : PlaybackRecommendationReason.RetryUnknownFailure
            ),
            alternative(),
        ]);
    });

    it('fails closed when the active capability is external', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.UnsupportedCodec,
                    activeTarget: 'mpv',
                })
            )
        ).toEqual([
            retry(PlaybackRecommendationReason.RetryUnknownFailure),
            alternative(),
        ]);
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.5, 0, -1])(
        'omits alternative source when its count is invalid or non-positive: %s',
        (alternativeSourceCount) => {
            expect(
                recommendPlaybackRecovery(
                    context({
                        code: PlaybackDiagnosticCode.NetworkError,
                        alternativeSourceCount,
                    })
                )
            ).toEqual([
                retry(PlaybackRecommendationReason.RetryTransientFailure),
            ]);
        }
    );

    it('includes alternative source for a positive safe integer count', () => {
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.NetworkError,
                    alternativeSourceCount: Number.MAX_SAFE_INTEGER,
                })
            )
        ).toEqual([
            retry(PlaybackRecommendationReason.RetryTransientFailure),
            alternative(),
        ]);
    });

    it('does not mutate attempted targets or capability inputs', () => {
        const attemptedTargets = new Set<PlaybackRecommendationTarget>(['mpv']);
        const targetCapabilities = Object.freeze(
            createPlaybackTargetCapabilities({
                sourceKind: PlaybackSourceKind.Hls,
                managedExternalPlayersAvailable: true,
            }).map((capability) => Object.freeze({ ...capability }))
        );
        const attemptedBefore = [...attemptedTargets];
        const capabilitiesBefore = targetCapabilities.map((capability) => ({
            ...capability,
        }));

        const first = recommendPlaybackRecovery(
            context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                attemptedTargets,
                targetCapabilities,
            })
        );
        const second = recommendPlaybackRecovery(
            context({
                code: PlaybackDiagnosticCode.MediaDecodeError,
                attemptedTargets,
                targetCapabilities,
            })
        );

        expect([...attemptedTargets]).toEqual(attemptedBefore);
        expect(targetCapabilities).toEqual(capabilitiesBefore);
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
        expect(second[0]).not.toBe(first[0]);
    });

    it('handles unknown source kinds without throwing', () => {
        expect(() =>
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    sourceKind: PlaybackSourceKind.Unknown,
                })
            )
        ).not.toThrow();
        expect(
            recommendPlaybackRecovery(
                context({
                    code: PlaybackDiagnosticCode.MediaDecodeError,
                    sourceKind: PlaybackSourceKind.Unknown,
                })
            )
        ).toEqual([
            retry(PlaybackRecommendationReason.RetryUnknownFailure),
            alternative(),
        ]);
    });

    it('handles future diagnostic codes with the safe default', () => {
        const unknownDiagnostic = {
            ...diagnostic(PlaybackDiagnosticCode.UnknownPlaybackError),
            code: 'future-playback-error',
        } as unknown as PlaybackDiagnostic;
        const input = {
            ...context(),
            diagnostic: unknownDiagnostic,
        };

        expect(() => recommendPlaybackRecovery(input)).not.toThrow();
        expect(recommendPlaybackRecovery(input)).toEqual([
            retry(PlaybackRecommendationReason.RetryUnknownFailure),
            alternative(),
        ]);
    });
});
