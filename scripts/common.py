"""共用工具：讀設定、讀寫 JSON、台北時間。"""
import json, os, re, sys, datetime as dt
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TPE = dt.timezone(dt.timedelta(hours=8))


def now_tpe():
    return dt.datetime.now(TPE)


def today():
    return now_tpe().strftime("%Y-%m-%d")


def settings():
    with open(ROOT / "config" / "settings.yml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_json(path, default):
    p = Path(path)
    if not p.exists():
        return default
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # 壞掉的檔案不要讓整個流程掛掉
        log(f"讀取 {p} 失敗：{e}")
        return default


def save_json(path, obj):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    tmp.replace(p)


def log(msg):
    print(f"[{now_tpe():%H:%M:%S}] {msg}", file=sys.stderr, flush=True)


def quarter_of(d):
    """date/datetime/'YYYY-MM-DD' → '2026Q2'。"""
    if isinstance(d, str):
        d = dt.date.fromisoformat(d[:10])
    return f"{d.year}Q{(d.month - 1) // 3 + 1}"


def extract_json(text):
    """從模型回覆裡取出第一個完整 JSON 物件。"""
    text = re.sub(r"```(?:json)?", "", text)
    start = text.find("{")
    if start < 0:
        raise ValueError("回覆中沒有 JSON")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("JSON 不完整")


def claude_client():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        log("沒有設定 ANTHROPIC_API_KEY，略過 AI 步驟")
        return None
    import anthropic
    return anthropic.Anthropic(api_key=key)


def claude_text(resp):
    return "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")


def ai_model(cfg):
    return os.environ.get("CLAUDE_MODEL") or cfg.get("ai", {}).get("model", "claude-sonnet-5-5")
