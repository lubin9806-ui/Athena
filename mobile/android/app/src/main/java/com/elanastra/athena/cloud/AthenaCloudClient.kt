package com.elanastra.athena.cloud

import com.elanastra.athena.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class CompanionException(
    val status: Int,
    val code: String,
    message: String,
    val payload: JSONObject? = null,
) : Exception(message)

data class ChatTurn(val role: String, val content: String)
data class SearchHit(val title: String, val url: String, val snippet: String)

class AthenaCloudClient(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build(),
) {
    var baseUrl: String = BuildConfig.DEFAULT_CLOUD_BASE_URL.trimEnd('/')
    var accessToken: String? = null
    var refreshToken: String? = null
    var tenantId: String? = null
    var userId: String? = null
    var remoteModelConsent: Boolean = false
    var webSearchConsent: Boolean = false

    fun requireBaseUrl() {
        if (baseUrl.isBlank()) {
            throw CompanionException(0, "base-url-missing", "Companion production flavor refuses an empty Cloud base URL.")
        }
        val loopback = baseUrl.startsWith("http://127.0.0.1") ||
            baseUrl.startsWith("http://localhost") ||
            baseUrl.startsWith("http://10.0.2.2")
        if (baseUrl.startsWith("http://") && (!BuildConfig.ALLOW_LOOPBACK_CLEARTEXT || !loopback)) {
            throw CompanionException(0, "cleartext-forbidden", "Cleartext Cloud URLs are only allowed for loopback fixtures.")
        }
    }

    fun health(): JSONObject {
        val live = request("GET", "/health/live", auth = false)
        val ready = request("GET", "/health/ready", auth = false)
        return JSONObject().put("live", live).put("ready", ready)
    }

    fun register(tenantName: String, email: String, password: String, deviceName: String): JSONObject {
        val body = request(
            "POST",
            "/v1/auth/register",
            auth = false,
            json = JSONObject()
                .put("tenantName", tenantName)
                .put("email", email)
                .put("password", password)
                .put("deviceName", deviceName)
                .put("platform", "android"),
        )
        applySession(body)
        return body
    }

    fun login(
        tenantId: String,
        email: String,
        password: String,
        deviceName: String,
        mfaCode: String? = null,
        recoveryCode: String? = null,
    ): JSONObject {
        val body = request(
            "POST",
            "/v1/auth/login",
            auth = false,
            json = JSONObject()
                .put("tenantId", tenantId)
                .put("email", email)
                .put("password", password)
                .put("mfaCode", mfaCode ?: JSONObject.NULL)
                .put("recoveryCode", recoveryCode ?: JSONObject.NULL)
                .put("deviceName", deviceName)
                .put("platform", "android"),
        )
        applySession(body)
        return body
    }

    fun infer(prompt: String, mode: String, history: List<ChatTurn> = emptyList()): JSONObject {
        if (!remoteModelConsent) throw CompanionException(403, "consent-required", "Remote model consent is required before Cloud inference.")
        if (mode == "execute") throw CompanionException(400, "invalid-mode", "Android Companion excludes Execute mode.")
        val payload = JSONObject().put("prompt", prompt).put("mode", mode)
        if (history.isNotEmpty()) {
            val items = JSONArray()
            history.forEach { turn ->
                items.put(JSONObject().put("role", turn.role).put("content", turn.content))
            }
            payload.put("history", items)
        }
        return request("POST", "/v1/model/responses", json = payload, idempotent = true)
    }

    fun search(query: String, maxResults: Int = 5): JSONObject {
        if (!webSearchConsent) throw CompanionException(403, "consent-required", "Web search consent is required before Cloud search.")
        return request(
            "POST",
            "/v1/search/query",
            json = JSONObject().put("query", query).put("maxResults", maxResults),
            idempotent = true,
        )
    }

    fun putRecord(
        resourceId: String,
        resourceType: String,
        baseVector: JSONObject,
        payload: JSONObject?,
        deleted: Boolean = false,
    ): JSONObject {
        return request(
            "PUT",
            "/v1/sync/records/$resourceId",
            json = JSONObject()
                .put("resourceId", resourceId)
                .put("resourceType", resourceType)
                .put("schemaVersion", 1)
                .put("baseVector", baseVector)
                .put("payload", payload ?: JSONObject.NULL)
                .put("deleted", deleted),
            idempotent = true,
        )
    }

    fun listChanges(): JSONObject = request("GET", "/v1/sync/changes?limit=100")
    fun entitlements(): JSONObject = request("GET", "/v1/entitlements")
    fun listDevices(): JSONObject = request("GET", "/v1/devices")
    fun exportData(): JSONObject = request("POST", "/v1/data/exports")
    fun deleteAccount(): JSONObject {
        val id = tenantId ?: throw CompanionException(401, "invalid-session", "Session is missing.")
        return request("DELETE", "/v1/account", json = JSONObject().put("confirmation", "DELETE $id"))
    }

    fun logout() {
        request("POST", "/v1/auth/logout")
        accessToken = null
        refreshToken = null
    }

    private fun applySession(body: JSONObject) {
        accessToken = body.getString("accessToken")
        refreshToken = body.getString("refreshToken")
        tenantId = body.getString("tenantId")
        userId = body.getString("userId")
    }

    private fun request(
        method: String,
        path: String,
        auth: Boolean = true,
        json: JSONObject? = null,
        idempotent: Boolean = false,
        retried: Boolean = false,
    ): JSONObject {
        requireBaseUrl()
        val builder = Request.Builder()
            .url("$baseUrl$path")
            .header("Accept", "application/json")
            .header("X-Request-ID", UUID.randomUUID().toString())
        if (auth) {
            val token = accessToken ?: throw CompanionException(401, "invalid-session", "Session is missing.")
            builder.header("Authorization", "Bearer $token")
        }
        if (idempotent) builder.header("Idempotency-Key", UUID.randomUUID().toString())
        val media = "application/json; charset=utf-8".toMediaType()
        val body = json?.toString()?.toRequestBody(media)
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> if (body != null) builder.delete(body) else builder.delete()
            "POST" -> builder.post(body ?: ByteArray(0).toRequestBody(null))
            "PUT" -> builder.put(body ?: ByteArray(0).toRequestBody(media))
            else -> builder.method(method, body)
        }
        val response = http.newCall(builder.build()).execute()
        val text = response.body?.string().orEmpty()
        val parsed = if (text.isBlank()) JSONObject() else JSONObject(text)
        if (response.code == 409 && parsed.optString("outcome") == "conflict") return parsed
        if (response.code == 401 && parsed.optString("title") == "session-expired" && !retried && !refreshToken.isNullOrBlank()) {
            refreshSession()
            return request(method, path, auth, json, idempotent, retried = true)
        }
        if (!response.isSuccessful) {
            throw CompanionException(
                response.code,
                parsed.optString("title", "http-error"),
                parsed.optString("detail", text),
                parsed,
            )
        }
        return parsed
    }

    private fun refreshSession() {
        val body = request(
            "POST",
            "/v1/auth/refresh",
            auth = false,
            json = JSONObject().put("refreshToken", refreshToken),
        )
        accessToken = body.getString("accessToken")
        refreshToken = body.getString("refreshToken")
    }
}
