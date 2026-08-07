#!/usr/bin/env python3
"""Generate JARVIS 1.0.0-Preview product prototype SVG wireframes."""
from __future__ import annotations

import json
import os
import textwrap

OUT_DIR = os.path.join(os.path.dirname(__file__), "images")
W, H = 1280, 800

# ── Apple Human Interface Guidelines · macOS semantic colors ──
COLORS_LIGHT = {
    "desktop": "#d6d6da",
    "window": "#ffffff",
    "bg": "#ffffff",
    "sidebar": "#ececec",
    "surface": "#ffffff",
    "surface_raised": "#f5f5f7",
    "surface_input": "#ffffff",
    "surface_hover": "#e5e5ea",
    "surface_active": "#dcebff",
    "surface_grouped": "#f2f2f7",
    "border": "#d1d1d6",
    "border_subtle": "#e5e5ea",
    "separator": "#c6c6c8",
    "text": "#1d1d1f",
    "text_bright": "#000000",
    "text_secondary": "#3c3c43",
    "muted": "#8e8e93",
    "muted_dim": "#aeaeb2",
    "primary": "#007aff",
    "primary_pressed": "#0062cc",
    "primary_soft": "#e8f2ff",
    "accent": "#5856d6",
    "success": "#34c759",
    "success_bg": "#e8f8ec",
    "danger": "#ff3b30",
    "danger_bg": "#ffebea",
    "warn": "#ff9500",
    "warn_bg": "#fff4e5",
    "user_msg": "#007aff",
    "user_msg_fg": "#ffffff",
    "title_bar": "#ececec",
    "badge_mvp": "#e8f2ff",
    "badge_v1": "#e8f8ec",
    "badge_fg_mvp": "#0066cc",
    "badge_fg_v1": "#248a3d",
    "composer": "#f5f5f7",
    "composer_border": "#d1d1d6",
    "toggle_track": "#e5e5ea",
    "toggle_active": "#ffffff",
    "toggle_shadow": "rgba(0,0,0,0.06)",
    "shadow": "#0000002e",
}

COLORS_DARK = {
    "desktop": "#1a1a1c",
    "window": "#282828",
    "bg": "#1e1e1e",
    "sidebar": "#2d2d2d",
    "surface": "#1e1e1e",
    "surface_raised": "#2c2c2e",
    "surface_input": "#3a3a3c",
    "surface_hover": "#48484a",
    "surface_active": "#1a3a5c",
    "surface_grouped": "#1c1c1e",
    "border": "#48484a",
    "border_subtle": "#38383a",
    "separator": "#545458",
    "text": "#f5f5f7",
    "text_bright": "#ffffff",
    "text_secondary": "#ebebf5",
    "muted": "#98989d",
    "muted_dim": "#636366",
    "primary": "#0a84ff",
    "primary_pressed": "#409cff",
    "primary_soft": "#1a3a5c",
    "accent": "#5e5ce6",
    "success": "#30d158",
    "success_bg": "#1a3d24",
    "danger": "#ff453a",
    "danger_bg": "#3d1f1d",
    "warn": "#ff9f0a",
    "warn_bg": "#3d2e14",
    "user_msg": "#0a84ff",
    "user_msg_fg": "#ffffff",
    "title_bar": "#2d2d2d",
    "badge_mvp": "#1a3a5c",
    "badge_v1": "#1a3d24",
    "badge_fg_mvp": "#64b5ff",
    "badge_fg_v1": "#6ee787",
    "composer": "#2c2c2e",
    "composer_border": "#48484a",
    "toggle_track": "#636366",
    "toggle_active": "#636366",
    "toggle_shadow": "rgba(0,0,0,0.35)",
    "shadow": "#00000066",
}

COLORS: dict = {}


def set_theme(theme: str = "light") -> None:
    global COLORS
    COLORS = COLORS_DARK if theme == "dark" else COLORS_LIGHT


set_theme("light")

# Apple Typography (SF Pro scale · pt)
TYPE = {
    "caption2": 10,
    "caption": 11,
    "footnote": 12,
    "subhead": 13,
    "body": 13,
    "callout": 14,
    "headline": 13,
    "title3": 15,
    "title2": 17,
    "title1": 22,
    "large": 26,
}

SPACE = {"xs": 4, "sm": 8, "md": 12, "lg": 16, "xl": 20, "2xl": 24, "3xl": 32, "4xl": 40}

FONT_UI = "-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','Helvetica Neue','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
FONT_MONO = "'SF Mono',ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace"

WIN_INSET = 14
WIN_RX = 10
TITLE_H = 52
SIDEBAR_W = 264
NAV_TOTAL_W = SIDEBAR_W
TOOLBAR_H = 44

SVG_DEFS = """
<defs>
  <filter id="appleShadow" x="-8%" y="-8%" width="116%" height="116%">
    <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000000" flood-opacity="0.18"/>
  </filter>
  <linearGradient id="titleBarGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="var(--tb-top, #ececec)"/>
    <stop offset="100%" stop-color="var(--tb-bot, #e4e4e4)"/>
  </linearGradient>
</defs>"""


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def win_bounds():
    x, y = WIN_INSET, WIN_INSET
    w, h = W - WIN_INSET * 2, H - WIN_INSET * 2
    return x, y, w, h


def rect(x, y, w, h, fill, stroke=None, rx=8, opacity=1, dash=None, sw=0.5):
    stroke = stroke if stroke is not None else COLORS["border_subtle"]
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    sw_attr = f' stroke-width="{sw}"' if stroke and sw else (' stroke-width="0"' if not stroke else f' stroke-width="{sw}"')
    st = stroke or "none"
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
        f'fill="{fill}" stroke="{st}"{sw_attr} opacity="{opacity}"{dash_attr}/>'
    )


def line(x1, y1, x2, y2, color=None, sw=0.5):
    color = color or COLORS["separator"]
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}"/>'


def text(x, y, content, size=None, fill=None, weight="400", anchor="start", font=FONT_UI, opacity=1):
    size = size or TYPE["body"]
    fill = fill or COLORS["text"]
    op = f' opacity="{opacity}"' if opacity != 1 else ""
    return (
        f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" '
        f'fill="{fill}" font-weight="{weight}" text-anchor="{anchor}"{op}>{esc(content)}</text>'
    )


def mono(x, y, content, size=None, fill=None, weight="400", anchor="start"):
    return text(x, y, content, size or TYPE["footnote"], fill or COLORS["primary"], weight, anchor, FONT_MONO)


def badge(x, y, label, bg=None, fg=None):
    bg = bg or COLORS["primary_soft"]
    fg = fg or COLORS["badge_fg_mvp"]
    w = max(36, len(label) * 6.2 + 16)
    return (
        rect(x, y, w, 22, bg, None, rx=11, sw=0)
        + text(x + w / 2, y + 15, label, TYPE["caption"], fg, "600", "middle")
    )


def traffic_lights(x, y):
    """macOS window controls."""
    parts = []
    for i, (fill, stroke) in enumerate([
        ("#ff5f57", "#e0443e"),
        ("#febc2e", "#dea123"),
        ("#28c840", "#1aab29"),
    ]):
        cx = x + i * 20
        parts.append(f'<circle cx="{cx}" cy="{y}" r="6" fill="{fill}" stroke="{stroke}" stroke-width="0.5"/>')
    return "".join(parts)


def theme_switcher(x, y, active="light"):
    """NSSegmentedControl style · A10."""
    seg_w, h = 56, 24
    total_w = seg_w * 2 + 4
    parts = [rect(x, y, total_w, h, COLORS["toggle_track"], None, rx=h / 2, sw=0)]
    for i, (key, label) in enumerate([("light", "浅色"), ("dark", "深色")]):
        sx = x + 2 + i * (seg_w + 2)
        is_active = active == key
        if is_active:
            parts.append(rect(sx, y + 2, seg_w, h - 4, COLORS["window"], COLORS["border_subtle"], rx=(h - 4) / 2, sw=0.5))
        fg = COLORS["text"] if is_active else COLORS["muted"]
        parts.append(text(sx + seg_w / 2, y + 16, label, TYPE["caption"], fg, "600" if is_active else "400", "middle"))
    return "".join(parts)


def window_frame(theme_active="light"):
    """Desktop + rounded window shell."""
    wx, wy, ww, wh = win_bounds()
    parts = [rect(0, 0, W, H, COLORS["desktop"], None, rx=0, sw=0)]
    parts.append(f'<g filter="url(#appleShadow)">')
    parts.append(rect(wx, wy, ww, wh, COLORS["window"], COLORS["border"], rx=WIN_RX, sw=0.5))
    parts.append("</g>")
    parts.append(rect(wx, wy, ww, TITLE_H, COLORS["title_bar"], None, rx=WIN_RX, sw=0))
    parts.append(rect(wx, wy + TITLE_H - WIN_RX, ww, WIN_RX, COLORS["title_bar"], None, rx=0, sw=0))
    parts.append(line(wx, wy + TITLE_H, wx + ww, wy + TITLE_H, COLORS["separator"]))
    parts.append(traffic_lights(wx + 18, wy + TITLE_H / 2))
    return "".join(parts), wx, wy, ww, wh


def window_chrome(title: str, theme_active="light"):
    frame, wx, wy, ww, wh = window_frame(theme_active)
    parts = [frame]
    parts.append(text(wx + ww / 2, wy + TITLE_H / 2 + 5, title, TYPE["footnote"], COLORS["muted"], "500", "middle"))
    parts.append(theme_switcher(wx + ww - 128, wy + 14, theme_active))
    content_top = wy + TITLE_H
    content_h = wh - TITLE_H
    return "".join(parts), wx, wy, ww, wh, content_top, content_h


def search_field(x, y, w, placeholder="搜索"):
    h = 28
    parts = [rect(x, y, w, h, COLORS["surface_input"], COLORS["border_subtle"], rx=h / 2, sw=0.5)]
    parts.append(text(x + 12, y + 18, "⌕", TYPE["footnote"], COLORS["muted"]))
    parts.append(text(x + 28, y + 18, placeholder, TYPE["subhead"], COLORS["muted_dim"]))
    return "".join(parts)


def sidebar_row(x, y, w, label, selected=False, icon="●"):
    h = 32
    parts = []
    if selected:
        parts.append(rect(x, y, w, h, COLORS["surface_active"], None, rx=8, sw=0))
    parts.append(text(x + 14, y + 20, icon, TYPE["caption"], COLORS["primary"] if selected else COLORS["muted"]))
    parts.append(text(x + 32, y + 21, label, TYPE["subhead"], COLORS["text"] if selected else COLORS["text_secondary"],
                      "600" if selected else "400"))
    return "".join(parts)


