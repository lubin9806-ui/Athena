# Athena Demo 录制工具

这些脚本只用于赛事材料，不修改 Athena 业务源码。

1. `record_live_demo.js` 复用仓库现有真实 UI E2E，在隔离配置下运行 DeepSeek 场景，并通过 Chromium DevTools `Page.startScreencast` 捕获真实 Renderer 帧。
2. `encode_frames.js` 使用仓库已有 Electron/Chromium 的 `MediaRecorder` 将捕获帧编码成无音频视频。优先 MP4，不支持时回退 WebM。
3. `salvage_capture.js` 仅在录制器被 Electron 测试清理竞态提前终止时使用：根据连续帧的文件修改时间恢复时间轴，并在清单中保留该事实。
4. `build_competition_video.js` 把真实运行片段、审批截图和结果边界编排为约 2 分钟的 1080p H.264 字幕版，不覆盖或伪造 Athena 的状态文案。
5. `verify_video.js` 让 Electron 实际解码最终 MP4，并在多个时间点截图用于视觉 QA。

录制内容为自动生成的虚构 Node.js 测试项目。远程模型只接收这组虚构数据；API Key 不会复制到材料目录。
