package com.iptvnator.googletv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvDocumentPickerTest {
    @Test
    fun `accepts vendor document providers without relying on package naming`() {
        assertTrue(isUsableTvDocumentPickerPackage("com.vendor.tv.files"))
        assertTrue(isUsableTvDocumentPickerPackage("com.android.documentsui"))
    }

    @Test
    fun `rejects missing providers and framework stubs`() {
        assertFalse(isUsableTvDocumentPickerPackage(null))
        assertFalse(isUsableTvDocumentPickerPackage("com.google.android.tv.frameworkpackagestubs"))
    }
}
