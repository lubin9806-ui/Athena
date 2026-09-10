/**
 * Where each switch actually lives, in the words the settings panel uses.
 *
 * One table because these strings go into messages the user is expected to act
 * on, and a path that is nearly right is worse than none: it sends someone
 * looking through a panel of twelve sections for a heading that is not there.
 * The values must match the `settings-heading` text in index.html exactly.
 */
export const SETTINGS_LOCATIONS = {
  toolPermission: '设置 → 执行与权限',
  imageGeneration: '设置 → 图像生成',
  webSearch: '设置 → 联网搜索',
  voice: '设置 → 语音',
  model: '设置 → 模型',
  memory: '设置 → 记忆',
  privacy: '设置 → 隐私与数据',
} as const;

export type SettingsArea = keyof typeof SETTINGS_LOCATIONS;

/**
 * The capabilities a user is most likely to be sent looking for, and where.
 *
 * Handed to the model so that when it has to say "go and switch that on" it can
 * say where. Athena was previously improvising: told only that computer tools
 * were off, it blamed that switch for image generation - which does not go
 * through it - and sent the user to the wrong screen (ATH-CHAT-006).
 */
export function settingsLocationPrompt(): string {
  return [
    '## 设置入口',
    `- 本机文件与命令的权限：${SETTINGS_LOCATIONS.toolPermission}`,
    `- 生图（本地引擎或云端服务）：${SETTINGS_LOCATIONS.imageGeneration}`,
    `- 联网搜索：${SETTINGS_LOCATIONS.webSearch}`,
    `- 语音输入与朗读：${SETTINGS_LOCATIONS.voice}`,
    `- 换模型、填 API Key：${SETTINGS_LOCATIONS.model}`,
    '- 需要用户去开某个开关时，把上面对应的位置一起说出来，不要只说“去设置里打开”。',
    '- 以上是各自独立的开关，互不影响。不要因为其中一项关着就说另一项也用不了。',
  ].join('\n');
}