def build_sidebar(sx, sy, sh, active: str = "对话"):
    parts = [rect(sx, sy, SIDEBAR_W, sh, COLORS["sidebar"], None, rx=0, sw=0)]
    parts.append(line(sx + SIDEBAR_W, sy, sx + SIDEBAR_W, sy + sh, COLORS["separator"]))
    parts.append(text(sx + SPACE["lg"], sy + 28, "JARVIS", TYPE["title3"], COLORS["text_bright"], "700"))
    parts.append(search_field(sx + SPACE["md"], sy + 40, SIDEBAR_W - SPACE["lg"], "搜索 Agent"))
    nav_items = [("对话", "对话"), ("Agent", "Agent"), ("Task", "Task"), ("代码", "代码"), ("Skills", "Skills"), ("设置", "设置")]
    iy = sy + 84
    parts.append(text(sx + SPACE["lg"], iy, "功能", TYPE["caption"], COLORS["muted"], "600"))
    iy += 18
    for label, key in nav_items:
        parts.append(sidebar_row(sx + SPACE["sm"], iy, SIDEBAR_W - SPACE["md"], label, key == active))
        iy += 36
    iy += 8
    parts.append(text(sx + SPACE["lg"], iy, "Agent", TYPE["caption"], COLORS["muted"], "600"))
    iy += 18
    for name, sel in [("办公助手", True), ("编程 Agent", False), ("文档 Agent", False)]:
        parts.append(sidebar_row(sx + SPACE["sm"], iy, SIDEBAR_W - SPACE["md"], name, sel, "◎"))
        iy += 36
    return "".join(parts)


def left_nav(sx, sy, sh, active: str = "对话"):
    return build_sidebar(sx, sy, sh, active), NAV_TOTAL_W


def content_area(x, y, w, h):
    return rect(x, y, w, h, COLORS["bg"], None, rx=0, sw=0)


def header_bar(x, y, w, title, subtitle="", tags=None):
    parts = []
    parts.append(text(x + SPACE["lg"], y + 28, title, TYPE["title2"], COLORS["text_bright"], "700"))
    if subtitle:
        parts.append(text(x + SPACE["lg"], y + 48, subtitle, TYPE["footnote"], COLORS["muted"]))
    parts.append(line(x + SPACE["md"], y + TOOLBAR_H, x + w - SPACE["md"], y + TOOLBAR_H, COLORS["separator"]))
    if tags:
        tx = x + w - SPACE["lg"] - 130
        for tag in reversed(tags):
            is_mvp = tag == "MVP"
            tw = max(36, len(tag) * 6.2 + 16)
            tx -= tw + 8
            parts.append(badge(tx, y + 12, tag, COLORS["badge_mvp"] if is_mvp else COLORS["badge_v1"],
                               COLORS["badge_fg_mvp"] if is_mvp else COLORS["badge_fg_v1"]))
    return "".join(parts)


def input_box(x, y, w, h, placeholder="", label=""):
    parts = []
    if label:
        parts.append(text(x, y, label, TYPE["caption"], COLORS["muted"], "600"))
        y += 16
    parts.append(rect(x, y, w, h, COLORS["surface_input"], COLORS["border"], rx=8, sw=0.5))
    if placeholder:
        parts.append(text(x + SPACE["md"], y + h / 2 + 5, placeholder, TYPE["subhead"], COLORS["muted_dim"]))
    return "".join(parts)


def button(x, y, w, h, label, primary=True):
    if primary:
        fill, stroke, fg, rx = COLORS["primary"], None, "#ffffff", h / 2
    else:
        fill, stroke, fg, rx = COLORS["surface_input"], COLORS["border"], COLORS["text"], 8
    parts = [rect(x, y, w, h, fill, stroke, rx=rx, sw=0.5 if stroke else 0)]
    parts.append(text(x + w / 2, y + h / 2 + 5, label, TYPE["subhead"], fg, "600", "middle"))
    return "".join(parts)


def chat_bubble(x, y, w, h, content, user=False):
    lines = textwrap.wrap(content, width=max(18, int(w / 7.2))) or [content]
    lh = 20
    calc_h = max(h, SPACE["lg"] * 2 + len(lines[:8]) * lh)
    if user:
        parts = [rect(x, y, w, calc_h, COLORS["user_msg"], None, rx=18, sw=0)]
        fg = COLORS["user_msg_fg"]
    else:
        parts = [rect(x, y, w, calc_h, COLORS["surface_raised"], None, rx=12, sw=0)]
        fg = COLORS["text"]
    ty = y + SPACE["lg"] + 6
    for line in lines[:8]:
        parts.append(text(x + SPACE["md"], ty, line, TYPE["subhead"], fg, "400"))
        ty += lh
    return "".join(parts)


def composer(x, y, w, placeholder="输入消息，@ 引用文件或 Agent…"):
    h = 92
    parts = [rect(x, y, w, h, COLORS["composer"], COLORS["composer_border"], rx=14, sw=0.5)]
    parts.append(text(x + SPACE["lg"], y + 32, placeholder, TYPE["subhead"], COLORS["muted_dim"]))
    parts.append(rect(x + SPACE["md"], y + h - 38, 130, 26, COLORS["surface_input"], COLORS["border_subtle"], rx=13, sw=0.5))
    parts.append(text(x + SPACE["md"] + 10, y + h - 18, "GPT-4o · 办公助手", TYPE["caption"], COLORS["muted"]))
    parts.append(rect(x + w - 44, y + h - 38, 28, 28, COLORS["primary"], None, rx=14, sw=0))
    parts.append(text(x + w - 30, y + h - 18, "↑", TYPE["callout"], "#fff", "700", "middle"))
    return "".join(parts)


def tool_chip(x, y, label):
    w = len(label) * 6.5 + 24
    parts = [rect(x, y, w, 26, COLORS["surface_grouped"], COLORS["border_subtle"], rx=13, sw=0.5)]
    parts.append(mono(x + 10, y + 17, label, TYPE["caption"], COLORS["accent"]))
    return "".join(parts), w


def grouped_section(x, y, w, title, rows):
    parts = []
    if title:
        parts.append(text(x + SPACE["xs"], y, title.upper(), TYPE["caption"], COLORS["muted"], "600"))
        y += 16
    rh = 44
    parts.append(rect(x, y, w, rh * len(rows), COLORS["surface"], COLORS["border_subtle"], rx=10, sw=0.5))
    for i, (left, right) in enumerate(rows):
        ry = y + i * rh
        if i > 0:
            parts.append(line(x + SPACE["md"], ry, x + w - SPACE["md"], ry, COLORS["separator"]))
        parts.append(text(x + SPACE["md"], ry + 28, left, TYPE["subhead"], COLORS["text"]))
        if right:
            parts.append(text(x + w - SPACE["md"], ry + 28, right, TYPE["subhead"], COLORS["muted"], "400", "end"))
    return "".join(parts), y + rh * len(rows) + SPACE["lg"]


def segmented_tabs(x, y, tabs, active_idx=0):
    """NSSegmentedControl for horizontal tab groups."""
    parts = []
    tx = x
    seg_h = 28
    for i, tab in enumerate(tabs):
        tw = max(52, len(tab) * 7 + 24)
        is_active = i == active_idx
        fill = COLORS["surface_active"] if is_active else COLORS["surface_raised"]
        stroke = COLORS["primary"] if is_active else COLORS["border_subtle"]
        parts.append(rect(tx, y, tw, seg_h, fill, stroke, rx=6, sw=0.5 if not is_active else 1))
        parts.append(text(tx + tw / 2, y + 19, tab, TYPE["caption"], COLORS["text"] if is_active else COLORS["muted"],
                          "600" if is_active else "400", "middle"))
        tx += tw + 4
    return "".join(parts)


def list_card(x, y, w, h, title, subtitle="", meta="", status_color=None):
    """Inset grouped list row card."""
    parts = [rect(x, y, w, h, COLORS["surface"], COLORS["border_subtle"], rx=10, sw=0.5)]
    parts.append(text(x + SPACE["md"], y + 26, title, TYPE["subhead"], COLORS["text"], "600"))
    if subtitle:
        parts.append(text(x + SPACE["md"], y + 46, subtitle, TYPE["footnote"], COLORS["muted"]))
    if meta:
        parts.append(text(x + w - SPACE["md"], y + 26, meta, TYPE["footnote"], COLORS["muted"], "400", "end"))
    if status_color:
        parts.append(text(x + w - SPACE["md"], y + 46, status_color[1], TYPE["footnote"], status_color[0], "600", "end"))
    return "".join(parts)


def onboarding_card(cx, cy, cw, ch, step, total, title, subtitle):
    """Centered Apple-style onboarding panel."""
    card_w, card_h = min(560, cw - 80), min(480, ch - 80)
    x, y = cx + (cw - card_w) / 2, cy + (ch - card_h) / 2 - 20
    parts = [rect(x, y, card_w, card_h, COLORS["surface"], COLORS["border_subtle"], rx=16, sw=0.5)]
    parts.append(text(x + card_w / 2, y + 36, f"Step {step} of {total}", TYPE["caption"], COLORS["muted"], "600", "middle"))
    parts.append(text(x + card_w / 2, y + 68, title, TYPE["title1"], COLORS["text_bright"], "700", "middle"))
    if subtitle:
        parts.append(text(x + card_w / 2, y + 98, subtitle, TYPE["subhead"], COLORS["muted"], "400", "middle"))
    return "".join(parts), x, y, card_w, card_h


def proto_main_chat(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "办公助手", "主聊天 · K1", ["MVP", "D1-D3"]))
    pad = SPACE["2xl"]
    content_w = cw - pad * 2
    y = cy + TOOLBAR_H + SPACE["md"]
    p.append(chat_bubble(cx + pad, y, content_w - 140, 76,
                         "你好！我是办公助手，可以帮你处理文档、搜索信息和执行简单任务。"))
    y += 92
    p.append(chat_bubble(cx + pad + content_w - 300, y, 280, 48,
                         "帮我总结这份项目需求文档的要点", True))
    y += 64
    chip_x = cx + pad
    chip, cw_chip = tool_chip(chip_x, y, "read_file")
    p.append(chip)
    chip_x += cw_chip + 8
    chip, cw_chip = tool_chip(chip_x, y, "wiki/需求文档/…")
    p.append(chip)
    y += 40
    p.append(chat_bubble(cx + pad, y, content_w - 140, 100,
                         "好的，我已分析文档。核心要点：\n1) 跨平台本地 Agent 平台\n2) Agent-first 交互\n3) 轻量编程形态\n4) Multica Runtime 兼容"))
    p.append(composer(cx + pad, cy + ch - 108, content_w))
    return "".join(p)


