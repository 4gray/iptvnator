const paths: Record<string, string> = {
    home: 'M3 11 12 3 21 11 M5 10v11h5v-7h4v7h5V10',
    live: 'M3 5h18v14H3z M8 22h8 M8 2l4 3 4-3',
    movies: 'M3 4h18v17H3z M3 9h18 M7 4l3 5 M14 4l3 5',
    series: 'M3 3h8v8H3z M14 3h7v8h-7z M3 14h8v7H3z M14 14h7v7h-7z',
    favorites: 'M12 21S2 15 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 7-10 13-10 13z',
    search: 'M16 16l6 6 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    sources: 'M3 3h18v18H3z M12 7v10 M7 12h10',
    settings: 'M4 5h16 M4 12h16 M4 19h16 M8 2v6 M16 9v6 M9 16v6',
    check: 'M4 12l5 5L20 6',
};
export function TvIcon({ name }: { name: string }) {
    return (
        <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <path d={paths[name] ?? paths.sources} />
        </svg>
    );
}
