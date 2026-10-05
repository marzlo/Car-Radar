"""每天抓車業股價收盤價，累積成一年份的走勢。"""
from common import DATA, settings, load_json, save_json, log, now_tpe

OUT = DATA / "metrics" / "stocks.json"
KEEP = 400  # 保留最近幾個交易日


def main():
    import yfinance as yf
    cfg = settings()
    old = {s["ticker"]: s for s in load_json(OUT, {}).get("items", [])}
    items = []
    for s in cfg["stocks"]:
        t = s["ticker"]
        hist = dict(old.get(t, {}).get("history", []))
        try:
            period = "1mo" if len(hist) > 200 else "1y"
            df = yf.Ticker(t).history(period=period, auto_adjust=False)
            for idx, row in df.iterrows():
                c = row.get("Close")
                if c == c and c is not None:  # 排除 NaN
                    hist[idx.strftime("%Y-%m-%d")] = round(float(c), 4)
            log(f"{t}: {len(df)} 筆")
        except Exception as e:
            log(f"{t} 抓取失敗，保留舊資料：{e}")
        series = sorted(hist.items())[-KEEP:]
        items.append({**s, "history": [list(x) for x in series]})
    save_json(OUT, {"updated": now_tpe().isoformat(timespec="minutes"), "items": items})


if __name__ == "__main__":
    main()