def proto_onboarding_provider(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "首次引导", "Provider 配置 · L1/B · Step 1/3", ["MVP", "B1-B8"]))
    card, x, y, cw_card, _ = onboarding_card(cx, cy, cw, ch, 1, 3, "Welcome to JARVIS",
                                              "Configure your model provider (fully custom · Q4)")
    p.append(card)
    fy = y + 120
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"], 36, "OpenAI Compatible / Anthropic Compatible", "Provider Type · B13"))
    fy += 56
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"], 36, "https://api.example.com/v1", "API Base URL · B2"))
    fy += 56
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"], 36, "sk-••••••••••••", "API Key · B7"))
    fy += 56
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"], 36, "my-custom-model-id", "Model ID · B4"))
    fy += 64
    p.append(button(x + cw_card - SPACE["2xl"] - 112, fy, 112, 32, "Continue", True))
    p.append(button(x + cw_card - SPACE["2xl"] - 236, fy, 112, 32, "Test · B8", False))
    return "".join(p)


def proto_onboarding_agent(cx, cy, cw, ch, active="Agent"):
    p = []
    p.append(header_bar(cx, cy, cw, "首次引导", "创建 Agent · L1/F1 · Step 2/3", ["MVP", "F1-F5"]))
    card, x, y, cw_card, _ = onboarding_card(cx, cy, cw, ch, 2, 3, "创建你的第一个 Agent", "配置名称、Prompt 与工作区")
    p.append(card)
    fy = y + 120
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"] - 96, 36, "办公助手", "名称"))
    p.append(rect(x + cw_card - SPACE["2xl"] - 72, fy, 72, 36, COLORS["primary_soft"], COLORS["primary"], rx=8))
    p.append(text(x + cw_card - SPACE["2xl"] - 36, fy + 23, "头像", TYPE["footnote"], COLORS["primary"], "500", "middle"))
    fy += 56
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"], 72, "你是一个高效的办公助手，擅长文档分析、写作和信息整理...", "System Prompt · F2"))
    fy += 92
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"], 36, "my-custom-model-id", "绑定模型 · B3"))
    fy += 56
    p.append(input_box(x + SPACE["2xl"], fy, cw_card - SPACE["4xl"], 36, "/Users/me/projects/demo", "工作区 · C7"))
    fy += 64
    p.append(button(x + cw_card - SPACE["2xl"] - 112, fy, 112, 32, "下一步", True))
    return "".join(p)


def proto_onboarding_env(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "首次引导", "环境诊断 · L2/L3 · Step 3/3", ["MVP"]))
    card, x, y, cw_card, ch_card = onboarding_card(cx, cy, cw, ch, 3, 3, "环境自检报告", "确认运行环境已就绪")
    p.append(card)
    checks = [
        ("Node.js 20.x", True), ("Go 1.22+", True), ("Git", True),
        ("jarvis-daemon", True), ("jarvis-agent CLI", True),
        ("Provider 连通", True), ("MCP 基础", False),
    ]
    fy = y + 120
    for name, ok in checks:
        color = COLORS["success"] if ok else COLORS["warn"]
        label = "通过" if ok else "可选"
        p.append(f'<circle cx="{x + SPACE["2xl"] + 6}" cy="{fy}" r="5" fill="{color}"/>')
        p.append(text(x + SPACE["2xl"] + 20, fy + 5, name, TYPE["subhead"], COLORS["text"]))
        p.append(text(x + cw_card - SPACE["2xl"], fy + 5, label, TYPE["footnote"], color, "600", "end"))
        fy += 32
    p.append(button(x + cw_card / 2 - 80, fy + 16, 160, 36, "进入 JARVIS", True))
    return "".join(p)


def proto_agent_list(cx, cy, cw, ch, active="Agent"):
    p = []
    p.append(header_bar(cx, cy, cw, "Agent 管理", "创建/编辑/归档 · C2/F1", ["MVP", "F1-F6"]))
    p.append(button(cx + cw - 140, cy + 12, 120, 32, "+ 新建 Agent", True))
    cards = [
        ("办公助手", "文档分析、写作、搜索", "my-model-1", "MVP"),
        ("编程 Agent", "代码读写、Shell、Git", "my-model-2", "MVP"),
        ("审查 Agent", "Code Review、测试", "my-model-3", "1.0.0-Preview"),
        ("Squad Leader", "任务分派与协调", "my-model-1", "1.0.0-Preview"),
    ]
    x, y = cx + SPACE["2xl"], cy + 80
    card_w = (cw - SPACE["4xl"] - SPACE["md"]) / 2
    for i, (name, desc, model, tier) in enumerate(cards):
        col, row = i % 2, i // 2
        cx0 = x + col * (card_w + SPACE["md"])
        cy0 = y + row * 130
        p.append(rect(cx0, cy0, card_w, 110, COLORS["surface"], COLORS["border_subtle"], rx=12))
        p.append(f'<circle cx="{cx0 + 32}" cy="{cy0 + 36}" r="18" fill="{COLORS["primary_soft"]}" stroke="{COLORS["primary"]}" stroke-width="1"/>')
        p.append(text(cx0 + 60, cy0 + 32, name, TYPE["title3"], COLORS["text"], "600"))
        p.append(text(cx0 + 60, cy0 + 52, desc, TYPE["footnote"], COLORS["muted"]))
        p.append(text(cx0 + 60, cy0 + 72, f"模型: {model}", TYPE["caption"], COLORS["muted"]))
        p.append(badge(cx0 + 60, cy0 + 82, tier))
    return "".join(p)


def proto_provider(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "Provider 管理", "全自定义模型 · 无预设 Q4 · C1/B", ["MVP", "B1-B13"]))
    p.append(button(cx + cw - 150, cy + 12, 130, 32, "+ 添加 Provider", True))
    rows = [
        ("OpenAI 兼容", "https://api.openai.com/v1", "2 模型", "已连接"),
        ("Anthropic 兼容", "https://api.anthropic.com", "1 模型", "已连接"),
        ("Ollama 本地", "http://localhost:11434/v1", "3 模型", "离线可用"),
    ]
    gx = cx + SPACE["2xl"]
    gw = cw - SPACE["4xl"]
    gy = cy + 80
    for name, url, models, status in rows:
        sec, gy = grouped_section(gx, gy, gw, name, [
            (url, models),
            ("状态", status),
            ("操作", "编辑 · 测试 · 删除"),
        ])
        p.append(sec)
    return "".join(p)


def proto_code_panel(cx, cy, cw, ch, active="代码"):
    p = []
    p.append(header_bar(cx, cy, cw, "Diff 预览", "轻量代码面板 · K3/E9", ["1.0.0-Preview", "E9"]))
    tree_w = 200
    p.append(rect(cx + SPACE["md"], cy + 48, tree_w, ch - 64, COLORS["surface_raised"], COLORS["border"], rx=0))
    p.append(text(cx + SPACE["lg"], cy + 68, "EXPLORER", TYPE["caption"], COLORS["muted_dim"], "600"))
    ty = cy + 88
    for f, indent, active_f in [("src/", 0, False), ("utils/", 1, False), ("auth.ts", 2, True), ("api/", 1, False)]:
        color = COLORS["text_bright"] if active_f else COLORS["muted"]
        p.append(text(cx + SPACE["lg"] + indent * 12, ty, f, TYPE["footnote"], color, "500" if active_f else "400"))
        ty += 20
    dx = cx + SPACE["md"] + tree_w + SPACE["sm"]
    dw = cw - tree_w - SPACE["lg"] * 2
    p.append(rect(dx, cy + 48, dw, ch - 64, COLORS["bg"], COLORS["border"], rx=0))
    p.append(text(dx + SPACE["md"], cy + 68, "auth.ts", TYPE["footnote"], COLORS["text_bright"], "600"))
    p.append(line(dx, cy + 78, dx + dw, cy + 78, COLORS["border"]))
    p.append(rect(dx, cy + 86, dw, 22, COLORS["danger_bg"], COLORS["danger_bg"], rx=0, sw=0))
    p.append(mono(dx + SPACE["md"], cy + 102, "- export function validate(token) {", TYPE["footnote"], COLORS["danger"]))
    p.append(rect(dx, cy + 108, dw, 22, COLORS["success_bg"], COLORS["success_bg"], rx=0, sw=0))
    p.append(mono(dx + SPACE["md"], cy + 124, "+ export function validateToken(token: string) {", TYPE["footnote"], COLORS["success"]))
    p.append(mono(dx + SPACE["md"], cy + 146, "+   if (!token) return false;", TYPE["footnote"], COLORS["success"]))
    p.append(button(dx + SPACE["md"], cy + ch - 56, 88, 28, "Accept", True))
    p.append(button(dx + 108, cy + ch - 56, 88, 28, "Reject", False))
    p.append(button(dx + 204, cy + ch - 56, 100, 28, "Accept All", True))
    return "".join(p)


def proto_task_board(cx, cy, cw, ch, active="Task"):
    p = []
    p.append(header_bar(cx, cy, cw, "Task 看板", "任务生命周期 · K4/L4-L6", ["1.0.0-Preview"]))
    cols = [("Queued", COLORS["muted"]), ("Running", COLORS["warn"]), ("Completed", COLORS["success"]), ("Failed", COLORS["danger"])]
    col_w = (cw - SPACE["4xl"]) / 4
    for i, (name, color) in enumerate(cols):
        x = cx + SPACE["2xl"] + i * (col_w + SPACE["sm"])
        p.append(text(x, cy + 68, name, TYPE["subhead"], color, "600"))
        p.append(rect(x, cy + 84, col_w, ch - 120, COLORS["surface_grouped"], None, rx=12, sw=0))
        tasks = {
            "Queued": ["重构 auth 模块"],
            "Running": ["读取需求文档...", "执行 npm test"],
            "Completed": ["生成项目摘要", "创建 README"],
            "Failed": ["Shell 权限拒绝"],
        }[name]
        ty = cy + 96
        for t in tasks:
            p.append(rect(x + SPACE["sm"], ty, col_w - SPACE["md"], 56, COLORS["surface"], COLORS["border_subtle"], rx=10))
            p.append(text(x + SPACE["md"], ty + 22, t, TYPE["subhead"], COLORS["text"]))
            p.append(text(x + SPACE["md"], ty + 40, "编程 Agent", TYPE["caption"], COLORS["muted"]))
            ty += 64
    return "".join(p)


