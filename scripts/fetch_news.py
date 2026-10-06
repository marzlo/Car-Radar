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

    # 每個議題用自己的關鍵字去 Google 新聞搜尋（近 7 天），找到的新聞直接掛到該議題
    from urllib.parse import quote
    for iss in issues:
        kws = [k for k in iss["keywords"] if k.strip()][:8]
        if not kws:
            continue
        q = " OR ".join(f'"{k}"' if " " in k else k for k in kws) + " when:7d"
        for lang, loc in (("zh", "hl=zh-TW&gl=TW&ceid=TW:zh-Hant"), ("en", "hl=en-US&gl=US&ceid=US:en")):
            feed = {"name": f"議題搜尋：{iss['title'][:12]}", "lang": lang,
                    "url": f"https://news.google.com/rss/search?q={quote(q)}&{loc}"}
            try:
                got = parse_feed(feed, 15)
                for it in got:
                    tgt = fresh.setdefault(it["id"], it)
                    tgt.setdefault("forced_issues", [])
                    if iss["id"] not in tgt["forced_issues"]:
                        tgt["forced_issues"].append(iss["id"])
                log(f"議題「{iss['title'][:16]}」({lang}): {len(got)} 則")
            except Exception as e:
                log(f"議題「{iss['title'][:16]}」({lang}) 搜尋失敗：{e}")

    new_ids = [i for i in fresh if i not in old]
    for i, it in fresh.items():  # 舊新聞若這次被議題搜尋找到，也補上議題連結
        if i in old and it.get("forced_issues"):
            old[i]["forced_issues"] = sorted(set(old[i].get("forced_issues", [])) | set(it["forced_issues"]))
    merged = {**fresh, **old}  # 已存在的保留（含 AI 翻譯的中文標題）
    cutoff = now_tpe() - dt.timedelta(days=cfg["news"].get("keep_days", 7))
    items = []
    for it in merged.values():
        if dt.datetime.fromisoformat(it["time"]) < cutoff:
            continue
        text = it["title"] + " " + it.get("summary", "")
        it["categories"] = [c for c, words in cats.items() if match(text, words)] or ["其他"]
        ids = {i["id"] for i in issues}
        it["issues"] = [i["id"] for i in issues if i["keywords"] and match(text, i["keywords"])]
        it["issues"] += [x for x in it.get("forced_issues", []) if x in ids and x not in it["issues"]]
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
