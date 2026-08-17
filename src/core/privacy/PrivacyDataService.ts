import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getAppSettings, getSettingsBundle, shouldSaveHistory } from '../config/SettingsStore';
import { resolveProjectRoot, resolveSkillStateFile, resolveWritableConfigFile } from '../runtime/Paths';
import {
  getDatabase,
  getDatabaseBackupDir,
  getDatabaseFilePath,
  getStats,
} from '../../memory/database';
import type { AppSettings, NetworkConsentSettings, PrivacySettings } from '../../shared/types';
import { APP_VERSION } from '../../shared/constants';
import { resolveAttachmentRoot } from '../attachments';

export type DataActivityCategory = 'search' | 'voice' | 'tool' | 'settings' | 'maintenance';
export type ExportFormat = 'json' | 'markdown';

export interface DataMapItem {
  id: string;
  label: string;
  stored: string;
  locations: string[];
  leavesDevice: string;
  retention: string;
  controls: string[];
}

export interface NetworkCapabilityNotice {
  id: keyof NetworkConsentSettings;
  label: string;
  sends: string;
  destinations: string;
  defaultState: 'off-until-consent';
  consented: boolean;
}

export interface StaticProtectionDecision {
  status: 'plaintext-sqlite-with-compensating-controls';
  claim: string;
  threatAssessment: string[];
  decision: string;
  verification: string[];
}

export interface PrivacyCenterState {
  generatedAt: string;
  dataMap: DataMapItem[];
  networkCapabilities: NetworkCapabilityNotice[];
  staticProtection: StaticProtectionDecision;
  stats: ReturnType<typeof getStats>;
  paths: {
    database: string;
    config: string;
    exports: string;
    voiceTemp: string;
    backups: string;
    attachments: string;
  };
}

export interface SupplementalPrivacyData {
  agentSkills?: {
    packages: Record<string, unknown>;
    invocations: unknown[];
  };
  integrations?: {
    version: number;
    servers: unknown[];
  };
}

export interface LocalDataClearHooks {
  clearSkillInvocationHistory?: () => number;
  clearAttachmentFiles?: () => number;
}

const VOICE_EXPORT_MAX_BYTES = 12 * 1024 * 1024;
const ACTIVITY_DETAIL_MAX_CHARS = 16_000;

export function getVoiceTempDir(): string {
  return process.env.ATHENA_VOICE_TEMP_DIR || path.join(os.tmpdir(), 'athena', 'voice');
}

export function getPrivacyCenterState(): PrivacyCenterState {
  const settings = getAppSettings();
  return {
    generatedAt: new Date().toISOString(),
    dataMap: buildDataMap(settings),
    networkCapabilities: buildNetworkCapabilityNotices(settings.privacy.networkConsent),
    staticProtection: buildStaticProtectionDecision(),
    stats: getStats(),
    paths: {
      database: getDatabaseFilePath(),
      config: path.dirname(resolveWritableConfigFile('settings.json')),
      exports: getExportDir(),
      voiceTemp: getVoiceTempDir(),
      backups: getDatabaseBackupDir(),
      attachments: resolveAttachmentRoot(),
    },
  };
}

export function canUseNetworkCapability(capability: keyof NetworkConsentSettings): boolean {
  return getAppSettings().privacy.networkConsent[capability] === true;
}

export function consentRequiredMessage(capability: keyof NetworkConsentSettings): string {
  const labels: Record<keyof NetworkConsentSettings, string> = {
    remoteModel: '远程模型服务',
    webSearch: '联网搜索',
    imageGeneration: 'OpenAI 生图服务',
    onlineSpeechToText: '在线语音识别',
    onlineTextToSpeech: '在线语音合成',
    externalToolNetwork: '执行模式外部网络工具',
  };
  return `${labels[capability]}需要先在“隐私与数据中心”阅读说明并明确同意。`;
}

export function recordDataActivity(
  category: DataActivityCategory,
  action: string,
  detail: Record<string, unknown> = {},
): void {
  if (!shouldSaveHistory()) return;
  const safeDetail = JSON.stringify(detail).slice(0, ACTIVITY_DETAIL_MAX_CHARS);
  getDatabase().prepare(`
    INSERT INTO data_activity_records (category, action, detail_json)
    VALUES (?, ?, ?)
  `).run(category, action.slice(0, 80), safeDetail);
}

