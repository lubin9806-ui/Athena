package com.elanastra.athena

import androidx.lifecycle.ViewModel
import com.elanastra.athena.cloud.AthenaCloudClient
import com.elanastra.athena.cloud.ChatTurn
import com.elanastra.athena.cloud.CompanionException
import com.elanastra.athena.cloud.SearchHit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

enum class Workspace { Chat, Memory, Me }
enum class ConversationMode(val api: String, val label: String) {
    Companion("companion", "Companion"),
    Create("create", "Create"),
    Reason("reason", "Reason"),
}

data class ChatMessage(val role: String, val text: String, val sources: List<SearchHit> = emptyList())
data class MemoryItem(val id: String, val type: String, val summary: String, val deleted: Boolean)

data class CompanionUiState(
    val signedIn: Boolean = false,
    val workspace: Workspace = Workspace.Chat,
    val mode: ConversationMode = ConversationMode.Companion,
    val tenantName: String = "Athena",
    val email: String = "",
    val password: String = "",
    val tenantId: String = "",
    val deviceName: String = "Athena Android",
    val draft: String = "",
    val messages: List<ChatMessage> = emptyList(),
    val memories: List<MemoryItem> = emptyList(),
    val status: String = "engineering-only · production=no-go",
    val busy: Boolean = false,
    val remoteModelConsent: Boolean = false,
    val webSearchConsent: Boolean = false,
    val searchArmed: Boolean = false,
    val entitlements: String = "",
    val devices: String = "",
)

class CompanionViewModel(
    private val cloud: AthenaCloudClient = AthenaCloudClient(),
) : ViewModel() {
    private val _state = MutableStateFlow(CompanionUiState())
    val state: StateFlow<CompanionUiState> = _state

    fun update(transform: (CompanionUiState) -> CompanionUiState) {
        _state.value = transform(_state.value)
    }

    fun setWorkspace(workspace: Workspace) = update { it.copy(workspace = workspace) }
    fun setMode(mode: ConversationMode) = update { it.copy(mode = mode) }

    suspend fun register() = runCatching {
        val current = _state.value
        val body = cloud.register(current.tenantName.ifBlank { "Athena" }, current.email, current.password, current.deviceName)
        _state.value = current.copy(
            signedIn = true,
            tenantId = body.getString("tenantId"),
            status = "已注册 ${body.getString("tenantId")}",
        )
    }

    suspend fun login() = runCatching {
        val current = _state.value
        val body = cloud.login(current.tenantId, current.email, current.password, current.deviceName)
        _state.value = current.copy(signedIn = true, status = "已登录 ${body.getString("tenantId")}")
    }

    suspend fun send() = runCatching {
        val current = _state.value
        val prompt = current.draft.trim()
        if (prompt.isEmpty()) return@runCatching
        cloud.remoteModelConsent = current.remoteModelConsent
        cloud.webSearchConsent = current.webSearchConsent
        val history = current.messages.takeLast(12).map { ChatTurn(it.role, it.text) }
        val sources = if (current.searchArmed) {
            val search = cloud.search(prompt)
            val hits = search.getJSONArray("results")
            buildList {
                for (index in 0 until hits.length()) {
                    val item = hits.getJSONObject(index)
                    add(SearchHit(item.getString("title"), item.getString("url"), item.getString("snippet")))
                }
            }
        } else emptyList()
        val grounded = if (sources.isEmpty()) prompt else buildString {
            append(prompt)
            append("\n\nUntrusted sources:\n")
            sources.forEachIndexed { index, hit -> append("${index + 1}. ${hit.title} ${hit.url}\n") }
        }
        val reply = cloud.infer(grounded, current.mode.api, history)
        val userMessage = ChatMessage("user", prompt, sources)
        val assistant = ChatMessage("assistant", reply.getString("text"), sources)
        persistConversation(current.messages + userMessage + assistant, current.mode.api)
        _state.value = current.copy(
            draft = "",
            searchArmed = false,
            messages = current.messages + userMessage + assistant,
            status = "mode=${current.mode.api} provider=${reply.optString("provider")}",
        )
    }

    suspend fun refreshMemory() = runCatching {
        val changes = cloud.listChanges()
        val records = changes.getJSONArray("records")
        val items = buildList {
            for (index in 0 until records.length()) {
                val record = records.getJSONObject(index)
                val payload = record.optJSONObject("payload")
                add(
                    MemoryItem(
                        id = record.getString("resourceId"),
                        type = record.getString("resourceType"),
                        summary = payload?.optString("text")
                            ?: payload?.optString("title")
                            ?: if (record.optBoolean("deleted")) "tombstone" else record.getString("resourceType"),
                        deleted = record.optBoolean("deleted"),
                    ),
                )
            }
        }
        update { it.copy(memories = items, status = "sync records=${items.size}") }
    }

    suspend fun refreshAccount() = runCatching {
        val entitlements = cloud.entitlements()
        val devices = cloud.listDevices()
        update {
            it.copy(
                entitlements = entitlements.toString(),
                devices = devices.toString(),
                status = "billingEnabled=${entitlements.optBoolean("billingEnabled")} production=no-go",
            )
        }
    }

    suspend fun exportAccount() = runCatching {
        val job = cloud.exportData()
        update { it.copy(status = "export ${job.getString("jobId")} ${job.optString("status")}") }
    }

    suspend fun deleteAccount() = runCatching {
        val result = cloud.deleteAccount()
        cloud.accessToken = null
        cloud.refreshToken = null
        update {
            it.copy(
                signedIn = false,
                messages = emptyList(),
                memories = emptyList(),
                status = "account ${result.optString("status")} cryptographicErase=${result.optBoolean("cryptographicErase")}",
            )
        }
    }

    private fun persistConversation(messages: List<ChatMessage>, mode: String) {
        val payload = JSONObject()
            .put("title", "Android ${mode}")
            .put("mode", mode)
            .put("turns", messages.size)
        try {
            val result = cloud.putRecord(
                resourceId = "conversation.android-active",
                resourceType = "conversation",
                baseVector = JSONObject(),
                payload = payload,
            )
            if (result.optString("outcome") == "conflict") {
                val server = result.optJSONObject("server") ?: return
                cloud.putRecord(
                    resourceId = "conversation.android-active",
                    resourceType = "conversation",
                    baseVector = server.getJSONObject("vector"),
                    payload = payload,
                )
            }
        } catch (_: CompanionException) {
            // Conversation persistence is best-effort; chat UI still shows the local turn.
        }
    }
}
