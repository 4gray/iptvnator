package com.iptvnator.googletv

import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setText
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.background

/*
 * Nocturno versions of the Material components used by the TV screens. They
 * keep Material's parameter names so call sites only change the function
 * name, and they apply the TV system's shape, palette and focus-ring radius.
 */

@Composable
internal fun tvNeutralButtonColors(): ButtonColors = ButtonDefaults.buttonColors(
    containerColor = tvTone(TvTone.SurfaceTop),
    contentColor = tvTone(TvTone.Text),
    disabledContainerColor = tvTone(TvTone.SurfaceTop).copy(alpha = 0.4f),
    disabledContentColor = tvTone(TvTone.Faint),
)

@Composable
internal fun tvPrimaryButtonColors(): ButtonColors = ButtonDefaults.buttonColors(
    containerColor = tvTone(TvTone.Accent),
    contentColor = tvTone(TvTone.AccentInk),
    disabledContainerColor = tvTone(TvTone.SurfaceTop).copy(alpha = 0.4f),
    disabledContentColor = tvTone(TvTone.Faint),
)

@Composable
internal fun tvDangerButtonColors(): ButtonColors = ButtonDefaults.buttonColors(
    containerColor = tvTone(TvTone.LiveSoft),
    contentColor = tvTone(TvTone.Live),
    disabledContainerColor = tvTone(TvTone.SurfaceTop).copy(alpha = 0.4f),
    disabledContentColor = tvTone(TvTone.Faint),
)

/** True inside dialogs: buttons switch to a compact height and type size. */
internal val LocalTvDialogCompact = androidx.compose.runtime.staticCompositionLocalOf { false }

/** Pill button; neutral by default so a screen never shows a wall of amber. */
@Composable
internal fun TvButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(50),
    colors: ButtonColors = tvNeutralButtonColors(),
    border: BorderStroke? = null,
    contentPadding: PaddingValues = PaddingValues(horizontal = 18.dp, vertical = 4.dp),
    interactionSource: MutableInteractionSource? = null,
    content: @Composable RowScope.() -> Unit,
) {
    // The D-pad focus target lives in the caller's modifier (tvDpadClick), so
    // observe it from outside and lighten the container while focused; an
    // amber ring alone disappears on the amber primary button.
    var focused by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    val compact = LocalTvDialogCompact.current
    val accent = tvTone(TvTone.Accent)
    val focusedContainer = if (colors.containerColor == accent) tvTone(TvTone.AccentSoft) else tvTone(TvTone.Focused)
    val effectiveColors = if (focused && enabled) colors.copy(containerColor = focusedContainer) else colors
    CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
        androidx.compose.material3.Button(
            onClick = onClick,
            modifier = Modifier
                .onFocusChanged { focused = it.hasFocus }
                .heightIn(min = if (compact) 32.dp else 40.dp, max = if (compact) 36.dp else 44.dp)
                .then(modifier),
            enabled = enabled,
            shape = shape,
            colors = effectiveColors,
            elevation = null,
            border = border,
            contentPadding = if (compact) PaddingValues(horizontal = 16.dp, vertical = 4.dp) else contentPadding,
            interactionSource = interactionSource,
        ) {
            CompositionLocalProvider(
                LocalTextStyle provides LocalTextStyle.current.merge(
                    TextStyle(
                        fontFamily = TvType.BodyMedium,
                        letterSpacing = 0.2.sp,
                        fontSize = if (compact) 12.sp else 13.sp,
                    ),
                ),
            ) { content() }
        }
    }
}

/** Low-emphasis text action with an amber label. */
@Composable
internal fun TvTextButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = RoundedCornerShape(50),
    colors: ButtonColors = ButtonDefaults.textButtonColors(
        contentColor = tvTone(TvTone.Accent),
        disabledContentColor = tvTone(TvTone.Faint),
    ),
    contentPadding: PaddingValues = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
    content: @Composable RowScope.() -> Unit,
) {
    CompositionLocalProvider(LocalTvFocusRadius provides 999.dp) {
        androidx.compose.material3.TextButton(
            onClick = onClick,
            modifier = Modifier.heightIn(min = 32.dp, max = 40.dp).then(modifier),
            enabled = enabled,
            shape = shape,
            colors = colors,
            contentPadding = contentPadding,
        ) {
            CompositionLocalProvider(
                LocalTextStyle provides LocalTextStyle.current.merge(
                    TextStyle(
                        fontFamily = TvType.BodyMedium,
                        fontSize = if (LocalTvDialogCompact.current) 12.sp else 13.sp,
                    ),
                ),
            ) { content() }
        }
    }
}

/**
 * Dialog sheet: raised ink surface with a hairline, an amber rule before the
 * condensed title and quiet body text.
 */
