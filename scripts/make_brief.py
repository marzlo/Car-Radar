"""用 Claude 產生今日懶人包、議題近況，並把英文標題翻成中文。
沒有 API key 時，改用各分類最新一則當懶人包（標記為非 AI）。"""
import datetime as dt
from common import DATA, settings, load_json, save_json, log, now_tpe, today, extract_json, claude_client, claude_text, ai_model

LATEST = DATA / "news" / "latest.json"
BRIEF = DATA / "brief.json"
HISTORY = DATA / "brief_history.json"
FEED = DATA / "issue_feed.json"


def fallback(items):
    seen, out = set(), []
    for it in items:
        c = it["categories"][0]
        if c in seen or c == "其他":
            continue
        seen.add(c)
        out.append({"text": it.get("title_zh") or it["title"], "category": c, "news_ids": [it["id"]]})
        if len(out) == 3:
            break
    return out


def main():
    cfg = settings()
    news = load_json(LATEST, {"items": []})
    items = news["items"]
    issues = load_json(DATA / "issues.json", {"issues": []})["issues"]
    since = now_tpe() - dt.timedelta(hours=30)
    recent = [i for i in items if dt.datetime.fromisoformat(i["time"]) >= since][:80] or items[:40]

    client = claude_client()
    result = None
    if client and recent:
        lines = "\n".join(f'{i["id"]} | {",".join(i["categories"])} | {i["source"]} | {i["title"]}'
                          + (f' | {i["summary"][:100]}' if i.get("summary") else "") for i in recent)
        iss = "\n".join(f'{i["id"]} | {i["title"]} | 當時判斷：{i["then"]}' for i in issues)
        prompt = f"""你是汽車產業分析助理，讀者是在車用資訊娛樂（座艙、CarPlay/Android Auto）領域工作的台灣工程師。
以下是過去一天的汽車產業新聞（id | 分類 | 來源 | 標題 | 摘要）：
{lines}

讀者正在追蹤的議題（id | 議題 | 當時判斷）：
{iss}

請用繁體中文（台灣用語）回傳一個 JSON，不要其他文字：
{{
 "brief": [ {{"text": "一句話重點（40 字內，先講結論）", "category": "電池|智駕|座艙・SDV|車企動向|供應鏈", "news_ids": ["相關新聞 id"]}} ],  // 剛好 3 則，選今天最重要的
 "issue_notes": [ {{"issue": "議題 id", "note": "今天的新聞對這個議題代表什麼（60 字內，支持或挑戰當時判斷要講清楚）", "news_ids": ["id"]}} ],  // 只寫今天真的有相關新聞的議題，沒有就空陣列
 "titles_zh": {{ "新聞 id": "英文標題的中文翻譯" }}  // 只翻英文標題
}}
只能根據上面的新聞內容，不要加入新聞沒提到的數字或事實。"""
        try:
            resp = client.messages.create(model=ai_model(cfg), max_tokens=6000,
                                          messages=[{"role": "user", "content": prompt}])
            result = extract_json(claude_text(resp))
        except Exception as e:
            log(f"AI 懶人包失敗，改用備用版本：{e}")

    valid_ids = {i["id"] for i in items}
    if result:
        brief = [b for b in result.get("brief", []) if b.get("text")][:3]
        for b in brief:
            b["news_ids"] = [x for x in b.get("news_ids", []) if x in valid_ids]
        zh = result.get("titles_zh") or {}
        for it in items:
            if it["id"] in zh and it.get("lang") != "zh":
                it["title_zh"] = zh[it["id"]]
        save_json(LATEST, news)
        issue_ids = {i["id"] for i in issues}
        feed = load_json(FEED, {"notes": []})
        feed["notes"] = [n for n in feed["notes"] if n["date"] != today()]
        for n in result.get("issue_notes", []):
            if n.get("issue") in issue_ids and n.get("note"):
                feed["notes"].append({"date": today(), "issue": n["issue"], "note": n["note"],
                                      "news_ids": [x for x in n.get("news_ids", []) if x in valid_ids]})
        save_json(FEED, feed)
        ai = True
    else:
        brief, ai = fallback(recent), False

    out = {"date": today(), "generated": now_tpe().isoformat(timespec="minutes"), "ai": ai, "items": brief}
    save_json(BRIEF, out)
    hist = load_json(HISTORY, {"days": []})
    hist["days"] = [d for d in hist["days"] if d["date"] != today()] + [out]
    hist["days"] = hist["days"][-120:]
    save_json(HISTORY, hist)
    log(f"懶人包 {len(brief)} 則（AI={ai}）")


if __name__ == "__main__":
    main()