export function applyDataRetention(now: Date = new Date()): { messagesDeleted: number; activityDeleted: number } {
  const settings = getAppSettings();
  const days = settings.data.historyRetentionDays;
  cleanupVoiceCache(settings.data.voiceCacheRetentionHours, now);
  if (days <= 0) return { messagesDeleted: 0, activityDeleted: 0 };

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const db = getDatabase();
  const oldMessageIds = db.prepare('SELECT id FROM messages WHERE created_at < ?').all(cutoff) as { id: number }[];
  const deleteMessages = db.transaction((ids: { id: number }[]) => {
    for (const row of ids) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(row.id);
      db.prepare("DELETE FROM memory_index WHERE source_table = 'messages' AND source_id = ?").run(row.id);
    }
  });
  deleteMessages(oldMessageIds);
  const activityDeleted = db.prepare('DELETE FROM data_activity_records WHERE created_at < ?').run(cutoff).changes;
  return { messagesDeleted: oldMessageIds.length, activityDeleted };
}

export function cleanupVoiceCache(retentionHours = getAppSettings().data.voiceCacheRetentionHours, now: Date = new Date()): number {
  const voiceDir = getVoiceTempDir();
  if (!fs.existsSync(voiceDir)) return 0;
  const cutoff = now.getTime() - Math.max(1, retentionHours) * 60 * 60 * 1000;
  let removed = 0;
  for (const fileName of fs.readdirSync(voiceDir)) {
    const fullPath = path.join(voiceDir, fileName);
    if (!isVoiceCacheFile(fullPath)) continue;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs >= cutoff) continue;
      fs.rmSync(fullPath, { force: true });
      removed += 1;
    } catch {
      // Cache cleanup is best effort.
    }
  }
  return removed;
}

export function clearAllLocalData(hooks: LocalDataClearHooks = {}): {
  deletedTables: string[];
  voiceCacheFilesDeleted: number;
  skillInvocationsDeleted: number;
  attachmentFilesDeleted: number;
} {
  const db = getDatabase();
  const attachmentFilesDeleted = hooks.clearAttachmentFiles?.() ?? 0;
  const deletedTables = [
    'agent_run_events',
    'agent_approvals',
    'agent_artifacts',
    'agent_steps',
    'agent_runs',
    'agent_tasks',
    'context_snapshots',
    'chat_attachments',
    'chat_messages',
    'chat_windows',
    'projects',
    'messages',
    'profile',
    'events',
    'daily_memory_summaries',
    'procedural_memories',
    'memory_entities',
    'memory_facts',
    'memory_fact_sources',
    'memory_review_queue',
    'project_notes',
    'memory_index',
    'data_activity_records',
  ];
  db.transaction(() => {
    for (const table of deletedTables) db.prepare(`DELETE FROM ${table}`).run();
  })();
  try {
    db.prepare('VACUUM').run();
  } catch {
    // WAL mode or open readers may defer compaction; deletion is the privacy control.
  }
  const voiceCacheFilesDeleted = cleanupVoiceCache(1, new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000));
  const skillInvocationsDeleted = hooks.clearSkillInvocationHistory?.() ?? 0;
  return { deletedTables, voiceCacheFilesDeleted, skillInvocationsDeleted, attachmentFilesDeleted };
}