def proto_squad(cx, cy, cw, ch, active="Agent"):
    p = []
    p.append(header_bar(cx, cy, cw, "Squad 小队", "Leader + 成员 · Multica 对齐 Q1:A · F8/F9", ["1.0.0-Preview"]))
    p.append(rect(cx + 24, cy + 72, 300, 200, COLORS["primary_soft"], COLORS["primary"]))
    p.append(text(cx + 44, cy + 100, "👑 Squad Leader", 16, COLORS["primary"], "700"))
    p.append(text(cx + 44, cy + 126, "接收任务 → @成员分派", 13, COLORS["muted"]))
    members = [("文档 Agent", "写技术方案"), ("编程 Agent", "生成示例代码"), ("审查 Agent", "Code Review")]
    mx = cx + 360
    for i, (name, role) in enumerate(members):
        my = cy + 72 + i * 90
        p.append(rect(mx, my, cw - mx + cx - 24, 76, COLORS["bg"], COLORS["border"]))
        p.append(text(mx + 16, my + 28, name, 14, COLORS["text"], "600"))
        p.append(text(mx + 16, my + 50, role, 12, COLORS["muted"]))
        p.append(text(mx + 16, my + 68, "← @mention 唤醒 F7", 11, COLORS["accent"]))
    # call chain
    p.append(text(cx + 24, cy + 300, "调用链可视化 L14: Leader → 文档Agent → 编程Agent → 审查Agent", 13, COLORS["text"]))
    p.append(rect(cx + 24, cy + 320, cw - 48, 60, COLORS["bg"], COLORS["border"]))
    chain = ["Leader", "→", "文档", "→", "编程", "→", "审查", "→", "完成"]
    tx = cx + 40
    for node in chain:
        p.append(text(tx, cy + 358, node, 13, COLORS["primary"] if node not in ("→", "完成") else COLORS["muted"], "600" if "Agent" in node or node == "Leader" else "normal"))
        tx += len(node) * 10 + 20
    return "".join(p)


def proto_settings(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "设置", "偏好与配置 · C1-C12", ["MVP/1.0.0-Preview"]))
    tabs = ["Providers", "Agents", "MCP", "Skills", "Shortcuts", "Permissions", "Workspace", "Advanced"]
    p.append(segmented_tabs(cx + SPACE["md"], cy + 52, tabs[:5], 0))
    gx = cx + SPACE["2xl"]
    gw = min(640, cw - SPACE["4xl"])
    gy = cy + 96
    p.append(rect(cx, cy + 88, cw, ch - 88, COLORS["surface_grouped"], None, rx=0, sw=0))
    sec, gy = grouped_section(gx, gy, gw, "General", [
        ("语言", "简体中文"),
        ("外观", "跟随系统 · A10"),
        ("本地模式", "关闭 · J4"),
    ])
    p.append(sec)
    sec, gy = grouped_section(gx, gy, gw, "Network", [
        ("HTTP 代理", "未配置 · L33"),
        ("Provider 超时", "30s · L34"),
    ])
    p.append(sec)
    sec, gy = grouped_section(gx, gy, gw, "Data", [
        ("SQLite 自动备份", "开启 · L18"),
        ("导入 / 导出配置", "C12"),
        ("清除敏感数据", "L20"),
    ])
    p.append(sec)
    return "".join(p)


def proto_skills(cx, cy, cw, ch, active="Skills"):
    p = []
    p.append(header_bar(cx, cy, cw, "Skills 管理", "SKILL.md + 绑定 Agent · G1-G3/C4", ["MVP/1.0.0-Preview"]))
    p.append(button(cx + cw - 130, cy + 12, 110, 32, "+ 导入 Skill", True))
    skills = [
        ("code-review", "代码审查流程", "编程 Agent"),
        ("doc-writing", "技术文档写作", "文档 Agent"),
        ("deploy-check", "部署前检查清单", "—"),
    ]
    gx = cx + SPACE["2xl"]
    gw = cw - SPACE["4xl"]
    gy = cy + 80
    sec, _ = grouped_section(gx, gy, gw, "已安装 Skills", [
        (f"{skills[0][0]} — {skills[0][1]}", skills[0][2]),
        (f"{skills[1][0]} — {skills[1][1]}", skills[1][2]),
        (f"{skills[2][0]} — {skills[2][1]}", skills[2][2]),
    ])
    p.append(sec)
    return "".join(p)


def proto_mcp(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "MCP Server 管理", "stdio/SSE/HTTP · G4-G8/C3", ["MVP/1.0.0-Preview"]))
    servers = [
        ("filesystem", "stdio", "内置 G7", "已启用"),
        ("git", "stdio", "内置 G7", "已启用"),
        ("browser", "stdio", "内置 G7", "需审批"),
        ("custom-api", "SSE", "自定义", "已禁用"),
    ]
    gx = cx + SPACE["2xl"]
    gw = cw - SPACE["4xl"]
    gy = cy + 80
    rows = []
    for name, transport, src, status in servers:
        rows.append((name, status))
        rows.append((f"{transport} · {src}", ""))
    sec, gy = grouped_section(gx, gy, gw, "MCP Servers", rows[:8])
    p.append(sec)
    return "".join(p)


def proto_multica_runtime(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "Multica Runtime", "仅 Runtime 被调度 · Q2:A · H1/L35-L39", ["1.0.0-Preview"]))
    info = [
        ("CLI", "jarvis-agent (PATH 可探测 H1.1)"),
        ("协议族", "ACP (首选 H3)"),
        ("Daemon 状态", "运行中 · 心跳 15s L7"),
        ("当前 Task", "Multica#12847 → 本地#4521 L36"),
        ("并发", "2/6 Agent · 4/20 机器 H1.11"),
    ]
    y = cy + 90
    for k, v in info:
        p.append(text(cx + 40, y, k, 14, COLORS["text"], "600"))
        p.append(text(cx + 180, y, v, 13, COLORS["muted"]))
        y += 36
    p.append(rect(cx + 40, cy + 280, cw - 80, 120, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 56, cy + 310, "流式回传进度 H1.4", 13, COLORS["accent"], "600"))
    p.append(text(cx + 56, cy + 340, "> 读取 Issue 上下文...", 12, COLORS["muted"]))
    p.append(text(cx + 56, cy + 362, "> 执行 write_file src/main.go", 12, COLORS["muted"]))
    p.append(text(cx + 56, cy + 384, "> Task completed", 12, COLORS["success"]))
    return "".join(p)


def proto_office_writing(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "AI 写作助手", "邮件/报告/文案 · D5", ["1.0.0-Preview"]))
    p.append(rect(cx + 24, cy + 72, (cw - 60) / 2, ch - 100, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 40, cy + 96, "输入区", 12, COLORS["muted"], "600"))
    p.append(text(cx + 40, cy + 130, "主题: Q3 产品规划邮件\n受众: 管理层\n要点: MVP 进展...", 13, COLORS["text"]))
    p.append(rect(cx + 36 + (cw - 60) / 2, cy + 72, (cw - 60) / 2, ch - 100, COLORS["surface"], COLORS["border"]))
    p.append(text(cx + 52 + (cw - 60) / 2, cy + 96, "生成结果", 12, COLORS["muted"], "600"))
    p.append(text(cx + 52 + (cw - 60) / 2, cy + 130, "尊敬的管理层：\n\nQ3 MVP 已完成核心链路验证...", 13, COLORS["text"]))
    p.append(button(cx + cw - 160, cy + ch - 80, 120, 36, "复制/导出", True))
    return "".join(p)


def proto_pdf_reader(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "PDF 伴读", "中英对照 · 摘要 · D7", ["1.0.0-Preview"]))
    p.append(rect(cx + 24, cy + 72, (cw - 60) * 0.55, ch - 100, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 40, cy + 96, "📄 product-spec.pdf — 第 3 页", 13, COLORS["text"], "600"))
    p.append(text(cx + 40, cy + 130, "[PDF 原文渲染区域]", 12, COLORS["muted"]))
    p.append(rect(cx + 36 + (cw - 60) * 0.55, cy + 72, (cw - 60) * 0.4, ch - 100, COLORS["primary_soft"], COLORS["primary"]))
    p.append(text(cx + 52 + (cw - 60) * 0.55, cy + 96, "AI 摘要 / 翻译", 13, COLORS["primary"], "600"))
    p.append(text(cx + 52 + (cw - 60) * 0.55, cy + 130, "本段描述 JARVIS 作为本地 Agent 平台的定位...", 13, COLORS["text"]))
    return "".join(p)


def proto_webview(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "内置浏览器 · 网页总结", "WebView I8 + D8", ["1.0.0-Preview"]))
    p.append(rect(cx + 24, cy + 64, cw - 48, 40, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 40, cy + 90, "🔒 https://example.com/article", 13, COLORS["muted"]))
    p.append(button(cx + cw - 160, cy + 70, 120, 28, "一键总结 D8", True))
    p.append(rect(cx + 24, cy + 112, (cw - 60) * 0.6, ch - 140, COLORS["surface"], COLORS["border"]))
    p.append(text(cx + 40, cy + 140, "[网页内容 WebView]", 12, COLORS["muted"]))
    p.append(rect(cx + 36 + (cw - 60) * 0.6, cy + 112, (cw - 60) * 0.35, ch - 140, COLORS["primary_soft"], COLORS["primary"]))
    p.append(text(cx + 52 + (cw - 60) * 0.6, cy + 140, "总结结果", 13, COLORS["primary"], "600"))
    p.append(text(cx + 52 + (cw - 60) * 0.6, cy + 170, "文章核心观点：...", 13, COLORS["text"]))
    return "".join(p)


def proto_dock_mode(cx, cy, cw, ch, active="对话"):
    p = []
    # narrow docked window
    p.append(rect(cx + cw - 420, cy, 400, ch, COLORS["surface"], COLORS["primary"], rx=12))
    p.append(text(cx + cw - 400, cy + 28, "JARVIS 吸附模式 A4", 14, COLORS["primary"], "600"))
    p.append(chat_bubble(cx + cw - 400, cy + 50, 360, 60, "快速提问模式，贴边展开/缩略"))
    p.append(rect(cx + cw - 400, cy + ch - 60, 360, 40, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + cw - 384, cy + ch - 34, "输入...", 13, COLORS["muted"]))
    p.append(text(cx + 40, cy + 40, "← 屏幕边缘吸附，参考豆包桌面端侧边栏", 14, COLORS["muted"]))
    return "".join(p)


