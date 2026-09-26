package com.iptvnator.googletv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.CardDefaults
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextOverflow
import coil.compose.AsyncImage
import com.iptvnator.googletv.playlist.TvChannel
import androidx.compose.ui.platform.LocalContext
import android.view.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type

data class TvPosterItem(
    val title: String,
    val imageUrl: String?,
    val subtitle: String? = null,
)

internal enum class TvPosterSize(val width: Int, val height: Int) {
    SMALL(118, 177),
    MEDIUM(140, 210),
    LARGE(166, 249),
}

internal fun tvPosterSizeFromPreference(value: String?): TvPosterSize = when (value) {
    "small" -> TvPosterSize.SMALL
    "large" -> TvPosterSize.LARGE
    else -> TvPosterSize.MEDIUM
}

/** Poster rail for TV catalogues; missing/broken artwork never removes the item. */
@Composable
fun TvPosterRail(
    items: List<TvPosterItem>,
    onItemClick: (Int) -> Unit = {},
    onLongClick: (Int) -> Unit = {},
    initialFocusRequester: FocusRequester? = null,
    upFocusRequester: FocusRequester? = null,
) {
    val preferences = LocalContext.current
        .getSharedPreferences("iptvnator-tv-ui", android.content.Context.MODE_PRIVATE)
    val posterSize = tvPosterSizeFromPreference(
        preferences.getString("poster_size", "medium"),
    )
    val showTitles = preferences.getBoolean("show_poster_titles", true)
    val navRail = LocalTvNavRailFocus.current
    LazyRow(
        contentPadding = PaddingValues(vertical = 12.dp, horizontal = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        itemsIndexed(items) { index, item ->
            var focused by remember(item.title) { mutableStateOf(false) }
            TvCard(
                onClick = { onItemClick(index) },
                modifier = Modifier
                    .width(posterSize.width.dp)
                    .height(posterSize.height.dp)
                    .then(
                        if (index == 0 && initialFocusRequester != null) {
                            Modifier.focusRequester(initialFocusRequester)
                        } else {
                            Modifier
                        },
                    )
                    .focusProperties {
                        if (index == 0 && upFocusRequester != null) up = upFocusRequester
                        if (index == 0) navRail?.let { left = it }
                    }
                    .onFocusChanged { focused = it.isFocused }
                    .tvDpadClick { onItemClick(index) }
                    .onKeyEvent { event ->
                        if (event.type == KeyEventType.KeyDown &&
                            event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_CENTER &&
                            event.nativeKeyEvent.repeatCount >= 1
                        ) {
                            onLongClick(index)
                            true
                        } else false
                    },
                shape = CardDefaults.shape(RoundedCornerShape(12.dp)),
                scale = CardDefaults.scale(focusedScale = 1f),
                colors = CardDefaults.colors(
                    containerColor = tvTone(TvTone.SurfaceHigh),
                    focusedContainerColor = tvTone(TvTone.SurfaceHigh),
                ),
            ) {
                Box(modifier = Modifier.fillMaxSize()) {
                    var imageFailed by remember(item.imageUrl) { mutableStateOf(false) }
                    val imageUrl = item.imageUrl?.takeIf(String::isNotBlank)
                    if (imageUrl != null && !imageFailed) {
                        AsyncImage(
                            model = imageUrl,
                            contentDescription = item.title,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Crop,
                            onError = { imageFailed = true },
                        )
                    } else {
                        // Missing artwork becomes a typographic poster
                        // instead of an empty grey slab.
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    Brush.verticalGradient(
                                        listOf(tvTone(TvTone.SurfaceTop), tvTone(TvTone.Deep)),
                                    ),
                                )
                                .padding(14.dp),
                        ) {
                            Box(Modifier.width(22.dp).height(3.dp).background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)))
                            Text(
                                item.title,
                                modifier = Modifier.padding(top = 10.dp),
                                color = tvTone(TvTone.Text),
                                fontFamily = TvType.Display,
                                fontSize = 14.sp,
                                lineHeight = 16.sp,
                                maxLines = 5,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text("Sin carátula", modifier = Modifier.padding(top = 6.dp), color = tvTone(TvTone.Muted), fontSize = 10.sp)
                        }
                    }
                    if ((showTitles || focused) && !(imageUrl == null || imageFailed)) {
                        Column(
                            modifier = Modifier
                                .align(Alignment.BottomStart)
                                .fillMaxWidth()
                                .background(
                                    Brush.verticalGradient(listOf(Color.Transparent, Color(0xE6000000))),
                                )
                                .padding(start = 12.dp, end = 12.dp, top = 28.dp, bottom = 12.dp),
                        ) {
                            Text(
                                item.title,
                                color = Color(0xFFF4EFE6),
                                fontFamily = TvType.BodyMedium,
                                fontSize = 11.sp,
                                lineHeight = 13.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            item.subtitle?.takeIf(String::isNotBlank)?.let {
                                Text(it, color = Color(0xFFBDB6AA), fontSize = 9.sp, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TvChannelRail(
    items: List<TvChannel>,
    onItemClick: (Int) -> Unit = {},
    onLongClick: (Int) -> Unit = {},
) {
    val navRail = LocalTvNavRailFocus.current
    LazyRow(
        contentPadding = PaddingValues(vertical = 10.dp, horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        itemsIndexed(items) { index, channel ->
            Column(Modifier.width(212.dp)) {
                TvCard(
                    onClick = { onItemClick(index) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(119.dp)
                        .focusProperties { if (index == 0) navRail?.let { left = it } }
                        .tvDpadClick { onItemClick(index) }
                        .onKeyEvent { event ->
                            if (event.type == KeyEventType.KeyDown &&
                                event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_DPAD_CENTER &&
                                event.nativeKeyEvent.repeatCount >= 1
                            ) {
                                onLongClick(index)
                                true
                            } else false
                        },
                    shape = CardDefaults.shape(RoundedCornerShape(12.dp)),
                    scale = CardDefaults.scale(focusedScale = 1f),
                    colors = CardDefaults.colors(
                        containerColor = tvTone(TvTone.SurfaceHigh),
                        focusedContainerColor = tvTone(TvTone.SurfaceTop),
                    ),
                ) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        var imageFailed by remember(channel.logoUrl) { mutableStateOf(false) }
                        val imageUrl = channel.logoUrl?.takeIf(String::isNotBlank)
                        if (imageUrl != null && !imageFailed) {
                            AsyncImage(
                                model = imageUrl,
                                contentDescription = channel.name,
                                modifier = Modifier.fillMaxSize().padding(22.dp),
                                contentScale = ContentScale.Fit,
                                onError = { imageFailed = true },
                            )
                        } else {
                            Text(
                                channel.name.take(2).uppercase(),
                                color = tvTone(TvTone.Faint),
                                fontFamily = TvType.Display,
                                fontSize = 30.sp,
                            )
                        }
                    }
                }
                Text(
                    channel.name,
                    modifier = Modifier.padding(top = 8.dp, start = 2.dp),
                    color = tvTone(TvTone.Text),
                    fontFamily = TvType.BodyMedium,
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                channel.group?.takeIf(String::isNotBlank)?.let {
                    Text(it, modifier = Modifier.padding(start = 2.dp), color = tvTone(TvTone.Muted), fontSize = 9.sp, maxLines = 1)
                }
            }
        }
    }
}
