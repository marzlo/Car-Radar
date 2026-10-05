"""抓 RSS 新聞、分類、掛到議題，保留最近幾天。"""
import hashlib, html, re, calendar, datetime as dt
from common import DATA, settings, load_json, save_json, log, now_tpe, TPE, today
from build_issues import load_issues

LATEST = DATA / "news" / "latest.json"


def clean(s, n=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return (s[: n - 1] + "…") if n and len(s) > n else s


def match(text, words):
    low = text.lower()
    return any(str(w).lower() in low for w in words)


def parse_feed(feed, limit):
    import feedparser
    f = feedparser.parse(feed["url"], agent="Mozilla/5.0 (CarRadar; +https://github.com)")
    if f.bozo and not f.entries:
        raise RuntimeError(str(f.bozo_exception))
    items = []
    for e in f.entries[:limit]:
        title, source = clean(e.get("title")), feed["name"]
        if "news.google.com" in feed["url"]:
            # Google 新聞標題格式：「標題 - 媒體名」
            src = (e.get("source") or {}).get("title")
            if src and title.endswith(" - " + src):
                title = title[: -len(src) - 3]
            source = src or source
            summary = ""
        else:
            summary = clean(e.get("summary"), 160)
        t = e.get("published_parsed") or e.get("updated_parsed")
        when = dt.datetime.fromtimestamp(calendar.timegm(t), TPE) if t else now_tpe()
        link = e.get("link", "")
        key = re.sub(r"\W+", "", title.lower())[:80]
        items.append({"id": hashlib.sha1(key.encode()).hexdigest()[:10], "title": title, "summary": summary,
                      "link": link, "source": source, "lang": feed.get("lang", ""),
                      "time": when.isoformat(timespec="minutes")})
    return items


def main():
    cfg = settings()
    cats, issues = cfg["categories"], load_issues()
    old = {n["id"]: n for n in load_json(LATEST, {}).get("items", [])}
    fresh, ok = {}, 0
    for feed in cfg["feeds"]:
        try:
            got = parse_feed(feed, cfg["news"].get("max_per_feed", 25))
            ok += 1
            for it in got:
                fresh.setdefault(it["id"], it)
            log(f"{feed['name']}: {len(got)} 則")
        except Exception as e:
            log(f"{feed['name']} 失敗：{e}")

    new_ids = [i for i in fresh if i not in old]
    merged = {**fresh, **old}  # 已存在的保留（含 AI 翻譯的中文標題）
    cutoff = now_tpe() - dt.timedelta(days=cfg["news"].get("keep_days", 7))
    items = []
    for it in merged.values():
        if dt.datetime.fromisoformat(it["time"]) < cutoff:
            continue
        text = it["title"] + " " + it.get("summary", "")
        it["categories"] = [c for c, words in cats.items() if match(text, words)] or ["其他"]
        it["issues"] = [i["id"] for i in issues if i["keywords"] and match(text, i["keywords"])]
        items.append(it)
    items.sort(key=lambda x: x["time"], reverse=True)
    items = items[:400]
    save_json(LATEST, {"updated": now_tpe().isoformat(timespec="minutes"), "feeds_ok": ok,
                       "feeds_total": len(cfg["feeds"]), "items": items})
    # 每日存檔：當天新進的新聞
    day = DATA / "news" / "archive" / f"{today()}.json"
    prev = load_json(day, {"items": []})["items"]
    ids = {x["id"] for x in prev}
    add = [merged[i] for i in new_ids if i not in ids and i in merged]
    save_json(day, {"date": today(), "items": prev + add})
    log(f"新聞共 {len(items)} 則，今日新增 {len(new_ids)} 則")


if __name__ == "__main__":
    main()