export function exportAllData(
  format: ExportFormat = getAppSettings().data.exportFormat,
  supplemental: SupplementalPrivacyData = {},
): { path: string; bytes: number } {
  const exportDir = getExportDir();
  fs.mkdirSync(exportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = format === 'markdown' ? 'md' : 'json';
  const exportPath = path.join(exportDir, `athena-data-export-${stamp}.${ext}`);
  const payload = buildExportPayload(supplemental);
  const body = format === 'markdown' ? renderMarkdownExport(payload) : `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(exportPath, body, 'utf8');
  const bytes = fs.statSync(exportPath).size;
  recordMaintenanceEvent('export-all-data', { format, exportPath, bytes });
  return { path: exportPath, bytes };
}

export function historyDisabledDataPatch(settings: AppSettings): Partial<AppSettings> {
  if (settings.conversation.saveHistory) return {};
  return {
    memory: {
      ...settings.memory,
      autoExtract: false,
    },
  };
}

function buildExportPayload(supplemental: SupplementalPrivacyData): Record<string, unknown> {
  const db = getDatabase();
  const settings = getAppSettings();
  return {
    exportedAt: new Date().toISOString(),
    product: `Athena Desktop ${APP_VERSION} Private Beta Candidate`,
    dataMap: buildDataMap(settings),
    networkCapabilities: buildNetworkCapabilityNotices(settings.privacy.networkConsent),
    staticProtection: buildStaticProtectionDecision(),
    settings: redactSettingsBundle(),
    agentSkills: supplemental.agentSkills || { packages: {}, invocations: [] },
    integrations: supplemental.integrations || { version: 1, servers: [] },
    database: {
      path: getDatabaseFilePath(),
      stats: getStats(),
      projects: selectAll(db, 'projects'),
      chat_windows: selectAll(db, 'chat_windows'),
      chat_messages: selectAll(db, 'chat_messages'),
      chat_attachments: selectAll(db, 'chat_attachments'),
      context_snapshots: selectAll(db, 'context_snapshots'),
      agent_tasks: selectAll(db, 'agent_tasks'),
      agent_runs: selectAll(db, 'agent_runs'),
      agent_steps: selectAll(db, 'agent_steps'),
      agent_approvals: selectAll(db, 'agent_approvals'),
      agent_artifacts: selectAll(db, 'agent_artifacts'),
      agent_run_events: selectAll(db, 'agent_run_events'),
      messages: selectAll(db, 'messages'),
      profile: selectAll(db, 'profile'),
      events: selectAll(db, 'events'),
      daily_memory_summaries: selectAll(db, 'daily_memory_summaries'),
      procedural_memories: selectAll(db, 'procedural_memories'),
      memory_entities: selectAll(db, 'memory_entities'),
      memory_facts: selectAll(db, 'memory_facts'),
      memory_fact_sources: selectAll(db, 'memory_fact_sources'),
      memory_review_queue: selectAll(db, 'memory_review_queue'),
      project_notes: selectAll(db, 'project_notes'),
      memory_index: selectAll(db, 'memory_index'),
      data_activity_records: selectAll(db, 'data_activity_records'),
    },
    files: {
      voiceCache: exportVoiceCacheFiles(),
      logs: {
        persistedByApp: false,
        note: '当前 Logger 只写控制台并做脱敏；仓库 logs/ 目录不由本隐私清除流程删除，避免误删来源不明文件。',
      },
      temporary: {
        voiceTempDir: getVoiceTempDir(),
      },
    },
  };
}

function buildDataMap(settings: AppSettings): DataMapItem[] {
  const database = getDatabaseFilePath();
  const configDir = path.dirname(resolveWritableConfigFile('settings.json'));
  return [
    {
      id: 'chat',
      label: '聊天消息',
      stored: settings.conversation.saveHistory ? '开启历史时保存 user/assistant 消息、模式、情绪和时间' : '历史已关闭，不保存新聊天消息',
      locations: [database],
      leavesDevice: 'Ollama 默认只发往 127.0.0.1。选择远程 Provider 并明确同意后，请求、相关对话和记忆上下文会发往用户配置的 API 地址。联网搜索另需独立同意。',
      retention: settings.data.historyRetentionDays > 0 ? `${settings.data.historyRetentionDays} 天后自动清理` : '无限期保留，直到用户清除',
      controls: ['保存聊天历史开关', '历史保留天数', '完整导出', '一键清除'],
    },
    {
      id: 'chat-attachments',
      label: '聊天图片附件',
      stored: '经格式、大小、像素和解码校验后，图片副本保存在 Athena 受管附件目录；SQLite 保存所属 Project、对话、消息、哈希和尺寸。',
      locations: [database, resolveAttachmentRoot()],
      leavesDevice: '本地 Ollama 视觉模型只在本机读取图片。选择远程 OpenAI 视觉模型并同意远程模型联网后，当前消息所选图片会作为 base64 图像输入发送给该 Provider。',
      retention: '随所属聊天记录保留；临时对话关闭即删除；待发送图片 24 小时后清理；一键清除会立即删除。当前不会虚称附件已接入按天自动清理。',
      controls: ['发送前移除', '临时对话自动清理', '完整导出元数据', '一键清除'],
    },
    {
      id: 'long-term-memory',
      label: '长期记忆',
      stored: '画像、事件、项目笔记与检索索引保存在 SQLite',
      locations: [database],
      leavesDevice: '不会自动上传；会作为模型上下文参与回复。选择远程 Provider 并明确同意后，相关记忆可能随当前请求发送。历史关闭后停止自动提取。',
      retention: '不随聊天保留期自动删除；用户可在记忆面板或一键清除中删除',
      controls: ['启用记忆检索', '自动提取记忆', '记忆管理面板', '完整导出', '一键清除'],
    },
    {
      id: 'settings',
      label: '设置与个性化',
      stored: '偏好、模型地址、权限档位、隐私同意和数据设置保存为 JSON',
      locations: [configDir],
      leavesDevice: '不会自动上传；在线能力只有在相应同意后才会把对应文本或音频发往第三方。',
      retention: '长期保留，直到用户修改配置或卸载/删除配置目录',
      controls: ['设置抽屉', '隐私与数据中心', '导出时包含脱敏副本'],
    },
    {
      id: 'agent-skills',
      label: 'Agent Skills',
      stored: 'Installed skill packages, content-bound trust decisions, enablement state, and actual instruction/resource load evidence',
      locations: [resolveSkillStateFile(), configDir],
      leavesDevice: 'Skill packages and invocation evidence remain local unless their content is explicitly sent through an approved model or tool request.',
      retention: 'Installed packages and trust decisions remain until changed by the user. One-click clear removes invocation evidence but preserves installed packages and explicit trust decisions.',
      controls: ['Skill library approval', 'Enable or disable', 'Uninstall', 'Complete export', 'One-click activity clear'],
    },
    {
      id: 'integrations',
      label: 'MCP integrations',
      stored: 'Server names, exact local launch commands or remote URLs, environment variable names, protocol mode, content-bound approval, and enablement state',
      locations: [path.join(configDir, 'mcp-servers.json')],
      leavesDevice: 'Remote MCP requests leave the device only after external-tool network consent. Local stdio servers run with the desktop user privileges after exact-command approval.',
      retention: 'Integration configuration remains until disabled or removed. Secret values are read from process environment and are never stored in the configuration file or export.',
      controls: ['Exact configuration approval', 'Enable or disable', 'Connect or disconnect', 'Remove', 'Complete export'],
    },
    {
      id: 'search',
      label: '搜索查询与网页证据',
      stored: settings.conversation.saveHistory ? '保存查询、来源数量、提供方和时间的最小活动记录' : '历史关闭时不保存搜索活动记录',
      locations: [database],
      leavesDevice: '明确同意后，查询词会发往 Sogou、Bing、DuckDuckGo 等公开搜索提供方；深读会请求结果网页。',
      retention: settings.data.historyRetentionDays > 0 ? `${settings.data.historyRetentionDays} 天后自动清理活动记录` : '无限期保留活动记录，直到用户清除',
      controls: ['联网搜索开关', '联网搜索同意', '深读/二次搜索设置', '导出', '一键清除'],
    },
    {
      id: 'voice',
      label: '语音文件与转写/合成',
      stored: '录音 wav 转写后立即删除；Windows SAPI 生成的 wav 临时缓存；TTS 文本中转文件调用后删除',
      locations: [getVoiceTempDir()],
      leavesDevice: 'Desktop 当前只提供本地 Whisper STT 与 Windows SAPI TTS，不发送音频或朗读文本。未来联网适配器仍必须复用两类独立同意。',
      retention: `语音缓存 ${settings.data.voiceCacheRetentionHours} 小时后自动清理；一键清除会立即清理`,
      controls: ['语音输入开关', '朗读开关', '本地组件就绪状态', '语音缓存保留小时', '一键清除'],
    },
    {
      id: 'agent-work',
      label: '任务、执行记录与产物',
      stored: '任务目标、计划、步骤、审批决定、执行检查点、产物元数据与验证状态保存在 SQLite',
      locations: [database, '<Project root>/.athena/artifacts/<task-id>'],
      leavesDevice: '默认保存在本机；使用远程模型、联网工具或第三方连接器时，仅在相应能力已获同意后发送完成当前任务所需的数据。',
      retention: '任务记录持续保留，直到用户归档或通过一键清除删除；已生成的产物文件由用户在 Project 工作目录中保留或删除。',
      controls: ['任务与运行历史', '高风险操作审批', '产物目录透明显示', '完整导出', '一键清除任务记录'],
    },
    {
      id: 'tools',
      label: '工具记录',
      stored: settings.conversation.saveHistory ? '保存最小化工具活动记录；完整输入/输出只在当前执行面板会话中显示' : '历史关闭时不保存工具活动记录',
      locations: [database, 'renderer session memory'],
      leavesDevice: '只有执行模式外部网络工具获得同意并逐次确认时，HTTP/TCP 请求才会访问外部地址。',
      retention: settings.data.historyRetentionDays > 0 ? `${settings.data.historyRetentionDays} 天后自动清理活动记录` : '执行面板会话记录只存在当前窗口；持久活动记录直到清除',
      controls: ['执行模式权限', '高风险逐次确认', '外部网络工具同意', '导出', '一键清除'],
    },
    {
      id: 'logs',
      label: '日志',
      stored: 'Logger 写控制台；主进程崩溃/无响应写本机最小 JSONL；两者都对密钥、Cookie、Authorization 等字段脱敏',
      locations: ['stdout/stderr', process.env.ATHENA_DIAGNOSTICS_DIR || path.join(os.tmpdir(), 'athena', 'diagnostics'), path.join(resolveProjectRoot(), 'logs')],
      leavesDevice: '不会由应用自动上传。',
      retention: '崩溃诊断单文件 1 MB、最多 3 个轮转文件；来源不明 logs/ 文件不由本窗口删除',
      controls: ['脱敏回归测试', '删除本机 diagnostics 目录', '手工发布证据归档'],
    },
    {
      id: 'temporary-files',
      label: '临时文件',
      stored: '语音缓存、数据库迁移备份、导出文件和 Electron/系统临时文件',
      locations: [getVoiceTempDir(), getDatabaseBackupDir(), getExportDir()],
      leavesDevice: '不自动上传。',
      retention: '语音按小时清理；数据库备份保留用于升级失败恢复；导出文件由用户自行保留或删除',
      controls: ['语音缓存清理', '数据库升级前备份', '导出目录透明显示'],
    },
  ];
}

function buildNetworkCapabilityNotices(consent: NetworkConsentSettings): NetworkCapabilityNotice[] {
  return [
    {
      id: 'remoteModel',
      label: '远程模型服务',
      sends: '当前请求、系统提示、相关对话、检索到的记忆上下文、工具规划及工具结果；工具结果可能包含用户授权读取的本地 Project 元数据和文件片段',
      destinations: '用户明确选择并配置的 OpenAI、DeepSeek、Athena Cloud 或自定义 API 地址',
      defaultState: 'off-until-consent',
      consented: consent.remoteModel,
    },
    {
      id: 'webSearch',
      label: '联网搜索和网页深读',
      sends: '搜索词、搜索结果 URL 和网页请求元数据',
      destinations: 'Sogou、Bing、DuckDuckGo、api.github.com 以及搜索结果网页域名',
      defaultState: 'off-until-consent',
      consented: consent.webSearch,
    },
    {
      id: 'imageGeneration',
      label: 'OpenAI 生图服务',
      sends: '用户逐次批准的生图提示词和输出尺寸、质量、格式设置',
      destinations: 'https://api.openai.com/v1/images/generations',
      defaultState: 'off-until-consent',
      consented: consent.imageGeneration,
    },
    {
      id: 'onlineSpeechToText',
      label: '在线语音识别',
      sends: '用户选择或录制的音频片段',
      destinations: 'speech_recognition 使用的 Google 在线识别服务；Whisper 本地优先不需要该同意',
      defaultState: 'off-until-consent',
      consented: consent.onlineSpeechToText,
    },
    {
      id: 'onlineTextToSpeech',
      label: '在线语音合成',
      sends: '要朗读的助手回复文本',
      destinations: 'Edge TTS 在线语音服务',
      defaultState: 'off-until-consent',
      consented: consent.onlineTextToSpeech,
    },
    {
      id: 'externalToolNetwork',
      label: '执行模式外部网络工具',
      sends: '用户确认的 HTTP/TCP 目标、请求头和请求正文',
      destinations: '用户在执行任务中指定的外部网络地址；localhost 不属于外部网络',
      defaultState: 'off-until-consent',
      consented: consent.externalToolNetwork,
    },
  ];
}

function buildStaticProtectionDecision(): StaticProtectionDecision {
  return {
    status: 'plaintext-sqlite-with-compensating-controls',
    claim: '当前 SQLite 数据库未加密；不得宣传为“已加密存储”。',
    threatAssessment: [
      '可抵御范围：应用内导出/清除/保留策略、迁移失败导致的数据损坏、误把在线能力当成本地能力。',
      '不可抵御范围：同一 Windows 账户下的恶意软件、具备磁盘读取权限的本地用户、离线复制数据库文件后的读取。',
      '当前补偿控制：敏感日志脱敏、执行权限默认关闭、高风险逐次确认、联网能力逐类同意、数据库迁移前备份与失败恢复。',
    ],
    decision: '本窗口不引入 SQLCipher/DPAPI 包装，避免在缺少密钥管理、升级矩阵和恢复演练时制造不可恢复风险；Desktop Beta 前必须重新评估是否采用 Windows DPAPI 保护密钥或 SQLCipher。',
    verification: [
      '导出文件明确记录 plaintext-sqlite-with-compensating-controls。',
      '发布清单不勾选“静态加密已完成”，只勾选威胁评估和不虚假宣传。',
      '自动化测试覆盖导出、清除、保留和迁移备份。',
    ],
  };
}

function redactSettingsBundle(): Record<string, unknown> {
  const bundle = getSettingsBundle();
  return {
    settings: bundle.settings,
    model: bundle.model,
  };
}

function selectAll(db: ReturnType<typeof getDatabase>, table: string): unknown[] {
  try {
    return db.prepare(`SELECT * FROM ${table} ORDER BY id ASC`).all() as unknown[];
  } catch {
    return [];
  }
}

function exportVoiceCacheFiles(): unknown[] {
  const voiceDir = getVoiceTempDir();
  if (!fs.existsSync(voiceDir)) return [];
  return fs.readdirSync(voiceDir)
    .map(fileName => path.join(voiceDir, fileName))
    .filter(isVoiceCacheFile)
    .map(filePath => {
      const stat = fs.statSync(filePath);
      const base = {
        path: filePath,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
      if (stat.size > VOICE_EXPORT_MAX_BYTES) return { ...base, contentBase64: null, skipped: 'too-large' };
      return { ...base, contentBase64: fs.readFileSync(filePath).toString('base64') };
    });
}

function isVoiceCacheFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.mp3', '.wav', '.txt'].includes(ext) && path.dirname(path.resolve(filePath)) === path.resolve(getVoiceTempDir());
}

function renderMarkdownExport(payload: Record<string, unknown>): string {
  const dataMap = payload.dataMap as DataMapItem[];
  const staticProtection = payload.staticProtection as StaticProtectionDecision;
  return [
    '# Athena Data Export',
    '',
    `Exported at: ${payload.exportedAt}`,
    '',
    '## Static Protection Decision',
    '',
    `Status: ${staticProtection.status}`,
    '',
    staticProtection.claim,
    '',
    ...staticProtection.threatAssessment.map(item => `- ${item}`),
    '',
    '## Data Map',
    '',
    ...dataMap.flatMap(item => [
      `### ${item.label}`,
      '',
      `Stored: ${item.stored}`,
      '',
      `Leaves device: ${item.leavesDevice}`,
      '',
      `Retention: ${item.retention}`,
      '',
      `Locations: ${item.locations.join('; ')}`,
      '',
    ]),
    '## Raw JSON',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
  ].join('\n');
}

function getExportDir(): string {
  return process.env.ATHENA_EXPORT_DIR || path.join(resolveProjectRoot(), 'exports');
}

function recordMaintenanceEvent(action: string, detail: Record<string, unknown>): void {
  try {
    const safeDetail = JSON.stringify(detail).slice(0, ACTIVITY_DETAIL_MAX_CHARS);
    getDatabase().prepare(`
      INSERT INTO data_activity_records (category, action, detail_json)
      VALUES ('maintenance', ?, ?)
    `).run(action, safeDetail);
  } catch {
    // Maintenance evidence should never block the user-facing action.
  }
}
