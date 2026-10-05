"""把 issues/*.md 轉成 data/issues.json 給網頁讀。"""
import re
from common import ROOT, DATA, save_json, load_json, log
import yaml

STATUS = {"keep": "觀點維持", "revise": "修正中", "flip": "已推翻", "watch": "觀察中"}


def parse(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        raise ValueError("缺少 --- 設定區塊")
    meta = yaml.safe_load(m.group(1)) or {}
    entries = []
    for block in re.split(r"(?m)^## ", m.group(2))[1:]:
        head, _, body = block.partition("\n")
        date, _, label = head.partition("|")
        entries.append({"date": str(date).strip(), "label": label.strip(), "text": body.strip()})
    st = str(meta.get("status", "watch"))
    return {
        "id": path.stem,
        "title": meta.get("title", path.stem),
        "status": st, "status_label": STATUS.get(st, st),
        "since": str(meta.get("since", "")),
        "keywords": [str(k) for k in (meta.get("keywords") or [])],
        "metric": str(meta.get("metric", "") or ""),
        "then": str(meta.get("then", "") or ""),
        "now": str(meta.get("now", "") or ""),
        "entries": entries,
    }


def load_issues():
    out = []
    for p in sorted((ROOT / "issues").glob("*.md")):
        if p.name.lower() == "readme.md":
            continue
        try:
            out.append(parse(p))
        except Exception as e:
            log(f"議題 {p.name} 格式有誤，略過：{e}")
    return out


def main():
    issues = load_issues()
    save_json(DATA / "issues.json", {"issues": issues})
    log(f"議題 {len(issues)} 個")


if __name__ == "__main__":
    main()
