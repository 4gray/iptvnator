/**
 * The set-top box IPTVnator presents itself as. Every value here is a constant
 * describing the emulated device, never anything derived from the user's
 * account — the identity the portal binds to a MAC lives in `device_id` /
 * `device_id2` and is handled separately.
 *
 * The stock Stalker middleware reads these on `get_profile` and stores them
 * for the admin panel; only an operator's optional `access_filter.php` ever
 * inspects them, and a box that reports nothing at all is the shape some of
 * those filters reject. They are therefore free to send and worth sending —
 * but only as one coherent MAG250: the model, firmware, hardware revision and
 * image version have to describe the same box as `metrics.model` and the
 * `STALKER_MAG_USER_AGENT` request header, or the profile reads as a forgery.
 *
 * These constants must not vary per playlist. They are deliberately excluded
 * from `stalkerIdentityFingerprint` / `stalkerSessionFingerprint`: changing
 * them would invalidate every persisted session for no gain, since the portal
 * does not bind sessions to them.
 */
export const STALKER_STB_PROFILE_PARAMS: Readonly<Record<string, string>> =
    Object.freeze({
        /** Firmware banner a MAG250 reports verbatim. */
        ver: 'ImageDescription: 0.2.18-r14-pub-250; ImageDate: Fri Jan 15 15:20:44 EET 2016; PORTAL version: 5.6.0; API Version: JS API version: 328; STB API version: 134; Player Engine version: 0x566',
        /** Was sent empty before — some panels treat that as "not a box". */
        stb_type: 'MAG250',
        hw_version: '1.7-BD-00',
        /** Numeric form of the `0.2.18` firmware in `ver`. */
        image_version: '218',
        client_type: 'STB',
        num_banks: '2',
        video_out: 'hdmi',
        hd: '1',
    });