def proto_tray(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(text(cx + 40, cy + 40, "系统托盘菜单 A2 / L7", 18, COLORS["text"], "600"))
    p.append(rect(cx + 40, cy + 80, 280, 220, COLORS["surface"], COLORS["border"]))
    items = ["打开 JARVIS", "Daemon: 运行中 ●", "当前 Task: 2 运行中", "Multica Runtime: 已注册", "—", "设置", "退出"]
    y = cy + 100
    for item in items:
        p.append(text(cx + 56, y, item, 13, COLORS["text"] if item != "—" else COLORS["muted"]))
        y += 28
    return "".join(p)


def proto_approval(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "敏感操作确认", "人类-in-the-loop · J2/F15", ["MVP/1.0.0-Preview"]))
    p.append(rect(cx + cw / 2 - 220, cy + 180, 440, 200, COLORS["surface"], COLORS["warn"], rx=12))
    p.append(text(cx + cw / 2, cy + 220, "⚠️ 确认执行操作？", 18, COLORS["warn"], "700", "middle"))
    p.append(text(cx + cw / 2, cy + 260, "Agent 请求执行 Shell 命令:", 13, COLORS["text"], "normal", "middle"))
    p.append(text(cx + cw / 2, cy + 290, "rm -rf ./temp/cache", 14, COLORS["danger"], "600", "middle"))
    p.append(button(cx + cw / 2 - 130, cy + 330, 100, 36, "拒绝", False))
    p.append(button(cx + cw / 2 + 20, cy + 330, 100, 36, "批准", True))
    return "".join(p)


def proto_canvas(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "Canvas 可视化工作区", "结构化输出展示 · K6", ["1.0.0-Preview"]))
    p.append(rect(cx + 24, cy + 72, cw - 48, ch - 100, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 40, cy + 100, "📊 数据分析 Canvas", 16, COLORS["text"], "600"))
    p.append(rect(cx + 40, cy + 130, 200, 120, COLORS["primary_soft"], COLORS["primary"]))
    p.append(rect(cx + 260, cy + 130, 200, 120, COLORS["surface"], COLORS["border"]))
    p.append(rect(cx + 480, cy + 130, 200, 120, COLORS["surface"], COLORS["border"]))
    p.append(text(cx + 40, cy + 280, "交互式图表 / 表格 / 代码块 — Agent 输出可视化", 13, COLORS["muted"]))
    return "".join(p)


def proto_search(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "全局搜索", "对话/Agent/Task · L21", ["1.0.0-Preview"]))
    p.append(input_box(cx + 80, cy + 100, cw - 160, 48, "搜索对话、Agent、Task...", "⌘K"))
    results = [
        ("对话", "需求文档分析 — 今日"),
        ("Agent", "编程 Agent"),
        ("Task", "重构 auth 模块 — Running"),
        ("Skill", "code-review"),
    ]
    y = cy + 180
    for typ, label in results:
        p.append(badge(cx + 80, y - 10, typ))
        p.append(text(cx + 150, y + 4, label, 14, COLORS["text"]))
        y += 40
    return "".join(p)


def proto_split_view(cx, cy, cw, ch, active="代码"):
    p = []
    p.append(header_bar(cx, cy, cw, "分屏视图", "聊天 + 文件预览 · K7", ["1.0.0-Preview"]))
    p.append(rect(cx + 16, cy + 64, cw / 2 - 24, ch - 80, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 32, cy + 88, "聊天区", 12, COLORS["muted"], "600"))
    p.append(chat_bubble(cx + 32, cy + 110, cw / 2 - 56, 60, "@src/utils/auth.ts 请重构 validateToken"))
    p.append(rect(cx + cw / 2 + 8, cy + 64, cw / 2 - 24, ch - 80, COLORS["surface"], COLORS["border"]))
    p.append(text(cx + cw / 2 + 24, cy + 88, "文件预览 — auth.ts", 12, COLORS["muted"], "600"))
    p.append(text(cx + cw / 2 + 24, cy + 120, "export function validateToken...", 12, COLORS["text"]))
    return "".join(p)


def proto_plan_mode(cx, cy, cw, ch, active="代码"):
    p = []
    p.append(header_bar(cx, cy, cw, "Plan 模式", "只读分析，不改文件 · E10", ["1.0.0-Preview"]))
    p.append(badge(cx + 24, cy + 72, "Plan Mode"))
    p.append(chat_bubble(cx + 24, cy + 100, cw - 48, 80, "请分析如何重构 auth 模块，不要直接修改文件"))
    p.append(rect(cx + 24, cy + 200, cw - 48, 280, COLORS["primary_soft"], COLORS["primary"]))
    p.append(text(cx + 40, cy + 230, "📋 执行计划", 16, COLORS["primary"], "700"))
    steps = ["1. 分析 auth.ts 现有结构", "2. 提取 validateToken 函数", "3. 更新引用位置", "4. 运行测试验证"]
    for i, s in enumerate(steps):
        p.append(text(cx + 40, cy + 260 + i * 28, s, 13, COLORS["text"]))
    p.append(button(cx + 40, cy + 400, 140, 36, "开始执行", True))
    return "".join(p)


def proto_task_log(cx, cy, cw, ch, active="Task"):
    p = []
    p.append(header_bar(cx, cy, cw, "Task 执行日志", "流式双通道 · K5/L5", ["1.0.0-Preview"]))
    logs = [
        ("10:02:01", "Task 创建 #4521", COLORS["muted"]),
        ("10:02:02", "调用 read_file wiki/需求文档/...", COLORS["accent"]),
        ("10:02:05", "LLM 推理中... (streaming)", COLORS["primary"]),
        ("10:02:18", "调用 write_file src/utils/auth.ts", COLORS["accent"]),
        ("10:02:22", "LSP 诊断: 0 errors", COLORS["success"]),
        ("10:02:25", "Task completed", COLORS["success"]),
    ]
    y = cy + 80
    for ts, msg, color in logs:
        p.append(text(cx + 32, y, ts, 12, COLORS["muted"]))
        p.append(text(cx + 120, y, msg, 13, color))
        y += 32
    return "".join(p)


def proto_selection_menu(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "划词菜单", "App 内划词 · D4", ["1.0.0-Preview"]))
    p.append(text(cx + 40, cy + 120, "Selected text: \"Agent Client Protocol\"", 14, COLORS["text"]))
    p.append(rect(cx + 40, cy + 150, 320, 160, COLORS["surface"], COLORS["primary"], rx=8))
    for i, action in enumerate(["翻译", "解释", "总结", "搜索", "发送到聊天"]):
        p.append(text(cx + 56, cy + 180 + i * 28, action, 14, COLORS["text"]))
    p.append(text(cx + 40, cy + 340, "注: 系统级全局划词 I1 推迟至 V2.0", 12, COLORS["muted"]))
    return "".join(p)


def proto_voice(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "语音输入", "App 内语音对话 · D11", ["1.0.0-Preview"]))
    p.append(f'<circle cx="{cx + cw/2}" cy="{cy + 260}" r="60" fill="{COLORS["primary_soft"]}" stroke="{COLORS["primary"]}" stroke-width="2"/>')
    p.append(text(cx + cw / 2, cy + 268, "🎤", 32, COLORS["primary"], "normal", "middle"))
    p.append(text(cx + cw / 2, cy + 340, "正在聆听...", 16, COLORS["text"], "normal", "middle"))
    p.append(text(cx + cw / 2, cy + 370, "（TTS 播报 L24 不在 1.0.0-Preview 范围）", 12, COLORS["muted"], "normal", "middle"))
    return "".join(p)


def proto_agent_edit(cx, cy, cw, ch, active="Agent"):
    p = []
    p.append(header_bar(cx, cy, cw, "编辑 Agent", "System Prompt / 模型 / 工具策略 · F1-F6", ["MVP"]))
    x, y = cx + 32, cy + 90
    p.append(input_box(x, y, 260, 36, "编程 Agent", "名称"))
    p.append(input_box(x + 280, y, 260, 36, "my-coder-model", "绑定模型 B3"))
    y += 56
    p.append(input_box(x, y, cw - 64, 100, "你是资深全栈工程师...", "System Prompt F2"))
    y += 120
    p.append(text(x, y, "工具权限 F6", 13, COLORS["text"], "600"))
    for perm, state in [("文件读写", "允许"), ("Shell 执行", "需确认"), ("网络访问", "拒绝")]:
        y += 28
        p.append(text(x, y, f"• {perm}", 13, COLORS["text"]))
        p.append(text(x + 200, y, state, 12, COLORS["accent"], "600"))
    p.append(button(x + cw - 180, cy + ch - 70, 100, 36, "保存", True))
    return "".join(p)


def proto_web_search(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "联网搜索", "实时信息检索 · D3/L25", ["MVP"]))
    p.append(chat_bubble(cx + 24, cy + 80, cw - 48, 50, "今天 AI Agent 领域有什么重要新闻？", True))
    p.append(rect(cx + 24, cy + 150, cw - 48, 200, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 40, cy + 178, "🔍 搜索结果", 14, COLORS["primary"], "600"))
    for i, r in enumerate(["OpenAI 发布新 Agent 框架...", "Multica 开源社区更新...", "本地 LLM 性能基准报告..."]):
        p.append(text(cx + 40, cy + 210 + i * 28, f"{i+1}. {r}", 13, COLORS["text"]))
    return "".join(p)


def proto_translate(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "边写边译", "实时翻译辅助 · D6", ["1.0.0-Preview"]))
    p.append(text(cx + 40, cy + 100, "中文输入", 12, COLORS["muted"], "600"))
    p.append(rect(cx + 40, cy + 110, (cw - 100) / 2, 200, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 56, cy + 150, "JARVIS 是一款本地 AI Agent 平台...", 13, COLORS["text"]))
    p.append(text(cx + 60 + (cw - 100) / 2, cy + 100, "English Output", 12, COLORS["muted"], "600"))
    p.append(rect(cx + 60 + (cw - 100) / 2, cy + 110, (cw - 100) / 2, 200, COLORS["primary_soft"], COLORS["primary"]))
    p.append(text(cx + 76 + (cw - 100) / 2, cy + 150, "JARVIS is a local AI Agent platform...", 13, COLORS["text"]))
    return "".join(p)


def proto_video_summary(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "视频内容摘要", "链接/上传 · D9", ["1.0.0-Preview"]))
    p.append(input_box(cx + 40, cy + 90, cw - 80, 40, "https://video.example.com/talk", "视频链接"))
    p.append(rect(cx + 40, cy + 150, (cw - 100) * 0.45, 180, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 56, cy + 240, "[视频预览]", 12, COLORS["muted"], "middle"))
    p.append(rect(cx + 60 + (cw - 100) * 0.45, cy + 150, (cw - 100) * 0.5, 180, COLORS["surface"], COLORS["border"]))
    p.append(text(cx + 76 + (cw - 100) * 0.45, cy + 180, "摘要：演讲涵盖 Agent 架构...", 13, COLORS["text"]))
    return "".join(p)


