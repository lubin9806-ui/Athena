package com.elanastra.athena.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.elanastra.athena.CompanionUiState
import com.elanastra.athena.CompanionViewModel
import com.elanastra.athena.ConversationMode
import com.elanastra.athena.Workspace
import kotlinx.coroutines.launch

@Composable
fun AthenaCompanionApp(
    model: CompanionViewModel,
    onRequestMic: () -> Unit,
    onSpeak: (String) -> Unit,
) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val go: (suspend () -> Unit) -> Unit = { block -> scope.launch { block() } }
    Scaffold(
        bottomBar = {
            if (state.signedIn) {
                NavigationBar {
                    NavigationBarItem(state.workspace == Workspace.Chat, { model.setWorkspace(Workspace.Chat) }, { Text("对话") }, label = { Text("对话") })
                    NavigationBarItem(state.workspace == Workspace.Memory, {
                        model.setWorkspace(Workspace.Memory)
                        scope.launch { model.refreshMemory() }
                    }, { Text("记忆") }, label = { Text("记忆") })
                    NavigationBarItem(state.workspace == Workspace.Me, {
                        model.setWorkspace(Workspace.Me)
                        scope.launch { model.refreshAccount() }
                    }, { Text("我的") }, label = { Text("我的") })
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Athena Companion")
            Text(state.status)
            if (!state.signedIn) AuthPane(state, model, go) else when (state.workspace) {
                Workspace.Chat -> ChatPane(state, model, onRequestMic, onSpeak, go)
                Workspace.Memory -> MemoryPane(state, go, model)
                Workspace.Me -> AccountPane(state, model, go)
            }
        }
    }
}

@Composable
private fun AuthPane(state: CompanionUiState, model: CompanionViewModel, launch: (suspend () -> Unit) -> Unit) {
    OutlinedTextField(state.tenantName, { value -> model.update { it.copy(tenantName = value) } }, label = { Text("租户名") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(state.email, { value -> model.update { it.copy(email = value) } }, label = { Text("邮箱") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(state.password, { value -> model.update { it.copy(password = value) } }, label = { Text("密码") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(state.tenantId, { value -> model.update { it.copy(tenantId = value) } }, label = { Text("登录用 tenantId") }, modifier = Modifier.fillMaxWidth())
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { launch { model.register().onFailure { error -> model.update { it.copy(status = error.message ?: "register failed") } } } }) { Text("注册") }
        OutlinedButton(onClick = { launch { model.login().onFailure { error -> model.update { it.copy(status = error.message ?: "login failed") } } } }) { Text("登录") }
    }
    Text("debug 默认连接本机 Cloud fixture。release 无基址时 fail-closed。")
}

@Composable
private fun ChatPane(
    state: CompanionUiState,
    model: CompanionViewModel,
    onRequestMic: () -> Unit,
    onSpeak: (String) -> Unit,
    launch: (suspend () -> Unit) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ConversationMode.entries.forEach { mode ->
            FilterChip(selected = state.mode == mode, onClick = { model.setMode(mode) }, label = { Text(mode.label) })
        }
    }
    ConsentRow("云推理同意", state.remoteModelConsent) { checked -> model.update { it.copy(remoteModelConsent = checked) } }
    ConsentRow("云搜索同意", state.webSearchConsent) { checked -> model.update { it.copy(webSearchConsent = checked) } }
    ConsentRow("下一句附带搜索", state.searchArmed) { checked -> model.update { it.copy(searchArmed = checked) } }
    LazyColumn(Modifier.weight(1f, fill = true)) {
        items(state.messages) { message ->
            Text("${message.role}: ${message.text}")
            message.sources.forEach { source -> Text("  ${source.title} · ${source.url}") }
            Spacer(Modifier.height(8.dp))
        }
    }
    OutlinedTextField(state.draft, { value -> model.update { it.copy(draft = value) } }, label = { Text("输入") }, modifier = Modifier.fillMaxWidth())
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { launch { model.send().onFailure { error -> model.update { it.copy(status = error.message ?: "send failed") } } } }) { Text("发送") }
        OutlinedButton(onClick = onRequestMic) { Text("麦克风") }
        OutlinedButton(onClick = { state.messages.lastOrNull { it.role == "assistant" }?.text?.let(onSpeak) }) { Text("朗读") }
    }
}

@Composable
private fun MemoryPane(state: CompanionUiState, launch: (suspend () -> Unit) -> Unit, model: CompanionViewModel) {
    Button(onClick = { launch { model.refreshMemory().onFailure { error -> model.update { it.copy(status = error.message ?: "sync failed") } } } }) { Text("刷新同步") }
    LazyColumn {
        items(state.memories) { item ->
            Text("${item.type} · ${item.id}${if (item.deleted) " · tombstone" else ""}")
            Text(item.summary)
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun AccountPane(state: CompanionUiState, model: CompanionViewModel, launch: (suspend () -> Unit) -> Unit) {
    Text("Play Billing 仅沙箱协议。当前 Cloud billing=local-no-charge，不会扣款。")
    Text(state.entitlements.ifBlank { "尚未加载权益" })
    Text(state.devices.ifBlank { "尚未加载设备" })
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { launch { model.refreshAccount() } }) { Text("刷新") }
        OutlinedButton(onClick = { launch { model.exportAccount().onFailure { error -> model.update { it.copy(status = error.message ?: "export failed") } } } }) { Text("导出") }
        Button(onClick = { launch { model.deleteAccount().onFailure { error -> model.update { it.copy(status = error.message ?: "delete failed") } } } }) { Text("删除账号") }
    }
}

@Composable
private fun ConsentRow(label: String, checked: Boolean, onChecked: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label)
        Switch(checked, onChecked)
    }
}
