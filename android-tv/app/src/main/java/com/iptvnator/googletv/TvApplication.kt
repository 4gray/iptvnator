package com.iptvnator.googletv

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import java.io.File

/** Shared, bounded image pipeline for large TV playlists and their remote logos. */
class TvApplication : Application(), ImageLoaderFactory {
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .memoryCache {
            MemoryCache.Builder(this)
                .maxSizePercent(0.12)
                .build()
        }
        .diskCache {
            DiskCache.Builder()
                .directory(File(cacheDir, "iptvnator-images"))
                .maxSizeBytes(50L * 1024L * 1024L)
                .build()
        }
        .bitmapFactoryMaxParallelism(2)
        .crossfade(false)
        .build()
}
