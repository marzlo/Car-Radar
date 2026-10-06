"""車企版圖：每天抓市值（Yahoo Finance），搭配 data/manual/sales_annual.csv 的年銷量。"""
import csv
from common import DATA, settings, load_json, save_json, log, now_tpe, today
from fetch_financials import fetch_fx

OUT = DATA / "metrics" / "market.json"
SALES = DATA / "manual" / "sales_annual.csv"
CCY_BY_SUFFIX = {".HK": "HKD", ".SS": "CNY", ".SZ": "CNY", ".DE": "EUR", ".PA": "EUR", ".ST": "SEK",
                 ".T": "JPY", ".KS": "KRW", ".TW": "TWD"}


def guess_ccy(t):
    for suf, c in CCY_BY_SUFFIX.items():
        if t.upper().endswith(suf):
            return c
    return "USD"


def latest_sales():
    out = {}
    if not SALES.exists():
        return out
    with open(SALES, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                y, n = int(r["year"]), float(r["units"])
            except (ValueError, KeyError, TypeError):
                continue
            name = r["company"].strip()
            if name not in out or y > out[name]["year"]:
                out[name] = {"year": y, "units": n, "metric": r.get("metric", ""), "source": r.get("source_url", ""), "note": r.get("note", "")}
    return out


def market_cap(t):
    """先用 Yahoo 報價頁的 marketCap（多數市場已含全部股本），失敗再用 fast_info。"""
    import yfinance as yf
    tk = yf.Ticker(t)
    cap, ccy = None, None
    try:
        info = tk.info or {}
        cap, ccy = info.get("marketCap"), info.get("currency")
    except Exception as e:
        log(f"{t} info 失敗，改用 fast_info：{e}")
    if not cap:
        fi = tk.fast_info
        try:
            cap = fi["marketCap"]
        except Exception:
            cap = getattr(fi, "market_cap", None)
        try:
            ccy = ccy or fi["currency"]
        except Exception:
            pass
    if not cap or cap != cap:
        raise ValueError("沒有市值資料")
    return float(cap), (ccy or guess_ccy(t)).upper()


def main():
    cfg = settings()
    fx = fetch_fx(cfg)
    sales = latest_sales()
    old = {c["name"]: c for c in load_json(OUT, {}).get("companies", [])}
    d = today()
    rows = []
    for m in cfg.get("market_map", []):
        name = m["name"]
        prev = old.get(name, {})
        hist = dict(prev.get("cap_hist", []))
        total, ok = 0.0, True
        for t in m["tickers"]:
            try:
                cap, ccy = market_cap(str(t))
                rate = fx.get(ccy)
                if rate is None:
                    raise ValueError(f"沒有 {ccy} 匯率")
                total += cap * rate
            except Exception as e:
                ok = False
                log(f"{name} {t} 市值失敗，保留舊值：{e}")
        if ok and total > 0:
            hist[d] = round(total)
        series = sorted(hist.items())[-400:]
        rows.append({"name": name, "region": m["region"], "tickers": [str(t) for t in m["tickers"]],
                     "brands": m.get("brands", ""), "cap_usd": series[-1][1] if series else None,
                     "cap_date": series[-1][0] if series else None,
                     "cap_hist": [list(x) for x in series], "sales": sales.get(name)})
        if ok:
            log(f"{name}: {total/1e9:,.1f} B USD")
    save_json(OUT, {"updated": now_tpe().isoformat(timespec="minutes"), "fx_usd": fx, "companies": rows})


if __name__ == "__main__":
    main()
