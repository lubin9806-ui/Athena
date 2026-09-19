from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence
import re

from PIL import Image
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent / "Athena_AI杭州码动未来_项目说明书.pdf"
PAGE_W, PAGE_H = landscape(A4)

INK = HexColor("#222C2A")
SUB = HexColor("#58645F")
SAGE = HexColor("#53675F")
DARK_SAGE = HexColor("#3E6855")
PALE = HexColor("#E6E9E2")
CREAM = HexColor("#F5F1E8")
WHITE = HexColor("#FCFCF8")
GOLD = HexColor("#B49A6A")
RED = HexColor("#9B403F")
AMBER = HexColor("#9A743D")
GREEN = HexColor("#3E6855")
LINE = HexColor("#C4CCC2")
MIST = HexColor("#F2F1EC")
NIGHT = HexColor("#222C2A")

FONT = "MicrosoftYaHei"
FONT_BOLD = "MicrosoftYaHeiBold"
FONT_DISPLAY = "NotoSerifSC"
FONT_WORDMARK = "Georgia"


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont(FONT, r"C:\Windows\Fonts\msyh.ttc", subfontIndex=0))
    pdfmetrics.registerFont(TTFont(FONT_BOLD, r"C:\Windows\Fonts\msyhbd.ttc", subfontIndex=0))
    pdfmetrics.registerFont(TTFont(FONT_DISPLAY, r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"))
    pdfmetrics.registerFont(TTFont(FONT_WORDMARK, r"C:\Windows\Fonts\georgia.ttf"))


def wrap_text(text: str, width: float, font: str, size: float) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines() or [""]:
        if not raw:
            lines.append("")
            continue
        current = ""
        tokens = re.findall(r"[A-Za-z0-9_.:/+\-=]+(?:\s+)?|.", raw)
        for token in tokens:
            test = current + token
            if current and pdfmetrics.stringWidth(test, font, size) > width:
                lines.append(current.rstrip())
                current = token.lstrip()
            else:
                current = test
            if current and pdfmetrics.stringWidth(current, font, size) > width:
                oversized = current
                current = ""
                for ch in oversized:
                    test = current + ch
                    if current and pdfmetrics.stringWidth(test, font, size) > width:
                        lines.append(current.rstrip())
                        current = ch
                    else:
                        current = test
        if current:
            lines.append(current)
    return lines


def draw_wrapped(c: canvas.Canvas, text: str, x: float, y: float, width: float,
                 size: float = 9.2, leading: float = 14, color: Color = INK,
                 font: str = FONT, max_lines: int | None = None) -> float:
    lines = wrap_text(text, width, font, size)
    if max_lines is not None:
        lines = lines[:max_lines]
    c.setFont(font, size)
    c.setFillColor(color)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def footer(c: canvas.Canvas, page_no: int) -> None:
    c.setStrokeColor(LINE)
    c.setLineWidth(0.55)
    c.line(42, 30, PAGE_W - 42, 30)
    c.setFont(FONT_WORDMARK, 8.6)
    c.setFillColor(SAGE)
    c.drawString(42, 15, "Athena")
    c.setFont(FONT, 6.7)
    c.setFillColor(SUB)
    c.drawString(82, 15, "本地优先的自主桌面 AI Agent")
    c.drawRightString(PAGE_W - 42, 15, f"2026 AI杭州·码动未来  ·  {page_no:02d} / 12")


def page_base(c: canvas.Canvas, page_no: int, section: str, title: str, subtitle: str = "") -> None:
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFont(FONT_WORDMARK, 14)
    c.setFillColor(SAGE)
    c.drawString(42, PAGE_H - 31, "Athena")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(91, PAGE_H - 34, 108, PAGE_H - 34)
    c.setFont(FONT_BOLD, 7.4)
    c.setFillColor(SAGE)
    c.drawString(117, PAGE_H - 37, section)
    c.setFont(FONT_WORDMARK, 21)
    c.setFillColor(Color(SAGE.red, SAGE.green, SAGE.blue, alpha=0.25))
    c.drawRightString(PAGE_W - 42, PAGE_H - 34, f"{page_no:02d}")
    title_size = 25.5
    max_title_width = PAGE_W - 84
    while title_size > 17 and pdfmetrics.stringWidth(title, FONT_DISPLAY, title_size) > max_title_width:
        title_size -= 0.5
    c.setFont(FONT_DISPLAY, title_size)
    c.setFillColor(INK)
    c.drawString(42, PAGE_H - 72, title)
    c.setFillColor(GOLD)
    c.rect(42, PAGE_H - 86, 38, 2.2, fill=1, stroke=0)
    if subtitle:
        c.setFont(FONT, 8.4)
        c.setFillColor(SUB)
        c.drawString(95, PAGE_H - 89, subtitle)
    footer(c, page_no)


def card(c: canvas.Canvas, x: float, y: float, w: float, h: float, title: str,
         body: str, accent: Color = SAGE, bg: Color = WHITE,
         title_size: float = 11, body_size: float = 8.5,
         leading: float = 12.5) -> None:
    c.setFillColor(bg)
    c.setStrokeColor(Color(LINE.red, LINE.green, LINE.blue, alpha=0.75))
    c.setLineWidth(0.55)
    c.roundRect(x, y, w, h, 10, fill=1, stroke=1)
    c.setFillColor(accent)
    c.roundRect(x, y, 4, h, 2, fill=1, stroke=0)
    c.setFont(FONT_BOLD, title_size)
    c.setFillColor(INK)
    c.drawString(x + 18, y + h - 24, title)
    draw_wrapped(c, body, x + 18, y + h - 43, w - 34, body_size, leading, SUB)


def pill(c: canvas.Canvas, x: float, y: float, text: str, color: Color = SAGE) -> float:
    size = 7.6
    w = pdfmetrics.stringWidth(text, FONT_BOLD, size) + 18
    c.setFillColor(Color(color.red, color.green, color.blue, alpha=0.13))
    c.roundRect(x, y, w, 19, 9, fill=1, stroke=0)
    c.setFont(FONT_BOLD, size)
    c.setFillColor(color)
    c.drawCentredString(x + w / 2, y + 6, text)
    return w


def draw_image(c: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float,
               radius: float = 10) -> None:
    with Image.open(path) as im:
        iw, ih = im.size
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx, dy = x + (w - dw) / 2, y + (h - dh) / 2
    c.saveState()
    clip = c.beginPath()
    clip.roundRect(x, y, w, h, min(radius, 5))
    c.clipPath(clip, stroke=0, fill=0)
    c.setFillColor(WHITE)
    c.rect(x, y, w, h, fill=1, stroke=0)
    c.drawImage(str(path), dx, dy, dw, dh, preserveAspectRatio=True, mask="auto")
    c.restoreState()
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.roundRect(x, y, w, h, min(radius, 5), fill=0, stroke=1)


def node(c: canvas.Canvas, x: float, y: float, w: float, h: float, title: str,
         subtitle: str = "", fill: Color = WHITE, stroke: Color = LINE) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 3, fill=1, stroke=1)
    c.setFillColor(INK)
    node_size = 9.0
    while node_size > 6.6 and pdfmetrics.stringWidth(title, FONT_BOLD, node_size) > w - 12:
        node_size -= 0.3
    c.setFont(FONT_BOLD, node_size)
    c.drawCentredString(x + w / 2, y + h / 2 + (4 if subtitle else -3), title)
    if subtitle:
        c.setFillColor(SUB)
        c.setFont(FONT, 6.8)
        c.drawCentredString(x + w / 2, y + h / 2 - 10, subtitle)


def arrow(c: canvas.Canvas, x1: float, y1: float, x2: float, y2: float, color: Color = SAGE) -> None:
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.4)
    c.line(x1, y1, x2, y2)
    import math
    angle = math.atan2(y2 - y1, x2 - x1)
    for delta in (2.55, -2.55):
        c.line(x2, y2, x2 + 7 * math.cos(angle + delta), y2 + 7 * math.sin(angle + delta))


