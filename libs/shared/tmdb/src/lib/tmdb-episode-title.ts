/** Number-only provider placeholders carry no editorial episode title. */
export function isGenericEpisodeTitle(
    title: string | undefined | null
): boolean {
    return (
        !title?.trim() ||
        /^(?:(?:episode|серия|эпизод)\s*\d+|\d+|s\d{1,2}\s*e\d{1,3})$/i.test(
            title.trim()
        )
    );
}
