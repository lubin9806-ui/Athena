'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const competitionDir = path.resolve(__dirname, '..');
const inputDir = process.argv[2] ? path.resolve(process.argv[2]) : '';
const output = path.join(competitionDir, 'Athena_AI杭州码动未来_Demo演示视频.mp4');

async function render(window, config) {
  return window.webContents.executeJavaScript(`(async () => {
    const config = ${JSON.stringify(config)};
    const fs = require('node:fs');
    const path = require('node:path');
    const manifest = JSON.parse(fs.readFileSync(path.join(config.inputDir, 'capture.json'), 'utf8'));
    if (!manifest.frames.length) throw new Error('capture has no frames');

    const loadImage = file => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('failed to load ' + file));
      const ext = path.extname(file).toLowerCase() === '.png' ? 'png' : 'jpeg';
      image.src = 'data:image/' + ext + ';base64,' + fs.readFileSync(file).toString('base64');
    });
    const frames = [];
    for (const frame of manifest.frames) frames.push(await loadImage(path.join(config.inputDir, 'frames', frame.file)));
    const evidenceNames = [
      '01-command-approval.png',
      '02-mean-fix-approval.png',
      '03-median-fix-approval.png',
      '04-retest-approval.png',
      '05-final-result.png',
    ];
    const evidence = [];
    for (const name of evidenceNames) evidence.push(await loadImage(path.join(config.inputDir, 'evidence', name)));
    const logo = await loadImage(config.logo);

    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: false });

    const CREAM = '#f4f1e8';
    const PAPER = '#fbfaf5';
    const INK = '#20372f';
    const SAGE = '#5d746b';
    const PALE = '#dce7df';
    const GOLD = '#c18c3d';
    const RED = '#b4584d';
    const fps = 15;
    const totalMs = 124000;

    function roundedRect(x, y, w, h, radius, fill, stroke) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radius);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
    }

    function text(value, x, y, size, color = INK, weight = 400, align = 'left') {
      ctx.fillStyle = color;
      ctx.font = weight + ' ' + size + 'px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(value, x, y);
    }

    function wrapped(value, x, y, width, size, lineHeight, color = INK, weight = 400, maxLines = 8) {
      const chars = Array.from(value);
      let line = '';
      const lines = [];
      ctx.font = weight + ' ' + size + 'px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
      for (const char of chars) {
        const test = line + char;
        if (ctx.measureText(test).width > width && line) {
          lines.push(line);
          line = char;
          if (lines.length >= maxLines) break;
        } else line = test;
      }
      if (line && lines.length < maxLines) lines.push(line);
      lines.forEach((item, index) => text(item, x, y + index * lineHeight, size, color, weight));
      return y + lines.length * lineHeight;
    }

    function background() {
      ctx.fillStyle = CREAM;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = INK;
      ctx.fillRect(0, 0, canvas.width, 82);
      ctx.drawImage(logo, 42, 17, 48, 48);
      text('Athena', 106, 56, 34, '#ffffff', 700);
      text('2026 AI杭州·码动未来 · AI+超级智能体赛道（高校组）', 1870, 53, 22, '#e8eee9', 400, 'right');
    }

    function footer(timeMs, label = '真实软件 · 真实模型 · 真实工具执行') {
      text(label, 54, 1042, 18, SAGE, 500);
      text(String(Math.floor(timeMs / 60000)).padStart(2, '0') + ':' + String(Math.floor(timeMs / 1000) % 60).padStart(2, '0'), 1865, 1042, 18, SAGE, 500, 'right');
    }

    function drawImageFit(image, x, y, w, h) {
      const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
      const dw = image.naturalWidth * scale;
      const dh = image.naturalHeight * scale;
      ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }

    function titleCard(timeMs) {
      background();
      ctx.drawImage(logo, 120, 190, 210, 210);
      text('Athena', 390, 280, 88, INK, 700);
      text('本地优先的自主桌面 AI Agent', 395, 346, 34, SAGE, 500);
      ctx.fillStyle = GOLD;
      ctx.fillRect(397, 378, 210, 6);
      text('真实复杂任务演示', 120, 535, 48, INK, 700);
      wrapped('自然语言目标 → 任务规划 → 工具调用 → 权限审批 → Windows 执行 → 结果交付', 120, 595, 1580, 30, 48, SAGE, 500, 3);
      roundedRect(120, 755, 1680, 130, 24, PAPER, '#cad6cf');
      text('参赛院校', 160, 810, 20, SAGE, 500);
      text('西安翻译学院 · 数字媒体艺术', 160, 854, 28, INK, 700);
      text('团队成员', 940, 810, 20, SAGE, 500);
      text('鲁滨 · 唐婧 · 贾晨泽 · 汪昊', 940, 854, 28, INK, 700);
      footer(timeMs, '参赛字幕版 · 实际执行片段保留原始顺序');
    }

    function problemCard(timeMs) {
      background();
      text('演示任务', 110, 180, 26, GOLD, 700);
      wrapped('修复一个存在多处缺陷的 Node.js 统计模块，并运行测试直到全部通过', 110, 245, 1540, 48, 72, INK, 700, 3);
      const items = [
        ['1', '先运行测试', '获取真实失败结果，而不是猜测问题。'],
        ['2', '读取并定位', '检查 stats.js 与 test.js，保持测试文件不变。'],
        ['3', '请求授权', '命令与文件修改在执行前展示具体参数。'],
        ['4', '修改并复测', '修复后再次运行测试，形成任务闭环。'],
      ];
      items.forEach((item, index) => {
        const x = 110 + (index % 2) * 860;
        const y = 430 + Math.floor(index / 2) * 220;
        roundedRect(x, y, 790, 165, 22, PAPER, '#ced8d2');
        roundedRect(x + 28, y + 28, 58, 58, 18, PALE, null);
        text(item[0], x + 57, y + 69, 26, INK, 700, 'center');
        text(item[1], x + 112, y + 66, 28, INK, 700);
        wrapped(item[2], x + 112, y + 108, 620, 20, 31, SAGE, 400, 2);
      });
      footer(timeMs, '任务数据为脚本生成的虚构代码，不含个人或学校隐私');
    }

    function drawRun(timeMs, runMs) {
      background();
      roundedRect(48, 104, 1430, 900, 20, PAPER, '#cbd6d0');
      const frameIndex = Math.min(manifest.frames.length - 1, (() => {
        let low = 0;
        let high = manifest.frames.length - 1;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          if (manifest.frames[mid].relativeMs <= runMs) low = mid;
          else high = mid - 1;
        }
        return low;
      })());
      drawImageFit(frames[frameIndex], 64, 120, 1398, 868);
      roundedRect(1510, 104, 362, 900, 20, INK, null);
      text('真实运行', 1550, 170, 26, '#dfe8e2', 500);
      text('LIVE', 1815, 168, 18, '#ffffff', 700, 'right');
      ctx.fillStyle = '#ca584e'; ctx.beginPath(); ctx.arc(1842, 161, 8, 0, Math.PI * 2); ctx.fill();
      const stage = runMs < 6500
        ? ['理解目标', 'Athena 接收自然语言目标，进入执行任务。']
        : runMs < 14500
          ? ['运行与读取', '调用目录、文件和命令工具，取得失败测试证据。']
          : runMs < 26000
            ? ['修复前审批', '逐项展示路径、原文与替换内容，等待授权。']
            : runMs < 31500
              ? ['再次验证', '重新运行 test.js，检查退出码与输出。']
              : ['交付结果', '汇总修改内容，同时如实显示产品内“未验证”状态。'];
      text(stage[0], 1550, 245, 34, '#ffffff', 700);
      wrapped(stage[1], 1550, 300, 280, 22, 36, '#dfe8e2', 400, 6);
      ctx.fillStyle = GOLD;
      ctx.fillRect(1550, 520, Math.min(280, 280 * runMs / 34000), 6);
      text('执行证据', 1550, 590, 20, '#b9c9c0', 500);
      const facts = ['真实 Athena Renderer', 'DeepSeek 负责规划', '文件/命令在本机执行', '逐项审批开启', '测试文件保持不变'];
      facts.forEach((fact, index) => {
        text('✓', 1550, 640 + index * 52, 22, '#a9d3bc', 700);
        text(fact, 1585, 640 + index * 52, 20, '#ffffff', 500);
      });
      footer(timeMs, '20—55 秒为连续真实运行片段 · 未重排工具顺序');
    }

    function evidenceCard(timeMs, image, tag, heading, body, note) {
      background();
      roundedRect(48, 104, 1370, 900, 20, PAPER, '#cbd6d0');
      drawImageFit(image, 64, 120, 1338, 868);
      roundedRect(1450, 104, 422, 900, 20, INK, null);
      text(tag, 1492, 170, 20, GOLD, 700);
      wrapped(heading, 1492, 235, 330, 34, 50, '#ffffff', 700, 4);
      wrapped(body, 1492, 440, 330, 22, 36, '#dce6e0', 400, 9);
      roundedRect(1492, 805, 330, 120, 16, '#2d493e', null);
      wrapped(note, 1518, 850, 280, 18, 29, '#dce6e0', 500, 3);
      footer(timeMs, '关键画面来自同一轮真实模型 E2E');
    }

    function closingCard(timeMs) {
      background();
      text('一次任务，形成完整闭环', 960, 255, 54, INK, 700, 'center');
      const flow = ['目标', '规划', '工具', '审批', '执行', '复测', '交付'];
      flow.forEach((item, index) => {
        const x = 190 + index * 255;
        roundedRect(x, 380, 150, 82, 24, index === 6 ? INK : PALE, null);
        text(item, x + 75, 433, 25, index === 6 ? '#ffffff' : INK, 700, 'center');
        if (index < flow.length - 1) text('→', x + 198, 433, 30, GOLD, 700, 'center');
      });
      roundedRect(280, 585, 1360, 190, 28, PAPER, '#cbd6d0');
      text('Athena 希望让 AI 从“回答问题”走向', 960, 657, 31, SAGE, 500, 'center');
      text('“在用户授权下完成任务”', 960, 718, 45, INK, 700, 'center');
      text('西安翻译学院 · 数字媒体艺术', 960, 875, 24, SAGE, 500, 'center');
      text('鲁滨 · 唐婧 · 贾晨泽 · 汪昊  /  指导教师：席晶', 960, 918, 24, SAGE, 500, 'center');
      footer(timeMs, 'Athena 0.9.7-beta.1 · 私测候选版');
    }

    function drawAt(timeMs) {
      if (timeMs < 8000) return titleCard(timeMs);
      if (timeMs < 20000) return problemCard(timeMs);
      if (timeMs < 55000) return drawRun(timeMs, timeMs - 20000);
      if (timeMs < 70000) return evidenceCard(timeMs, evidence[0], '01 · 权限判断', '执行命令前，先展示真实参数', '审批卡显示命令、工作目录和风险提示。用户同意后，Athena 才在 Windows 环境中执行 node test.js。', '不是后期字幕模拟；按钮与参数来自真实 UI。');
      if (timeMs < 85000) return evidenceCard(timeMs, evidence[2], '02 · 文件操作', '修改前可见原文与替换内容', '模型定位 mean 与 median 两处缺陷。写入前展示目标路径、原始代码和替换代码，保持 test.js 不变。', '本轮产生两项独立修改审批。');
      if (timeMs < 100000) return evidenceCard(timeMs, evidence[3], '03 · 再次验证', '修复不是终点，必须重新运行测试', 'Athena 再次请求执行 node test.js。测试退出码为 0，独立校验确认 4 个用例全部通过。', '命令、文件结果和审批记录均写入任务状态。');
      if (timeMs < 116000) return evidenceCard(timeMs, evidence[4], '04 · 结果交付', '清楚说明改了什么，也保留验证边界', 'Athena 交付修复说明。产品内没有预配置 success criteria，因此 UI 如实标记“未验证”；外部 E2E 脚本另行确认 test.js 未改且全部测试通过。', '不把外部验收伪装成产品内自动验收。');
      return closingCard(timeMs);
    }

    drawAt(0);
    const stream = canvas.captureStream(fps);
    const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This Electron build cannot encode MP4');
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10_000_000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error('MediaRecorder failed'));
    });
    recorder.start(1000);
    const interval = 1000 / fps;
    for (let timeMs = 0; timeMs <= totalMs; timeMs += interval) {
      drawAt(timeMs);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: mimeType });
    const bytes = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(config.output, bytes);
    return { output: config.output, mimeType, bytes: bytes.length, width: canvas.width, height: canvas.height, durationMs: totalMs };
  })()`);
}

app.whenReady().then(async () => {
  if (!inputDir || !fs.existsSync(path.join(inputDir, 'capture.json'))) {
    throw new Error('Usage: electron build_competition_video.js <capture-directory>');
  }
  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  });
  await window.loadURL('data:text/html,<meta charset="utf-8"><body style="margin:0;background:black"></body>');
  const result = await render(window, {
    inputDir,
    output,
    logo: path.join(path.resolve(__dirname, '..', '..', '..', '..'), 'resources', 'athena-brand-icon.png'),
  });
  console.log(`ATHENA_COMPETITION_VIDEO ${JSON.stringify(result)}`);
  await window.close();
  app.quit();
}).catch(error => {
  console.error(error.stack || error);
  app.exit(1);
});