def simple_table(c: canvas.Canvas, x: float, y_top: float, widths: Sequence[float],
                 rows: Sequence[Sequence[str]], row_heights: Sequence[float],
                 header_fill: Color = DARK_SAGE, font_size: float = 7.4) -> None:
    y = y_top
    total_w = sum(widths)
    for r_index, row in enumerate(rows):
        h = row_heights[r_index]
        y -= h
        c.setFillColor(header_fill if r_index == 0 else (WHITE if r_index % 2 else PALE))
        c.setStrokeColor(LINE)
        c.rect(x, y, total_w, h, fill=1, stroke=1)
        col_x = x
        for col_index, value in enumerate(row):
            if col_index:
                c.line(col_x, y, col_x, y + h)
            color = WHITE if r_index == 0 else INK
            font = FONT_BOLD if r_index == 0 or col_index == 0 else FONT
            lines = wrap_text(value, widths[col_index] - 12, font, font_size)
            text_y = y + h - 12
            c.setFillColor(color)
            c.setFont(font, font_size)
            for line in lines[: max(1, int((h - 8) / (font_size + 3)))]:
                c.drawString(col_x + 6, text_y, line)
                text_y -= font_size + 3
            col_x += widths[col_index]


def cover(c: canvas.Canvas) -> None:
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setStrokeColor(SAGE)
    c.setLineWidth(54)
    c.arc(PAGE_W - 300, 58, PAGE_W + 125, 515, startAng=83, extent=220)
    c.setFillColor(GOLD)
    c.saveState()
    c.translate(PAGE_W - 112, 446)
    c.rotate(45)
    c.rect(-5, -5, 10, 10, fill=1, stroke=0)
    c.restoreState()
    icon = ROOT / "resources" / "athena-brand-icon.png"
    c.drawImage(str(icon), PAGE_W - 204, 223, 108, 108, preserveAspectRatio=True, mask="auto")
    c.setFont(FONT_BOLD, 7.3)
    c.setFillColor(SAGE)
    c.drawString(54, 525, "2026 AI杭州 · 码动未来  /  AI+超级智能体赛道 · 高校组")
    c.setFont(FONT_WORDMARK, 62)
    c.setFillColor(SAGE)
    c.drawString(50, 421, "Athena")
    c.setFont(FONT_DISPLAY, 23)
    c.setFillColor(INK)
    c.drawString(54, 372, "本地优先的自主桌面 AI Agent")
    c.setFillColor(GOLD)
    c.rect(54, 346, 70, 3, fill=1, stroke=0)
    c.setFont(FONT, 10.5)
    c.setFillColor(SUB)
    c.drawString(54, 314, "让 AI 从回答问题，走向在用户授权下完成任务")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(54, 270, 512, 270)
    c.setFont(FONT_BOLD, 7.1)
    c.setFillColor(SAGE)
    c.drawString(54, 249, "TEAM / SUBMISSION PROFILE")
    c.setFont(FONT, 8.4)
    c.setFillColor(INK)
    c.drawString(54, 225, "西安翻译学院  ·  数字媒体艺术")
    c.drawString(54, 204, "团队成员  鲁滨 · 唐婧 · 贾晨泽 · 汪昊")
    c.drawString(54, 183, "指导教师  席晶（授课老师）  /  联系人  鲁滨  13228367530")
    c.drawString(54, 162, "报名编号  无  /  版权及盖章主体  暂无")
    c.setFont(FONT_BOLD, 7.1)
    c.setFillColor(SAGE)
    c.drawString(54, 126, "BUILD SNAPSHOT")
    c.setFont(FONT, 7.4)
    c.setFillColor(SUB)
    c.drawString(54, 105, "0.9.7-beta.1  ·  私测候选版  ·  未签名比赛候选安装包")
    c.drawString(54, 85, "材料基线  2026.09.18  ·  HEAD 4129aab")
    c.setFillColor(SAGE)
    c.rect(0, 0, PAGE_W, 24, fill=1, stroke=0)
    c.setFont(FONT_BOLD, 6.7)
    c.setFillColor(CREAM)
    c.drawString(54, 9, "TRUTHFUL CAPABILITY BRIEF  ·  实现 / 测试 / 运行 / 规划严格分层")