def proto_image_gen(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "文生图", "图像生成 · D10", ["1.0.0-Preview"]))
    p.append(input_box(cx + 40, cy + 90, cw - 80, 40, "A futuristic desktop AI assistant interface, clean UI"))
    p.append(rect(cx + 40, cy + 150, cw - 80, 260, COLORS["bg"], COLORS["border"], dash="6,4"))
    p.append(text(cx + cw / 2, cy + 280, "[生成图像预览区域]", 14, COLORS["muted"], "normal", "middle"))
    p.append(button(cx + cw - 180, cy + ch - 70, 120, 36, "下载图片", True))
    return "".join(p)


def proto_file_upload(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "文件上传分析", "PDF/Word/Excel/PPT · D12", ["1.0.0-Preview"]))
    p.append(rect(cx + 40, cy + 100, cw - 80, 100, COLORS["primary_soft"], COLORS["primary"], dash="8,4"))
    p.append(text(cx + cw / 2, cy + 155, "拖拽文件到此处 · L22", 14, COLORS["primary"], "600", "middle"))
    files = ["report-Q3.pdf", "budget.xlsx", "slides.pptx"]
    y = cy + 220
    for f in files:
        p.append(rect(cx + 40, y, cw - 80, 44, COLORS["bg"], COLORS["border"]))
        p.append(text(cx + 56, y + 28, f"📎 {f}", 13, COLORS["text"]))
        y += 52
    return "".join(p)


def proto_prompt_templates(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "Prompt 模板库", "可复用提示词 · D15", ["1.0.0-Preview"]))
    templates = [("需求分析", "分析以下需求文档..."), ("Code Review", "审查以下代码变更..."), ("邮件起草", "撰写正式邮件...")]
    y = cy + 80
    for name, preview in templates:
        p.append(rect(cx + 24, y, cw - 48, 72, COLORS["bg"], COLORS["border"]))
        p.append(text(cx + 40, y + 28, name, 14, COLORS["primary"], "600"))
        p.append(text(cx + 40, y + 50, preview, 12, COLORS["muted"]))
        p.append(text(cx + cw - 100, y + 36, "使用", 12, COLORS["primary"], "600"))
        y += 80
    return "".join(p)


def proto_export(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "对话导出", "Markdown / PDF · D14", ["MVP"]))
    p.append(text(cx + 40, cy + 100, "选择导出格式", 14, COLORS["text"], "600"))
    p.append(button(cx + 40, cy + 130, 140, 44, "Markdown", True))
    p.append(button(cx + 200, cy + 130, 140, 44, "PDF", False))
    p.append(rect(cx + 40, cy + 200, cw - 80, 200, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 56, cy + 230, "预览: # 需求分析对话\n\n**User**: 总结文档...", 13, COLORS["text"]))
    return "".join(p)


def proto_token_stats(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "Token 用量统计", "成本估算 · B9", ["1.0.0-Preview"]))
    stats = [("今日", "128,400 tokens", "$0.42"), ("本周", "892,100 tokens", "$2.87"), ("编程 Agent", "45%", ""), ("办公助手", "35%", "")]
    y = cy + 90
    for k, v, cost in stats:
        p.append(text(cx + 40, y, k, 14, COLORS["text"], "600"))
        p.append(text(cx + 200, y, v, 13, COLORS["muted"]))
        if cost:
            p.append(text(cx + 400, y, cost, 13, COLORS["accent"], "600"))
        y += 36
    p.append(rect(cx + 40, cy + 250, cw - 80, 120, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 56, cy + 290, "[用量趋势图表区域]", 13, COLORS["muted"]))
    return "".join(p)


def proto_shortcuts(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "快捷键配置", "App 内快捷键 · C5", ["1.0.0-Preview"]))
    shortcuts = [("发送消息", "Enter"), ("新建会话", "⌘N"), ("全局搜索", "⌘K"), ("切换 Agent", "⌘1-9")]
    y = cy + 80
    for action, key in shortcuts:
        p.append(rect(cx + 24, y, cw - 48, 44, COLORS["bg"], COLORS["border"]))
        p.append(text(cx + 40, y + 28, action, 13, COLORS["text"]))
        p.append(rect(cx + cw - 140, y + 8, 100, 28, COLORS["surface"], COLORS["border"]))
        p.append(text(cx + cw - 90, y + 28, key, 12, COLORS["primary"], "600", "middle"))
        y += 52
    p.append(text(cx + 40, cy + ch - 50, "注: 全局快捷键唤醒 A3 不在 1.0.0-Preview 范围", 12, COLORS["muted"]))
    return "".join(p)


def proto_permissions(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "工具权限 / 沙箱", "allow/deny 策略 · C6/J3/J6", ["1.0.0-Preview"]))
    rows = [("文件系统", "工作区内读写", "J3 沙箱"), ("Shell", "白名单命令", "J2 确认"), ("网络", "默认拒绝", "J6 分级"), ("MCP 工具", "首次需审批", "J7")]
    y = cy + 80
    for name, policy, note in rows:
        p.append(rect(cx + 24, y, cw - 48, 52, COLORS["bg"], COLORS["border"]))
        p.append(text(cx + 40, y + 22, name, 14, COLORS["text"], "600"))
        p.append(text(cx + 180, y + 22, policy, 13, COLORS["muted"]))
        p.append(text(cx + 400, y + 22, note, 12, COLORS["accent"]))
        y += 60
    return "".join(p)


def proto_workspace(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "工作区绑定", "项目目录 · C7/L10", ["MVP"]))
    p.append(input_box(cx + 40, cy + 90, cw - 80, 40, "/Users/me/projects/jarvis", "工作区路径"))
    p.append(text(cx + 40, cy + 160, "上下文文件 L10", 14, COLORS["text"], "600"))
    files = ["JARVIS.md", "AGENTS.md", ".jarvis/agents/coder.md"]
    for i, f in enumerate(files):
        p.append(text(cx + 56, cy + 190 + i * 24, f"✓ {f} 已生成", 12, COLORS["success"]))
    return "".join(p)


def proto_debug_log(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "日志 / 调试面板", "开发诊断 · C11", ["MVP"]))
    logs = ["[INFO] Daemon started", "[DEBUG] Provider request 234ms", "[WARN] MCP browser awaiting approval", "[ERROR] Task #4498 shell denied"]
    p.append(rect(cx + 24, cy + 72, cw - 48, ch - 120, "#141414", COLORS["border_subtle"]))
    y = cy + 100
    colors = [COLORS["muted"], COLORS["muted"], COLORS["warn"], COLORS["danger"]]
    for line, color in zip(logs, colors):
        p.append(text(cx + 40, y, line, 12, color))
        y += 24
    return "".join(p)


def proto_config_io(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "配置导入 / 导出", "JSON/YAML · C12", ["1.0.0-Preview"]))
    p.append(button(cx + 40, cy + 100, 160, 44, "导出配置", True))
    p.append(button(cx + 220, cy + 100, 160, 44, "导入配置", False))
    p.append(rect(cx + 40, cy + 170, cw - 80, 240, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 56, cy + 200, "{", 13, COLORS["text"]))
    p.append(text(cx + 72, cy + 224, '"providers": [...],', 12, COLORS["muted"]))
    p.append(text(cx + 72, cy + 248, '"agents": [...],', 12, COLORS["muted"]))
    p.append(text(cx + 72, cy + 272, '"mcpServers": [...]', 12, COLORS["muted"]))
    p.append(text(cx + 56, cy + 296, "}", 13, COLORS["text"]))
    return "".join(p)


def proto_daemon(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "Daemon 管理", "状态/重启/资源 · L7-L9", ["1.0.0-Preview"]))
    metrics = [("Daemon", "运行中 ●", "重启"), ("CPU", "12%", ""), ("内存", "486 MB", ""), ("并发 Task", "2 / 6", ""), ("jarvis-agent", "1.0.0-Preview.0", "—health")]
    y = cy + 80
    for k, v, action in metrics:
        p.append(rect(cx + 24, y, cw - 48, 48, COLORS["bg"], COLORS["border"]))
        p.append(text(cx + 40, y + 30, k, 14, COLORS["text"], "600"))
        p.append(text(cx + 200, y + 30, v, 13, COLORS["muted"]))
        if action:
            p.append(text(cx + cw - 100, y + 30, action, 12, COLORS["primary"], "600"))
        y += 56
    return "".join(p)


def proto_mcp_approval(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "MCP 权限审批", "首次调用确认 · J7/G8", ["1.0.0-Preview"]))
    p.append(rect(cx + cw / 2 - 230, cy + 160, 460, 220, COLORS["surface"], COLORS["primary"], rx=12))
    p.append(text(cx + cw / 2, cy + 200, "MCP 工具请求授权", 18, COLORS["primary"], "700", "middle"))
    p.append(text(cx + cw / 2, cy + 240, "browser.navigate → https://example.com", 13, COLORS["text"], "normal", "middle"))
    p.append(button(cx + cw / 2 - 140, cy + 320, 110, 36, "拒绝", False))
    p.append(button(cx + cw / 2 + 20, cy + 320, 110, 36, "允许一次", True))
    p.append(button(cx + cw / 2 + 150, cy + 320, 110, 36, "始终允许", True))
    return "".join(p)


def proto_agent_templates(cx, cy, cw, ch, active="Agent"):
    p = []
    p.append(header_bar(cx, cy, cw, "Agent 模板库", "预设模板 · L30", ["1.0.0-Preview"]))
    templates = [("办公助手", "文档/写作/搜索"), ("编程 Agent", "代码/Shell/Git"), ("审查 Agent", "Review/测试"), ("Research", "调研/总结")]
    x, y = cx + 24, cy + 80
    for i, (name, desc) in enumerate(templates):
        col, row = i % 2, i // 2
        p.append(rect(x + col * ((cw - 60) / 2), y + row * 110, (cw - 72) / 2, 96, COLORS["bg"], COLORS["border"]))
        p.append(text(x + 40 + col * ((cw - 60) / 2), y + 30 + row * 110, name, 15, COLORS["primary"], "600"))
        p.append(text(x + 40 + col * ((cw - 60) / 2), y + 54 + row * 110, desc, 12, COLORS["muted"]))
        p.append(text(x + 40 + col * ((cw - 60) / 2), y + 76 + row * 110, "使用模板 →", 12, COLORS["accent"]))
    return "".join(p)