@Composable
internal fun TvAlertDialog(
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: (@Composable () -> Unit)? = null,
    icon: (@Composable () -> Unit)? = null,
    title: (@Composable () -> Unit)? = null,
    text: (@Composable () -> Unit)? = null,
    properties: DialogProperties = DialogProperties(),
) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismissRequest,
        confirmButton = { CompositionLocalProvider(LocalTvDialogCompact provides true) { confirmButton() } },
        modifier = modifier
            .widthIn(min = 280.dp, max = 380.dp)
            .tvHairline(tvTone(TvTone.SurfaceTop), 22f),
        dismissButton = dismissButton?.let { slot -> { CompositionLocalProvider(LocalTvDialogCompact provides true) { slot() } } },
        icon = icon,
        title = title?.let { slot ->
            {
                Column {
                    Box(
                        Modifier
                            .padding(bottom = 10.dp)
                            .width(28.dp)
                            .height(3.dp)
                            .background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)),
                    )
                    CompositionLocalProvider(
                        LocalTextStyle provides TextStyle(fontFamily = TvType.Display, fontSize = 20.sp, lineHeight = 23.sp),
                    ) { slot() }
                }
            }
        },
        text = text?.let { slot ->
            {
                CompositionLocalProvider(
                    LocalTextStyle provides LocalTextStyle.current.merge(TextStyle(fontSize = 12.sp, lineHeight = 17.sp)),
                    LocalTvDialogCompact provides true,
                ) { slot() }
            }
        },
        shape = RoundedCornerShape(22.dp),
        containerColor = tvTone(TvTone.SurfaceHigh),
        iconContentColor = tvTone(TvTone.Accent),
        titleContentColor = tvTone(TvTone.Text),
        textContentColor = tvTone(TvTone.TextSoft),
        tonalElevation = 0.dp,
        properties = properties,
    )
}

@Composable
internal fun tvTextFieldColors(): TextFieldColors = OutlinedTextFieldDefaults.colors(
    focusedContainerColor = tvTone(TvTone.SurfaceHigh),
    unfocusedContainerColor = tvTone(TvTone.Surface),
    disabledContainerColor = tvTone(TvTone.Surface).copy(alpha = 0.5f),
    focusedBorderColor = tvTone(TvTone.Accent),
    unfocusedBorderColor = tvTone(TvTone.SurfaceTop),
    focusedTextColor = tvTone(TvTone.Text),
    unfocusedTextColor = tvTone(TvTone.Text),
    focusedLabelColor = tvTone(TvTone.Accent),
    unfocusedLabelColor = tvTone(TvTone.Muted),
    focusedPlaceholderColor = tvTone(TvTone.Muted),
    unfocusedPlaceholderColor = tvTone(TvTone.Muted),
    focusedLeadingIconColor = tvTone(TvTone.Accent),
    unfocusedLeadingIconColor = tvTone(TvTone.Muted),
    focusedTrailingIconColor = tvTone(TvTone.TextSoft),
    unfocusedTrailingIconColor = tvTone(TvTone.Muted),
    focusedSupportingTextColor = tvTone(TvTone.Muted),
    unfocusedSupportingTextColor = tvTone(TvTone.Muted),
    cursorColor = tvTone(TvTone.Accent),
    errorBorderColor = tvTone(TvTone.Live),
    errorLabelColor = tvTone(TvTone.Live),
    errorSupportingTextColor = tvTone(TvTone.Live),
)