def page_2(c: canvas.Canvas) -> None:
    page_base(c, 2, "01—03  项目概述 / 背景 / 解决方案", "从回答问题，到在授权下推进真实任务")
    draw_image(c, ROOT / "docs" / "brand" / "ui-shots" / "execution-day.png", 438, 195, 360, 290)
    c.setFont(FONT, 7.5)
    c.setFillColor(SUB)
    c.drawString(449, 180, "当前运行时 Execute 界面 · 空状态仅用于界面说明")
    card(c, 42, 359, 360, 127, "Athena 是什么", "面向个人用户的本地优先 Windows 自主桌面 AI Agent。用户说明目标后，Athena 在持久化项目中组织上下文，由支持原生工具调用的模型连续选择工具，操作文件、终端、程序和经授权的网络，并保存任务状态、证据和交付物。", SAGE)
    card(c, 42, 229, 360, 108, "为什么需要它", "传统 Chatbot 会告诉用户怎么做，但目录整理、命令执行、结果检查、失败恢复与文件交付仍需人工逐步完成。Athena 处理的是“AI 与真实桌面工作之间的执行断层”。", GOLD)
    card(c, 42, 91, 756, 106, "完整闭环", "用户目标  →  路由与上下文  →  持久化任务  →  模型动态规划  →  工具选择  →  权限/风险判断  →  Windows 环境执行  →  状态与错误处理  →  证据/成果保存  →  结果反馈。默认预算 16 轮模型调用、48 次工具调用；耗尽后由用户决定是否追加。", DARK_SAGE)


