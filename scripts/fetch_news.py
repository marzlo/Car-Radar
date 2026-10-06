"""抓 RSS 新聞、分類、掛到議題，保留最近幾天。"""
import hashlib, html, re, calendar, datetime as dt
from common import DATA, settings, load_json, save_json, log, now_tpe, TPE, today
from build_issues import load_issues

LATEST = DATA / "news" / "latest.json"


def clean(s, n=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return (s[: n - 1] + "…") if n and len(s) > n else s


_ASCII = re.compile(r"^[\x00-\x7f]+$")
_cache = {}


def _pattern(w):
    """英文字用「整個單字」比對（避免 EV 對到 every、car 對到 card），中文字直接比對。"""
    w = str(w).strip()
    if w not in _cache:
        _cache[w] = re.compile(r"(?<![A-Za-z0-9])" + re.escape(w) + r"(?![A-Za-z0-9\-])", re.I) if _ASCII.match(w) else None
    return _cache[w]


def match(text, words):
    low = text.lower()
    for w in words:
        pat = _pattern(w)
        if (pat.search(text) if pat else str(w).lower() in low):
            return True
    return False


def context_words(cfg):
    """判斷「這則新聞跟汽車有關」用的字：設定檔 relevance + 各車企名稱。"""
    words = list(cfg.get("relevance", []))
    for c in ("車企動向", "Stellantis"):
        words += [w for w in cfg["categories"].get(c, []) if str(w).lower() not in ("launch", "發表", "上市")]
    words += [s["name"] for s in cfg.get("stocks", [])]
    return words


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
    ctx = context_words(cfg)
    # 議題關鍵字裡太廣泛的字（car、EV、汽車…）會讓每則新聞都對上，比對時忽略
    generic = {str(w).lower() for w in cfg.get("relevance", [])}
    for iss in issues:
        iss["keywords"] = [k for k in iss["keywords"] if k.strip() and k.strip().lower() not in generic]
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
    found = {}  # 這次議題搜尋找到的：新聞 id → 議題 id
    for iss in issues:
        kws = [k for k in iss["keywords"] if k.strip()][:8]
        if not kws:
            continue
        base = "(" + " OR ".join(f'"{k}"' if " " in k else k for k in kws) + ")"
        for lang, loc, must in (("zh", "hl=zh-TW&gl=TW&ceid=TW:zh-Hant", "(汽車 OR 電動車 OR 車廠 OR 車企)"),
                                ("en", "hl=en-US&gl=US&ceid=US:en", '(automaker OR carmaker OR "electric vehicle" OR automotive)')):
            q = f"{base} {must} when:7d"
            feed = {"name": f"議題搜尋：{iss['title'][:12]}", "lang": lang,
                    "url": f"https://news.google.com/rss/search?q={quote(q)}&{loc}"}
            try:
                got = [it for it in parse_feed(feed, 15) if match(it["title"] + " " + it.get("summary", ""), ctx)]
                for it in got:
                    fresh.setdefault(it["id"], it)["via_search"] = True
                    found.setdefault(it["id"], set()).add(iss["id"])
                log(f"議題「{iss['title'][:16]}」({lang}): {len(got)} 則")
            except Exception as e:
                log(f"議題「{iss['title'][:16]}」({lang}) 搜尋失敗：{e}")

    new_ids = [i for i in fresh if i not in old]

    merged = {**fresh, **old}  # 已存在的保留（含 AI 翻譯的中文標題）
    cutoff = now_tpe() - dt.timedelta(days=cfg["news"].get("keep_days", 7))
    items = []
    for it in merged.values():
        if dt.datetime.fromisoformat(it["time"]) < cutoff:
            continue
        text = it["title"] + " " + it.get("summary", "")
        it["categories"] = [c for c, words in cats.items() if match(text, words)] or ["其他"]
        relevant = match(text, ctx)
        via_search = bool(it.get("via_search") or it.get("forced_issues"))
        it["via_search"] = via_search
        # 議題連結只看「這次」搜尋結果；議題關鍵字改了，舊的連結就自動消失
        it["forced_issues"] = sorted(found.get(it["id"], set()))
        if via_search and not relevant:
            continue  # 議題搜尋帶進來、但跟汽車無關的新聞（例如運動賽事的 margin）直接丟掉
        ids = {i["id"] for i in issues}
        it["issues"] = [i["id"] for i in issues if relevant and i["keywords"] and match(text, i["keywords"])]
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