def proto_backup(cx, cy, cw, ch, active="设置"):
    p = []
    p.append(header_bar(cx, cy, cw, "数据备份与恢复", "SQLite 备份/迁移 · L18-L20", ["1.0.0-Preview"]))
    p.append(text(cx + 40, cy + 90, "自动备份: 每日 03:00 · 退出时", 13, COLORS["text"]))
    backups = [("jarvis-2026-08-02.db", "12.4 MB", "恢复"), ("jarvis-2026-08-01.db", "11.8 MB", "恢复")]
    y = cy + 130
    for name, size, action in backups:
        p.append(rect(cx + 40, y, cw - 80, 44, COLORS["bg"], COLORS["border"]))
        p.append(text(cx + 56, y + 28, name, 13, COLORS["text"]))
        p.append(text(cx + 320, y + 28, size, 12, COLORS["muted"]))
        p.append(text(cx + 420, y + 28, action, 12, COLORS["primary"], "600"))
        y += 52
    p.append(button(cx + 40, cy + ch - 70, 160, 36, "敏感数据擦除 L20", False))
    return "".join(p)


def proto_task_control(cx, cy, cw, ch, active="Task"):
    p = []
    p.append(header_bar(cx, cy, cw, "Task 控制", "取消/暂停/重试 · L4-L6", ["MVP"]))
    p.append(rect(cx + 24, cy + 72, cw - 48, 100, COLORS["warn"] + "33", COLORS["warn"]))
    p.append(text(cx + 40, cy + 100, "Task #4521 — Running", 16, COLORS["text"], "600"))
    p.append(text(cx + 40, cy + 128, "正在执行: npm test", 13, COLORS["muted"]))
    p.append(button(cx + 40, cy + 190, 80, 36, "取消", False))
    p.append(button(cx + 130, cy + 190, 80, 36, "暂停", False))
    p.append(rect(cx + 24, cy + 250, cw - 48, 80, COLORS["danger_bg"], COLORS["danger"]))
    p.append(text(cx + 40, cy + 280, "Task #4498 — Failed: Shell 权限拒绝", 14, COLORS["danger"], "600"))
    p.append(button(cx + 40, cy + 350, 120, 36, "一键重试 L6", True))
    return "".join(p)


def proto_at_reference(cx, cy, cw, ch, active="代码"):
    p = []
    p.append(header_bar(cx, cy, cw, "@ 引用", "文件/文件夹/符号 · E6", ["1.0.0-Preview"]))
    p.append(rect(cx + 24, cy + 64, cw - 48, 48, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 40, cy + 94, "重构 @src/utils/auth.ts 中的 validate 函数", 14, COLORS["text"]))
    p.append(rect(cx + 40, cy + 130, 280, 180, COLORS["surface"], COLORS["primary"]))
    p.append(text(cx + 56, cy + 155, "@ 引用菜单", 13, COLORS["primary"], "600"))
    for i, item in enumerate(["@src/utils/auth.ts", "@src/api/", "@validateToken", "@JARVIS.md"]):
        p.append(text(cx + 56, cy + 180 + i * 26, item, 13, COLORS["text"]))
    return "".join(p)


def proto_runtime_indicator(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "运行模式指示", "本地 vs Runtime · L39", ["1.0.0-Preview"]))
    p.append(rect(cx + 40, cy + 90, (cw - 100) / 2, 120, COLORS["primary_soft"], COLORS["primary"]))
    p.append(text(cx + 60, cy + 130, "本地模式", 18, COLORS["primary"], "700"))
    p.append(text(cx + 60, cy + 160, "默认 · 完全离线可用 A8", 13, COLORS["muted"]))
    p.append(rect(cx + 60 + (cw - 100) / 2, cy + 90, (cw - 100) / 2, 120, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 80 + (cw - 100) / 2, cy + 130, "Multica Runtime", 18, COLORS["text"], "700"))
    p.append(text(cx + 80 + (cw - 100) / 2, cy + 160, "已注册 · 心跳正常 H1.10", 13, COLORS["success"]))
    p.append(text(cx + 40, cy + 240, "注: Multica Client H2 不在 1.0.0-Preview 范围", 12, COLORS["muted"]))
    return "".join(p)


def proto_image_understand(cx, cy, cw, ch, active="对话"):
    p = []
    p.append(header_bar(cx, cy, cw, "多模态图片理解", "截图/上传识图 · L23", ["1.0.0-Preview"]))
    p.append(rect(cx + 40, cy + 90, 280, 200, COLORS["bg"], COLORS["border"]))
    p.append(text(cx + 180, cy + 190, "[上传图片/截图]", 12, COLORS["muted"], "middle"))
    p.append(chat_bubble(cx + 340, cy + 90, cw - 380, 200, "这是一张产品架构图，包含 Electron 壳、Go Daemon 和 React UI 三层结构..."))
    return "".join(p)


PROTOTYPES = [
    ("01-主界面-主聊天窗口", "K1/D1", "MVP", proto_main_chat, "对话"),
    ("02-首次引导-Provider配置", "L1/B", "MVP", proto_onboarding_provider, "设置"),
    ("03-首次引导-创建Agent", "L1/F1", "MVP", proto_onboarding_agent, "Agent"),
    ("04-首次引导-环境诊断", "L2/L3", "MVP", proto_onboarding_env, "设置"),
    ("05-Agent管理-列表", "C2/F1", "MVP", proto_agent_list, "Agent"),
    ("06-Provider管理", "C1/B", "MVP", proto_provider, "设置"),
    ("07-轻量代码面板-Diff", "K3/E9", "1.0.0-Preview", proto_code_panel, "代码"),
    ("08-Task看板", "K4/L4", "1.0.0-Preview", proto_task_board, "Task"),
    ("09-Squad小队协作", "F8/F9", "1.0.0-Preview", proto_squad, "Agent"),
    ("10-设置页", "C1-C12", "MVP/1.0.0-Preview", proto_settings, "设置"),
    ("11-Skills管理", "G1/C4", "MVP/1.0.0-Preview", proto_skills, "Skills"),
    ("12-MCP管理", "G4/C3", "MVP/1.0.0-Preview", proto_mcp, "设置"),
    ("13-Multica-Runtime状态", "H1/L35", "1.0.0-Preview", proto_multica_runtime, "设置"),
    ("14-AI写作助手", "D5", "1.0.0-Preview", proto_office_writing, "对话"),
    ("15-PDF伴读", "D7", "1.0.0-Preview", proto_pdf_reader, "对话"),
    ("16-内置浏览器-网页总结", "I8/D8", "1.0.0-Preview", proto_webview, "对话"),
    ("17-窗口吸附模式", "A4", "MVP", proto_dock_mode, "对话"),
    ("18-系统托盘菜单", "A2/L7", "MVP", "1.0.0-Preview", None),
    ("19-敏感操作确认", "J2/F15", "MVP/1.0.0-Preview", proto_approval, "对话"),
    ("20-Canvas可视化", "K6", "1.0.0-Preview", proto_canvas, "对话"),
    ("21-全局搜索", "L21", "1.0.0-Preview", proto_search, "对话"),
    ("22-分屏-聊天加文件", "K7", "1.0.0-Preview", proto_split_view, "代码"),
    ("23-Plan模式", "E10", "1.0.0-Preview", proto_plan_mode, "代码"),
    ("24-Task执行日志", "K5/L5", "1.0.0-Preview", proto_task_log, "Task"),
    ("25-划词菜单", "D4", "1.0.0-Preview", proto_selection_menu, "对话"),
    ("26-语音输入", "D11", "1.0.0-Preview", proto_voice, "对话"),
    ("27-深色主题-主聊天", "A10", "MVP", proto_main_chat, "对话"),
    ("50-浅色主题-主聊天", "A10", "MVP", proto_main_chat, "对话"),
    ("28-编辑Agent详情", "F1-F6", "MVP", proto_agent_edit, "Agent"),
    ("29-联网搜索", "D3/L25", "MVP", proto_web_search, "对话"),
    ("30-边写边译", "D6", "1.0.0-Preview", proto_translate, "对话"),
    ("31-视频内容摘要", "D9", "1.0.0-Preview", proto_video_summary, "对话"),
    ("32-文生图", "D10", "1.0.0-Preview", proto_image_gen, "对话"),
    ("33-文件上传分析", "D12/L22", "1.0.0-Preview", proto_file_upload, "对话"),
    ("34-Prompt模板库", "D15", "1.0.0-Preview", proto_prompt_templates, "对话"),
    ("35-对话导出", "D14", "MVP", proto_export, "对话"),
    ("36-Token用量统计", "B9", "1.0.0-Preview", proto_token_stats, "设置"),
    ("37-快捷键配置", "C5", "1.0.0-Preview", proto_shortcuts, "设置"),
    ("38-权限沙箱配置", "C6/J3/J6", "1.0.0-Preview", proto_permissions, "设置"),
    ("39-工作区绑定", "C7/L10", "MVP", proto_workspace, "设置"),
    ("40-日志调试面板", "C11", "MVP", proto_debug_log, "设置"),
    ("41-配置导入导出", "C12", "1.0.0-Preview", proto_config_io, "设置"),
    ("42-Daemon管理", "L7-L9", "1.0.0-Preview", proto_daemon, "设置"),
    ("43-MCP权限审批", "J7/G8", "1.0.0-Preview", proto_mcp_approval, "对话"),
    ("44-Agent模板库", "L30", "1.0.0-Preview", proto_agent_templates, "Agent"),
    ("45-数据备份恢复", "L18-L20", "1.0.0-Preview", proto_backup, "设置"),
    ("46-Task取消重试", "L4-L6", "MVP", proto_task_control, "Task"),
    ("47-At引用文件", "E6", "1.0.0-Preview", proto_at_reference, "代码"),
    ("48-运行模式指示", "L39/A8", "1.0.0-Preview", proto_runtime_indicator, "对话"),
    ("49-多模态图片理解", "L23", "1.0.0-Preview", proto_image_understand, "对话"),
]

# fix entry 18 typo
PROTOTYPES[17] = ("18-系统托盘菜单", "A2/L7", "MVP/1.0.0-Preview", proto_tray, "对话")