def page_3(c: canvas.Canvas) -> None:
    page_base(c, 3, "04  核心功能 · 执行层", "真实接线，而非概念模块")
    cards = [
        ("连续 Agent 执行", "原生 tool_calls 循环；每次工具结果回传模型后继续决策。支持检查点、取消、失败、审批暂停与受控恢复。\n成熟度：已实现 / Beta", SAGE),
        ("22 个 Windows 工具", "文件信息、目录、读写、搜索、复制移动删除、命令、持久终端、程序启动、路径打开、HTTP 和端口检查。\n边界：无通用鼠标键盘与屏幕控制。", GOLD),
        ("任务状态管理", "Project、Goal、Task、Run、Step、Event、Approval、Evidence、Artifact 均持久化在本地。安全重试只面向幂等或低风险工具。\n成熟度：已实现", DARK_SAGE),
        ("权限与风险策略", "off/read/files/full 四级权限默认关闭；只有 Execute 可获得计算机权限；网络另行同意；运行中撤权会降低任务权限上限。\n逐项展示参数并支持逐项决定。", RED),
        ("成果生成", "可生成 Markdown、HTML、DOCX、PDF，记录真实路径、大小、SHA-256 与完整性验证。\n边界：普通任务的内容级验收尚未完整接入。", GREEN),
        ("扩展工具", "本地 OCR、Skills 文本资源、MCP、网页/项目研究工具已接入注册表。\n边界：Skill 不自动执行脚本；Web 研究仍属实验性。", AMBER),
    ]
    positions = [(42, 333), (303, 333), (564, 333), (42, 134), (303, 134), (564, 134)]
    for (title, body, accent), (x, y) in zip(cards, positions):
        card(c, x, y, 235, 170, title, body, accent, body_size=8.2, leading=12)
    c.setFont(FONT, 7.3)
    c.setFillColor(SUB)
    c.drawString(42, 108, "主要依据：AgentRunner.ts · AgentStore.ts · ComputerToolCatalog.ts · ComputerTools.ts · ArtifactAgentToolBridge.ts")


def page_4(c: canvas.Canvas) -> None:
    page_base(c, 4, "04  核心功能 · 模型、记忆与多模态", "本地优先不等于只允许本地模型")
    draw_image(c, ROOT / "docs" / "brand" / "ui-shots" / "memory-day.png", 438, 238, 360, 245)
    c.setFont(FONT, 7.3)
    c.setFillColor(SUB)
    c.drawString(449, 225, "当前运行时 Memory 界面 · 空状态不作为召回效果证明")
    card(c, 42, 362, 360, 123, "本地多层记忆", "会话上下文、消息、用户事实、情景事件、每日摘要、程序性记忆审核、带来源事实、项目笔记与文档索引均落在 SQLite。项目隔离和令牌预算有独立实现。", SAGE)
    card(c, 42, 225, 360, 113, "多模型适配", "支持 Ollama 与 OpenAI-compatible 协议，供应商配置覆盖 OpenAI、DeepSeek、Athena Cloud 与自定义端点。密钥由 safeStorage 加密。真实云服务本次未在线验证。", GOLD)
    card(c, 42, 79, 360, 122, "语音与附件", "本地 faster-whisper STT；Piper（随包时）或 Windows SAPI TTS；支持静音停止和打断。附件覆盖常用文本、图像、DOCX、XLSX，本地 OCR 支持中英文。语音为 Beta，需真实设备复验。", DARK_SAGE)
    card(c, 438, 79, 360, 122, "当前已知边界", "默认哈希 n-gram 检索：关键词测试 1.000，同义改写测试 0.000；可选本地向量链已实现但未做本次真实模型证明。PDF 成果生成可用，但 PDF 项目文档导入当前损坏。", RED)


