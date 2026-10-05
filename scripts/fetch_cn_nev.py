"""中國乘用車新能源零售（乘聯會月報）。

乘聯會沒有公開 API，所以每月請 Claude 用網路搜尋找最新一個月的「正式」月報數字，
檢查合理性後才寫入。沒有 API key 或數字對不上時就不寫，等你手動補。
手動補的方法：直接在 data/metrics/cn_nev.json 的 rows 加一筆。
"""
import datetime as dt
from common import DATA, settings, load_json, save_json, log, now_tpe, extract_json, claude_client, claude_text, ai_model

OUT = DATA / "metrics" / "cn_nev.json"


def next_month(m):
    y, mo = map(int, m.split("-"))
    return f"{y + (mo == 12)}-{1 if mo == 12 else mo + 1:02d}"


def validate(rec, month):
    n, t, p = rec.get("nev_retail"), rec.get("total_retail"), rec.get("penetration")
    if rec.get("month") != month or not all(isinstance(x, (int, float)) for x in (n, t, p)):
        return "欄位缺漏或月份不符"
    if not (100_000 < n < 4_000_000 and 500_000 < t < 5_000_000 and 0 < p < 100):
        return "數字超出合理範圍"
    if abs(n / t * 100 - p) > 1.5:
        return "滲透率與銷量對不起來"
    if not str(rec.get("source", "")).startswith("http"):
        return "沒有來源網址"
    return None


def main():
    data = load_json(OUT, {"name": "中國乘用車新能源零售（乘聯會）", "rows": []})
    rows = data["rows"]
    last = rows[-1]["month"] if rows else "2025-08"
    target = next_month(last)
    now = now_tpe()
    # 正式月報通常在次月 8~12 日公布；目標月份還沒過完就不用找
    target_end = dt.date.fromisoformat(next_month(target) + "-01")
    if now.date() < target_end + dt.timedelta(days=7):
        log(f"{target} 的月報還沒到公布時間，略過")
        return
    client = claude_client()
    if not client:
        return
    cfg = settings()
    prompt = f"""請用網路搜尋找出中國乘聯會（CPCA，乘联会）公布的 {target} 全國乘用車「零售」正式月報數字：
- 新能源乘用車零售量（輛）
- 乘用車零售總量（輛）
- 新能源零售滲透率（%）
請只用正式月報（不要用週度或預估數字），優先來源：cpcaauto.com、cnevpost.com。
如果 {target} 的正式數字還沒公布，回傳 {{"found": false}}。
只回傳一個 JSON，不要其他文字：
{{"found": true, "month": "{target}", "nev_retail": 整數, "total_retail": 整數, "penetration": 小數, "source": "來源網址"}}"""
    resp = client.messages.create(
        model=ai_model(cfg), max_tokens=2000,
        tools=[{"type": cfg["ai"].get("web_search_tool", "web_search_20250305"), "name": "web_search", "max_uses": 5}],
        messages=[{"role": "user", "content": prompt}])
    rec = extract_json(claude_text(resp))
    if not rec.get("found"):
        log(f"{target} 尚未找到正式數字")
        return
    err = validate(rec, target)
    if err:
        log(f"{target} 數字未通過檢查（{err}），不寫入：{rec}")
        return
    rows.append({"month": target, "nev_retail": int(rec["nev_retail"]), "total_retail": int(rec["total_retail"]),
                 "penetration": float(rec["penetration"]), "source": rec["source"], "by": "ai"})
    data["updated"] = now.strftime("%Y-%m-%d")
    save_json(OUT, data)
    log(f"已新增 {target}：滲透率 {rec['penetration']}%")


if __name__ == "__main__":
    main()