def render_svg(filename, title, module, tier, body_fn, active, theme="dark"):
    set_theme(theme)
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        SVG_DEFS,
    ]
    chrome, wx, wy, ww, wh, content_top, content_h = window_chrome(f"JARVIS — {title}", theme_active=theme)
    parts.append(chrome)
    nav, nav_w = left_nav(wx, content_top, content_h, active)
    parts.append(nav)
    cx, cy, cw, ch = wx + nav_w, content_top, ww - nav_w, content_h
    parts.append(content_area(cx, cy, cw, ch))
    parts.append(body_fn(cx, cy, cw, ch, active))
    parts.append(text(wx + SPACE["lg"], wy + wh - 8, f"模块 {module}  ·  {tier}  ·  A10 主题", TYPE["caption2"], COLORS["muted_dim"]))
    parts.append("</svg>")
    path = os.path.join(OUT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    return filename


def generate_index(manifest):
    groups = [
        ("平台基础", ["01-", "17-", "18-", "27-", "48-", "50-"]),
        ("首次引导", ["02-", "03-", "04-"]),
        ("对话与办公", ["01-", "14-", "15-", "16-", "25-", "26-", "29-", "30-", "31-", "32-", "33-", "34-", "35-", "49-"]),
        ("Agent 系统", ["05-", "09-", "28-", "44-"]),
        ("编程 Agent", ["07-", "22-", "23-", "47-"]),
        ("Task 管理", ["08-", "24-", "46-"]),
        ("模型与 Provider", ["06-", "36-"]),
        ("设置与配置", ["10-", "37-", "38-", "39-", "40-", "41-", "45-"]),
        ("Skills / MCP", ["11-", "12-", "43-"]),
        ("Multica / Daemon", ["13-", "42-"]),
        ("安全与审批", ["19-", "43-"]),
        ("高级视图", ["20-", "21-"]),
    ]

    def classify(item):
        pid = item["id"]
        for name, prefixes in groups:
            if any(pid.startswith(p) for p in prefixes):
                return name
        return "其他"

    grouped = {}
    seen = set()
    for item in manifest:
        g = classify(item)
        grouped.setdefault(g, [])
        if item["id"] not in seen:
            grouped[g].append(item)
            seen.add(item["id"])

    order = [g for g, _ in groups] + [g for g in grouped if g not in [x for x, _ in groups]]
    nav_html = ""
    for g in order:
        if g not in grouped:
            continue
        nav_html += f'<li class="group"><div class="group-title">{esc(g)}</div><ul>'
        for item in grouped[g]:
            nav_html += (
                f'<li><a href="#" data-id="{esc(item["id"])}" data-file="{esc(item["file"])}" '
                f'data-file-light="{esc(item.get("file_light", item["file"]))}" '
                f'data-module="{esc(item["module"])}" data-tier="{esc(item["tier"])}">'
                f'{esc(item["title"])}</a></li>'
            )
        nav_html += "</ul></li>"

    data_json = json.dumps(manifest, ensure_ascii=False)
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JARVIS 产品原型 1.0.0-Preview</title>
  <style>
    :root {{
      --bg: #f5f5f7; --surface: #ffffff; --surface-raised: #ececec;
      --border: #d1d1d6; --border-subtle: #e5e5ea;
      --text: #1d1d1f; --text-bright: #000000; --muted: #8e8e93; --muted-dim: #aeaeb2;
      --primary: #007aff; --primary-bright: #0062cc; --primary-muted: #e8f2ff;
      --sidebar-w: 280px;
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: var(--font); background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; font-size: 13px; line-height: 1.47; -webkit-font-smoothing: antialiased; }}
    .app {{ display: flex; height: 100vh; }}
    .sidebar {{
      width: var(--sidebar-w); background: var(--surface-raised); border-right: 0.5px solid var(--border);
      display: flex; flex-direction: column; flex-shrink: 0;
    }}
    .sidebar-header {{
      padding: 16px 18px; border-bottom: 0.5px solid var(--border);
      background: var(--surface-raised);
    }}
    .sidebar-header h1 {{ font-size: 17px; font-weight: 700; color: var(--text-bright); letter-spacing: -0.02em; }}
    .sidebar-header p {{ font-size: 11px; color: var(--muted); margin-top: 4px; }}
    .nav {{ flex: 1; overflow-y: auto; padding: 8px 0; list-style: none; }}
    .group {{ margin-bottom: 4px; }}
    .group-title {{
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--muted); padding: 10px 18px 4px; font-weight: 600;
    }}
    .group ul {{ list-style: none; }}
    .group a {{
      display: block; padding: 6px 18px 6px 22px; font-size: 13px;
      color: var(--text); text-decoration: none; border-radius: 8px; margin: 1px 8px;
      line-height: 1.4;
    }}
    .group a:hover {{ background: rgba(0,0,0,0.04); }}
    .group a.active {{
      color: var(--text-bright); background: #dcebff; font-weight: 600;
    }}
    .main {{ flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }}
    .toolbar {{
      padding: 10px 18px; background: rgba(255,255,255,0.72); backdrop-filter: blur(20px);
      border-bottom: 0.5px solid var(--border);
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 44px;
    }}
    .toolbar h2 {{ font-size: 15px; font-weight: 600; color: var(--text-bright); letter-spacing: -0.01em; }}
    .badge {{
      font-size: 11px; padding: 2px 10px; border-radius: 11px; font-weight: 600;
      background: var(--primary-muted); color: #0066cc;
    }}
    .badge-v1 {{ background: #e8f8ec; color: #248a3d; }}
    .viewer {{
      flex: 1; overflow: auto; padding: 20px; display: flex; align-items: flex-start; justify-content: center;
      background: #d6d6da;
    }}
    .viewer img {{
      max-width: 100%; height: auto; border-radius: 10px;
      box-shadow: 0 10px 36px rgba(0,0,0,0.18); border: 0.5px solid var(--border);
    }}
    .empty {{ color: var(--muted); padding: 3rem; text-align: center; font-size: 13px; }}
    .counter {{ font-size: 12px; color: var(--muted-dim); }}
    .theme-switcher {{
      display: inline-flex; margin-left: auto; background: #e5e5ea;
      border-radius: 7px; overflow: hidden; height: 28px; padding: 2px;
    }}
    .theme-switcher button {{
      border: none; background: transparent; color: var(--muted); font-size: 11px;
      padding: 0 14px; cursor: pointer; font-family: var(--font); height: 24px; border-radius: 5px;
    }}
    .theme-switcher button.active {{
      background: #ffffff; color: var(--text-bright); font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }}
    .theme-switcher button:hover:not(.active) {{ color: var(--text); }}
    @media (max-width: 900px) {{
      .app {{ flex-direction: column; }}
      .sidebar {{ width: 100%; max-height: 40vh; }}
    }}
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h1>JARVIS 产品原型</h1>
        <p>1.0.0-Preview · 共 {len(manifest)} 个界面 · 2026-08-02</p>
      </div>
      <ul class="nav" id="nav">{nav_html}</ul>
    </aside>
    <main class="main">
      <div class="toolbar">
        <h2 id="title">选择左侧原型图</h2>
        <span class="badge" id="module"></span>
        <span class="badge badge-v1" id="tier"></span>
        <div class="theme-switcher" id="theme-switcher" title="A10 深/浅色主题预览">
          <button type="button" data-theme="light" id="btn-light" class="active">浅色</button>
          <button type="button" data-theme="dark" id="btn-dark">深色</button>
        </div>
        <span class="counter" id="counter"></span>
      </div>
      <div class="viewer" id="viewer">
        <p class="empty">← 从左侧目录选择要查看的产品原型图</p>
      </div>
    </main>
  </div>
  <script>
    const MANIFEST = {data_json};
    const links = document.querySelectorAll('.group a');
    const viewer = document.getElementById('viewer');
    const titleEl = document.getElementById('title');
    const moduleEl = document.getElementById('module');
    const tierEl = document.getElementById('tier');
    const counterEl = document.getElementById('counter');
    const btnLight = document.getElementById('btn-light');
    const btnDark = document.getElementById('btn-dark');
    let idx = 0;
    let viewTheme = 'light';
    let currentLink = null;

    function renderImage() {{
      if (!currentLink) return;
      const file = viewTheme === 'light' ? currentLink.dataset.fileLight : currentLink.dataset.file;
      viewer.innerHTML = '<img src="' + file + '" alt="' + currentLink.textContent.trim() + '">';
    }}

    function setViewTheme(theme) {{
      viewTheme = theme;
      btnLight.classList.toggle('active', theme === 'light');
      btnDark.classList.toggle('active', theme === 'dark');
      renderImage();
    }}

    function show(link) {{
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      currentLink = link;
      titleEl.textContent = link.textContent.trim();
      moduleEl.textContent = '模块 ' + link.dataset.module;
      tierEl.textContent = link.dataset.tier;
      idx = Array.from(links).indexOf(link);
      counterEl.textContent = (idx + 1) + ' / ' + links.length;
      renderImage();
    }}

    links.forEach(link => link.addEventListener('click', e => {{ e.preventDefault(); show(link); }}));
    btnLight.addEventListener('click', () => setViewTheme('light'));
    btnDark.addEventListener('click', () => setViewTheme('dark'));

    document.addEventListener('keydown', e => {{
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {{
        e.preventDefault();
        const next = e.key === 'ArrowDown' ? Math.min(idx + 1, links.length - 1) : Math.max(idx - 1, 0);
        show(links[next]);
      }}
    }});

    if (links.length) show(links[0]);
  </script>
</body>
</html>"""
    index_path = os.path.join(os.path.dirname(__file__), "index.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(html)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = []
    for item in PROTOTYPES:
        name, module, tier, fn, active = item
        title = name.split("-", 1)[-1]
        # Explicit theme from prototype name, else generate both variants
        if "浅色" in name:
            themes = [("light", "")]
        elif "深色" in name:
            themes = [("dark", "")]
        else:
            themes = [("dark", ""), ("light", "-浅色")]
        base_id = name
        entry = {"id": base_id, "title": title, "module": module, "tier": tier, "file": "", "file_light": ""}
        for theme, suffix in themes:
            svg_name = f"{name}{suffix}.svg"
            render_svg(svg_name, title, module, tier, fn, active, theme=theme)
            if theme == "dark":
                entry["file"] = f"images/{svg_name}"
            else:
                entry["file_light"] = f"images/{svg_name}"
        if not entry["file_light"]:
            entry["file_light"] = entry["file"]
        if not entry["file"]:
            entry["file"] = entry["file_light"]
        manifest.append(entry)
    base = os.path.dirname(__file__)
    with open(os.path.join(base, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    generate_index(manifest)
    print(f"Generated {len(manifest)} prototype sets ({len(manifest) * 2 - 2} SVG files) in {OUT_DIR}")
    print(f"Index: {os.path.join(base, 'index.html')}")


if __name__ == "__main__":
    main()