def page_5(c: canvas.Canvas) -> None:
    page_base(c, 5, "05  超级智能体工作流程", "每个动作都经过注册工具、权限策略与持久化状态")
    xs = [42, 174, 306, 438, 570, 702]
    labels = [
        ("用户目标", "Project + 附件"), ("上下文", "路由 + 记忆"), ("模型决策", "原生 tool_calls"),
        ("权限判断", "策略 + 审批"), ("环境执行", "Windows / 扩展"), ("交付", "证据 + 成果"),
    ]
    for i, ((title, sub), x) in enumerate(zip(labels, xs)):
        node(c, x, 385, 105, 62, title, sub, WHITE, SAGE if i in (2, 3, 4) else LINE)
        if i < len(xs) - 1:
            arrow(c, x + 105, 416, xs[i + 1] - 5, 416)
    c.setStrokeColor(SAGE)
    c.setLineWidth(1.2)
    c.line(754, 377, 754, 327)
    c.line(754, 327, 358, 327)
    arrow(c, 358, 327, 358, 378)
    c.setFont(FONT_BOLD, 7.5)
    c.setFillColor(SAGE)
    c.drawString(515, 314, "工具结果回传模型，继续下一轮")
    card(c, 42, 180, 237, 112, "审批分支", "高风险调用生成审批并暂停。用户批准后从检查点继续；拒绝或取消时保存状态并收敛。", RED)
    card(c, 303, 180, 237, 112, "错误与恢复", "只对安全/幂等工具自动重试。不确定重放需要 critical 审批，避免重复破坏性动作。", AMBER)
    card(c, 564, 180, 234, 112, "结果验证", "文档成果可做完整性验证；无 required validations 时标记 unverified；有未恢复失败或拒绝步骤时标记 issues。", GREEN)
    c.setFillColor(PALE)
    c.roundRect(42, 82, 756, 67, 9, fill=1, stroke=0)
    c.setFont(FONT_BOLD, 9)
    c.setFillColor(INK)
    c.drawString(58, 126, "当前规划边界")
    draw_wrapped(c, "任务服务目前只创建一个“Execute the agreed goal”通用起始步骤；细分计划由模型在工具循环中动态形成。它具备连续决策能力，但尚不是可在执行前审阅、编辑和逐步确认的完整计划系统。", 58, 108, 720, 8.1, 12, SUB)


def page_6(c: canvas.Canvas) -> None:
    page_base(c, 6, "06  技术架构", "Renderer 不直接持有系统权限；模型只能通过注册工具触达环境")
    layers = [
        ("Electron Renderer", ["聊天与 Project", "Execute 工作区", "语音/附件", "审批与状态"], 435, PALE),
        ("Electron Main / Core", ["AthenaController", "MessageRouter", "AgentRunner / Store", "Context / Retriever"], 330, WHITE),
        ("Policy + Tool Runtime", ["Permission Ceiling", "Computer Tools", "Artifacts / OCR", "Skills / MCP / Research"], 225, PALE),
        ("Local Data + Models", ["SQLite schema v20", "Project files", "safeStorage", "Ollama / OpenAI-compatible"], 120, WHITE),
    ]
    for title, items, y, fill in layers:
        c.setFillColor(fill)
        c.setStrokeColor(LINE)
        c.roundRect(42, y, 756, 76, 10, fill=1, stroke=1)
        c.setFont(FONT_BOLD, 10)
        c.setFillColor(DARK_SAGE)
        c.drawString(57, y + 50, title)
        start_x = 210
        for item in items:
            node(c, start_x, y + 17, 132, 42, item, "", WHITE, LINE)
            start_x += 143
    for y in (428, 323, 218):
        arrow(c, 420, y, 420, y - 23)
    c.setFont(FONT, 7.4)
    c.setFillColor(SUB)
    c.drawString(42, 93, "基础技术：Electron · TypeScript · Vite · better-sqlite3 · Ollama · OpenAI-compatible · faster-whisper · Piper / Windows SAPI")
    c.drawString(42, 76, "Electron 安全基线：sandbox = true · contextIsolation = true · nodeIntegration = false · API keys 不下发 Renderer")