@Composable
internal fun TvOutlinedTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    readOnly: Boolean = false,
    textStyle: TextStyle = LocalTextStyle.current,
    label: (@Composable () -> Unit)? = null,
    placeholder: (@Composable () -> Unit)? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    singleLine: Boolean = false,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    minLines: Int = 1,
    shape: Shape = RoundedCornerShape(14.dp),
    colors: TextFieldColors = tvTextFieldColors(),
    // Google TV opens its IME as soon as an editor gains focus, so plain
    // D-pad traversal through a form would pop the keyboard on every field.
    // With false the field takes focus quietly and OK on the remote opens
    // the keyboard.
    showKeyboardOnFocus: Boolean = true,
) {
    // Material's 24sp body line height does not fit the compact TV fields
    // (labels float over a 44-52dp box); tie it to the actual font size so
    // typed text is never clipped below the field.
    // Fields without an explicit size inherit Material's 16sp body text,
    // which is oversized next to the 12sp form fields; cap it.
    val size = if (textStyle.fontSize.isSp && textStyle.fontSize.value <= 13f) textStyle.fontSize else 12.sp
    val compactStyle = textStyle.copy(fontSize = size, lineHeight = size * 1.3f)
    // Material's OutlinedTextField reserves 16dp above and below the text,
    // which clips typed text in the 44-48dp fields a TV form needs to fit on
    // one screen. Build the same decoration with TV-sized inner padding.
    val interactionSource = androidx.compose.runtime.remember { MutableInteractionSource() }
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    // Google TV's IME opens whenever an editor starts an input session,
    // regardless of showKeyboardOnFocus. A quiet field therefore stays
    // read-only (no session) while merely focused and becomes editable on
    // OK or a tap; leaving the field makes it quiet again.
    val quietFocus = !showKeyboardOnFocus && !readOnly && enabled
    var editing by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(interactionSource, quietFocus) {
        if (!quietFocus) return@LaunchedEffect
        interactionSource.interactions.collect {
            if (it is androidx.compose.foundation.interaction.PressInteraction.Release) editing = true
        }
    }
    androidx.compose.runtime.LaunchedEffect(editing) {
        if (editing) {
            kotlinx.coroutines.delay(60)
            keyboardController?.show()
        }
    }
    val textColor = tvTone(TvTone.Text)
    val cursor = androidx.compose.ui.graphics.SolidColor(if (isError) tvTone(TvTone.Live) else tvTone(TvTone.Accent))
    androidx.compose.foundation.text.BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .defaultMinSize(minHeight = 40.dp)
            .then(
                if (!quietFocus) Modifier
                else Modifier
                    .onFocusChanged { if (!it.isFocused) editing = false }
                    // Read-only fields expose no SetText action; keep
                    // accessibility services (and UI tests) able to type.
                    .semantics {
                        if (!editing) {
                            setText { text ->
                                editing = true
                                onValueChange(text.text)
                                true
                            }
                        }
                    }
                    .onPreviewKeyEvent { event ->
                        val ok = !editing && (
                            event.key == Key.DirectionCenter ||
                                (singleLine && (event.key == Key.Enter || event.key == Key.NumPadEnter))
                            )
                        if (ok && event.type == KeyEventType.KeyUp) editing = true
                        ok
                    },
            ),
        enabled = enabled,
        readOnly = readOnly || (quietFocus && !editing),
        textStyle = compactStyle.merge(TextStyle(color = textColor)),
        cursorBrush = cursor,
        visualTransformation = visualTransformation,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        interactionSource = interactionSource,
        singleLine = singleLine,
        maxLines = maxLines,
        minLines = minLines,
    ) { innerTextField ->
        OutlinedTextFieldDefaults.DecorationBox(
            value = value,
            visualTransformation = visualTransformation,
            innerTextField = innerTextField,
            placeholder = placeholder,
            // Material animates labels between 16sp and 12sp; scale both
            // states to the TV form's 12sp/9sp so every label matches.
            label = label?.let { slot ->
                {
                    val current = LocalTextStyle.current
                    CompositionLocalProvider(
                        LocalTextStyle provides current.copy(
                            fontSize = if (current.fontSize.isSp) current.fontSize * 0.75f else 12.sp,
                        ),
                    ) { slot() }
                }
            },
            leadingIcon = leadingIcon,
            trailingIcon = trailingIcon,
            supportingText = supportingText,
            singleLine = singleLine,
            enabled = enabled,
            isError = isError,
            interactionSource = interactionSource,
            colors = colors,
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            container = {
                OutlinedTextFieldDefaults.Container(
                    enabled = enabled,
                    isError = isError,
                    interactionSource = interactionSource,
                    colors = colors,
                    shape = shape,
                )
            },
        )
    }
}

/** Header used inside full-screen TV dialogs (manage groups/categories, pickers). */
@Composable
internal fun TvDialogHeader(title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier) {
        Box(
            Modifier
                .padding(bottom = 10.dp)
                .width(28.dp)
                .height(3.dp)
                .background(tvTone(TvTone.Accent), RoundedCornerShape(2.dp)),
        )
        Text(title, color = tvTone(TvTone.Text), fontFamily = TvType.Display, fontSize = 22.sp, lineHeight = 25.sp)
        subtitle?.let {
            Text(it, modifier = Modifier.fillMaxWidth().padding(top = 4.dp), color = tvTone(TvTone.Muted), fontSize = 12.sp)
        }
    }
}

/**
 * tv-material Card without its own focus effects. Every card also carries the
 * Nocturno focus ring (tvDpadClick/tvDpadFocus), so the library's default
 * 1.1× zoom and focus border would draw a second, misaligned highlight.
 */
@Composable
internal fun TvCard(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: androidx.tv.material3.CardShape = androidx.tv.material3.CardDefaults.shape(RoundedCornerShape(12.dp)),
    colors: androidx.tv.material3.CardColors = androidx.tv.material3.CardDefaults.colors(),
    scale: androidx.tv.material3.CardScale = androidx.tv.material3.CardDefaults.scale(focusedScale = 1f),
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    androidx.tv.material3.Card(
        onClick = onClick,
        modifier = modifier,
        shape = shape,
        colors = colors,
        scale = scale,
        border = androidx.tv.material3.CardDefaults.border(
            focusedBorder = androidx.tv.material3.Border.None,
            pressedBorder = androidx.tv.material3.Border.None,
        ),
        glow = androidx.tv.material3.CardDefaults.glow(),
        content = content,
    )
}
