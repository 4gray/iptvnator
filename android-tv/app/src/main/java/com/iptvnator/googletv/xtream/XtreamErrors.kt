package com.iptvnator.googletv.xtream

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** Turns transport/API failures into messages that are actionable from a TV remote. */
fun friendlyXtreamError(failure: Throwable): String {
    val cause = generateSequence(failure) { it.cause }.lastOrNull() ?: failure
    return when (cause) {
        is UnknownHostException -> "No se encuentra el servidor Xtream. Comprueba la dirección y la red."
        is SocketTimeoutException -> "El servidor Xtream no responde a tiempo. Puede estar caído o bloqueando la conexión."
        is ConnectException -> "No se puede conectar con el servidor Xtream. Comprueba el puerto o si el servidor está activo."
        is SSLException -> "No se pudo establecer la conexión segura con el servidor Xtream."
        is IOException -> "Error de red al conectar con Xtream: ${cause.message ?: "conexión no disponible"}"
        else -> {
            val message = failure.message.orEmpty()
            when {
                message.contains("HTTP 401") || message.contains("HTTP 403") ->
                    "El servidor Xtream ha rechazado las credenciales o el acceso."
                message.contains("HTTP ") ->
                    "El servidor Xtream respondió con un error: $message"
                message.contains("authentication failed", ignoreCase = true) ->
                    "La cuenta Xtream no está activa o el servidor ha rechazado el usuario o la contraseña."
                message.contains("account expired", ignoreCase = true) ->
                    "La cuenta Xtream ha caducado. Solicita al proveedor una cuenta activa."
                message.isNotBlank() -> message
                else -> "No se pudo conectar con Xtream."
            }
        }
    }
}