def page_7(c: canvas.Canvas) -> None:
    page_base(c, 7, "07  核心创新点", "创新集中在可管理、可授权、可追踪的个人任务系统")
    items = [
        ("01", "回答 → 环境动作", "模型能真正读取/写入文件、运行命令并依据返回继续执行；能力由工具注册表和权限策略约束。"),
        ("02", "状态是一等公民", "Task、Run、Step、Approval、Evidence、Artifact 持久化；暂停、恢复、取消与失败均可追踪。"),
        ("03", "本地优先 + 多模型", "SQLite、Ollama、本地 OCR 与本地语音为优先路径；经用户授权后再连接兼容云模型。"),
        ("04", "分层可追溯记忆", "短期上下文、长期事实、情景事件、摘要、项目资料与来源记录分开管理，而非只有聊天历史。"),
        ("05", "把未验证说清楚", "模型停止调用工具不等于业务验收通过；缺少验收条件时明确标记 unverified。"),
    ]
    y = 454
    for idx, title, body in items:
        c.setFillColor(DARK_SAGE if idx in ("01", "03", "05") else GOLD)
        c.circle(70, y + 5, 22, fill=1, stroke=0)
        c.setFont(FONT_BOLD, 10)
        c.setFillColor(WHITE)
        c.drawCentredString(70, y + 1, idx)
        c.setFont(FONT_BOLD, 13)
        c.setFillColor(INK)
        c.drawString(110, y + 9, title)
        draw_wrapped(c, body, 110, y - 11, 655, 8.5, 12.5, SUB, max_lines=2)
        if idx != "05":
            c.setStrokeColor(LINE)
            c.line(110, y - 40, 778, y - 40)
        y -= 82
    c.setFillColor(PALE)
    c.roundRect(42, 62, 756, 48, 8, fill=1, stroke=0)
    c.setFont(FONT_BOLD, 8.5)
    c.setFillColor(DARK_SAGE)
    c.drawString(58, 90, "不作为当前创新主张")
    c.setFont(FONT, 7.8)
    c.setFillColor(SUB)
    c.drawString(58, 72, "通用 GUI 自动化 · Live2D 角色 · Athena Cloud 生产服务 · 已签名公开发行 · 自动验收全部任务")


def page_8(c: canvas.Canvas) -> None:
    page_base(c, 8, "08  场景与已验证 Demo", "选择能形成完整闭环的复杂任务，而不是罗列几十个小功能")
    card(c, 42, 356, 320, 128, "01  测试驱动修复 · 已录制", "运行失败测试 → 读取实现与用例 → 定位两处缺陷 → 逐项审批修改 → 再次测试 → 交付说明。DeepSeek live E2E 已通过。", SAGE, body_size=8.3, leading=13)
    card(c, 42, 216, 320, 116, "02  本地资料 → 交付包", "读取 Markdown、CSV、DOCX/XLSX 和图片；本地 OCR；生成 PDF/DOCX。当前避免 PDF 输入，比赛设备尚需补同等级录像。", GOLD, body_size=8.1, leading=13)
    card(c, 42, 87, 320, 105, "03  受控文件与诊断", "列出对象、运行命令、检查端口与 HTTP；覆盖、删除和高风险操作进入审批，并保存路径、输出和变更摘要。", RED, body_size=8.1, leading=13)
    demo_shot = ROOT / "docs" / "competition" / "AI杭州码动未来" / "demo-output" / "live-deepseek-2026-09-18T02-31-05-252Z" / "evidence" / "01-command-approval.png"
    draw_image(c, demo_shot, 388, 176, 410, 308)
    c.setFont(FONT, 7.2)
    c.setFillColor(SUB)
    c.drawString(398, 162, "DeepSeek live E2E · 真实 Athena Renderer 命令审批画面")
    c.setFont(FONT_BOLD, 8.4)
    c.setFillColor(DARK_SAGE)
    c.drawString(388, 120, "已生成：2 分 24 秒 1080p 字幕版 + 35 秒无剪辑证据版")
    c.setFont(FONT, 7.5)
    c.setFillColor(SUB)
    c.drawString(388, 98, "边界：当前录屏来自源码构建；候选安装包已打包但未签名。UI 未配置验收项，外部 E2E 独立通过。")


