package org.tvshell.iptvnator.backend;

import java.util.Map;

/**
 * A failed provider request, carrying either an HTTP status + reason phrase
 * or a network error code. {@link #toErrorBody()} produces the same JSON the
 * web backend's {@code normalizeProviderError()} returns.
 */
public class ProviderException extends Exception {
    private static final long serialVersionUID = 1L;

    /** HTTP status of the provider's answer, or 0 for network failures. */
    public final int status;
    public final String statusText;
    /** Node-style network error code (ENOTFOUND, ECONNREFUSED, ...), may be null. */
    public String code;

    public ProviderException(int status, String statusText) {
        super("HTTP " + status + " " + statusText);
        this.status = status;
        this.statusText = statusText;
        this.code = null;
    }

    public ProviderException(String message, String code) {
        super(message);
        this.status = 0;
        this.statusText = null;
        this.code = code;
    }

    public boolean hasHttpStatus() {
        return status > 0;
    }

    /** {@code { message, status, code? }} as normalizeProviderError() builds it. */
    public Map<String, Object> toErrorBody() {
        Map<String, Object> body = Json.object();
        if (hasHttpStatus()) {
            body.put("message", statusText == null ? "Bad Gateway" : statusText);
            body.put("status", Integer.valueOf(status));
            return body;
        }
        body.put("message", code == null ? "Bad Gateway" : "Bad Gateway (" + code + ")");
        body.put("status", Integer.valueOf(502));
        if (code != null) body.put("code", code);
        return body;
    }
}
