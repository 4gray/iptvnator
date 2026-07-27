interface LinuxSourceArchiveBinding {
    schemaVersion: 1;
    name: 'linux-frame-copy-runtime-sources.tar.xz';
    sha256: string;
    repositoryRevision: string;
}

declare const LINUX_SOURCE_ARCHIVE_CONTRACT: {
    readonly SOURCE_ARCHIVE_BINDING_NAME: 'source-archive-binding.json';
    readonly SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION: 1;
    readonly SOURCE_ARCHIVE_NAME: 'linux-frame-copy-runtime-sources.tar.xz';
    createLinuxSourceArchiveBinding(options: {
        archivePath: string;
        repositoryRevision: string;
    }): LinuxSourceArchiveBinding;
    sha256File(filePath: string): string;
    validateLinuxSourceArchiveBinding(
        binding: unknown,
        options?: {
            expectedRepositoryRevision?: string;
            expectedSha256?: string;
        }
    ): string[];
};

export = LINUX_SOURCE_ARCHIVE_CONTRACT;