def page_9(c: canvas.Canvas) -> None:
    page_base(c, 9, "09  与普通 AI 助手的区别", "比较的是当前可证实能力，不是理想形态")
    rows = [
        ["维度", "普通 Chatbot", "普通桌面助手", "Athena 0.9.7-beta.1"],
        ["任务理解", "问答/文本生成", "少量固定指令", "项目上下文 + 模型理解；入口默认规则路由"],
        ["任务规划", "给出建议步骤", "固定流程", "工具结果驱动的动态规划；可视计划不足"],
        ["工具调用", "无或单次", "预设系统能力", "注册化连续调用；默认 16 轮 / 48 次，确认后可追加"],
        ["环境操作", "用户手动", "打开应用/提醒", "文件、Shell、终端、程序、HTTP；无通用 GUI"],
        ["上下文记忆", "对话历史", "通常较弱", "本地多层记忆、项目隔离、来源；语义召回有限"],
        ["任务连续性", "单轮/单会话", "固定动作结束", "持久化 task/run/step/event，支持审批与恢复"],
        ["权限控制", "平台级开关", "系统授权", "off/read/files/full + 网络同意 + 风险审批"],
        ["结果交付", "聊天文本", "单一系统动作", "真实文件 + 证据；自动验收尚未完整接入"],
    ]
    simple_table(c, 42, 490, [105, 165, 165, 321], rows, [36] + [43] * 8, font_size=7.25)
    c.setFont(FONT, 7.2)
    c.setFillColor(SUB)
    c.drawString(42, 88, "关键判断：Athena 已能完成大量“可文件化、可命令化”的 Windows 任务，但不能表述为能控制所有桌面软件。")


def page_10(c: canvas.Canvas) -> None:
    page_base(c, 10, "10  当前完成度", "已实现、Beta 与规划项严格分开")
    card(c, 42, 128, 235, 357, "已实现", "• Electron Windows 桌面端，源码构建与 smoke 通过\n• 原生工具调用 AgentRunner\n• 22 个计算机工具\n• 持久化项目、任务、步骤、审批、证据与成果\n• 权限分级、远程同意、运行中撤权\n• SQLite 多层记忆与项目隔离\n• Ollama / OpenAI-compatible 适配\n• 常用附件、本地 OCR、文档成果\n• Skills 文本资源与 MCP 接入", GREEN, body_size=8.1, leading=15)
    card(c, 303, 128, 235, 357, "部分实现 / Beta", "• 动态规划存在；缺少可审阅的细粒度计划\n• 成果可保存；普通任务自动验收不足\n• 语音依赖就绪；未做本次真实音频 E2E\n• 图像理解取决于模型\n• DeepSeek 单例 live 通过；非多供应商稳定性证明\n• Web 研究供应商仍实验性\n• 默认记忆同义改写召回弱\n• PDF 输入导入损坏\n• 候选安装包已打包，但 Authenticode 未签名", AMBER, body_size=8.1, leading=15)
    card(c, 564, 128, 234, 357, "规划中 / 不计入当前能力", "• 通用鼠标、键盘、屏幕视觉理解\n• 任意 Windows GUI 自动化\n• 可编辑结构化计划\n• 普通任务的完整自动验收\n• 签名公开发行与商店上架\n• 干净设备规模化 Beta 证明\n• Athena Cloud 生产级服务\n• 默认角色 Live2D（release gate 当前关闭）", RED, body_size=8.1, leading=15)
    c.setFont(FONT_BOLD, 8.4)
    c.setFillColor(INK)
    c.drawString(42, 94, "版本结论：私测候选版，安装程序已打包但未签名；测试桩、源码存在、真实设备运行和线上服务可用性不能混写。")


def page_11(c: canvas.Canvas) -> None:
    page_base(c, 11, "11  安全与隐私", "权限边界与逐项审批已进入执行主链；新防护仍需专项实机证据")
    draw_image(c, ROOT / "docs" / "brand" / "ui-shots" / "settings-day.png", 438, 239, 360, 245)
    c.setFont(FONT, 7.3)
    c.setFillColor(SUB)
    c.drawString(449, 226, "当前运行时 Settings 界面 · Beta 状态保留")
    card(c, 42, 355, 360, 130, "已存在的安全边界", "权限默认 off；仅 Execute 可获得计算机权限；模型请求与外部网络分别同意；高风险工具审批；运行中撤权收紧上限；不确定重放要求 critical 确认。", GREEN)
    card(c, 42, 218, 360, 113, "本地数据与凭据", "SQLite 与项目文件保存在设备；Project/窗口/附件隔离；记忆有保留分层与摘要。Renderer sandbox + context isolation，nodeIntegration 关闭；API key 使用 safeStorage 且不下发 Renderer。", SAGE)
    card(c, 42, 75, 360, 119, "当前新增防护", "待审批调用逐项展示命令、工作目录、路径、URL 和写入预览；支持逐项批准/拒绝。追加写入与 Startup、Shell profile、Git hooks、快捷方式等自动执行位置会单独提示。", GREEN)
    card(c, 438, 75, 360, 126, "证据边界", "隔离夹具驱动的真实 Renderer E2E 已通过；另有一条 DeepSeek live 任务与逐项审批录屏。候选安装包完成隐私封装检查但未签名；尚无比赛设备复测或第三方安全认证。", RED)


