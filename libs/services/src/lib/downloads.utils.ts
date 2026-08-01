export function formatDownloadBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const kilobyte = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const index = Math.floor(Math.log(bytes) / Math.log(kilobyte));
    return (
        parseFloat((bytes / Math.pow(kilobyte, index)).toFixed(1)) +
        ' ' +
        sizes[index]
    );
}