def page_12(c: canvas.Canvas) -> None:
    page_base(c, 12, "12—14  应用价值 / 规划 / 总结", "当前 Readiness：B · 有真实主链，尚未达到现场稳定与完整验收的 A 级")
    card(c, 42, 352, 238, 133, "实际应用价值", "个人工作往往由资料、文件、脚本、检查、确认和交付组成。Athena 把它们放进可追踪的任务空间，让用户从“每一步亲自操作”转向“说明目标、设定边界、关键节点确认、检查成果”。", SAGE)
    card(c, 302, 352, 238, 133, "短期优先", "1. 可视结构化计划与验收\n2. 修复 PDF 导入及假绿测试\n3. 比赛设备真实 E2E 三次\n4. 新安全交互专项回归\n5. 语义记忆与用户数据", RED)
    card(c, 562, 352, 236, 133, "中期方向", "增强本地语义检索；真实模型/音频/干净机器测试；优化打包与签名；在隐私与授权可控后研究 GUI 自动化；强化 MCP/Skill 来源审计。", GOLD)
    c.setFillColor(DARK_SAGE)
    c.roundRect(42, 225, 756, 94, 12, fill=1, stroke=0)
    c.setFont(FONT_BOLD, 20)
    c.setFillColor(WHITE)
    c.drawCentredString(PAGE_W / 2, 278, "让 AI 从“回答问题”走向")
    c.setFont(FONT_BOLD, 25)
    c.drawCentredString(PAGE_W / 2, 245, "“在用户授权下完成任务”")
    c.setFont(FONT_BOLD, 10)
    c.setFillColor(INK)
    c.drawString(42, 187, "当前验证摘要")
    checks = [
        ("Electron smoke", "PASS"), ("Agent runtime", "PASS"), ("Execute UI E2E", "PASS"),
        ("DeepSeek live", "PASS"), ("Demo MP4", "PASS"), ("Memory paraphrase", "0.000"),
        ("PDF input", "KNOWN BUG"), ("Signed release", "NOT SIGNED"),
    ]
    x, y = 42, 146
    for label, status in checks:
        color = GREEN if status in ("PASS", "1.000") else RED if status in ("KNOWN BUG", "0.000") else AMBER
        w = 88
        c.setFillColor(WHITE)
        c.setStrokeColor(LINE)
        c.roundRect(x, y, w, 42, 7, fill=1, stroke=1)
        c.setFont(FONT, 6.8)
        c.setFillColor(SUB)
        c.drawCentredString(x + w / 2, y + 26, label)
        c.setFont(FONT_BOLD, 7.3)
        c.setFillColor(color)
        c.drawCentredString(x + w / 2, y + 11, status)
        x += 95
    c.setFont(FONT, 7.4)
    c.setFillColor(SUB)
    c.drawString(42, 106, "完整材料、代码依据、Demo 脚本、能力映射与补拍清单见同目录附件。")
    c.drawString(42, 89, "视觉说明：核心功能页保留仓库 UI 图；第 8 页为本次 DeepSeek live E2E 的真实审批截图。")


def build() -> None:
    register_fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("Athena AI杭州码动未来 项目说明书")
    c.setAuthor("Athena 项目组")
    c.setSubject("2026 AI杭州·码动未来 AI+超级智能体赛道 高校组")
    pages = [cover, page_2, page_3, page_4, page_5, page_6, page_7, page_8, page_9, page_10, page_11, page_12]
    for draw in pages:
        draw(c)
        c.showPage()
    c.save()
    print(f"ATHENA_COMPETITION_PDF_OK pages={len(pages)} path={OUT}")


if __name__ == "__main__":
    build()
