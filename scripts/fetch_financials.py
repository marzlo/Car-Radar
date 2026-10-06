"""每車平均售價（ASP）與每車營業利益。

營收、營業利益：Yahoo Finance 季報（自動）
交車量：data/manual/deliveries.csv（每季手動補）
覆寫：data/manual/financials_override.csv（例如小米只用汽車分部）
"""
import csv
from common import DATA, settings, load_json, save_json, log, now_tpe, quarter_of

RAW = DATA / "metrics" / "financials_raw.json"   # 自動抓到的季報快取
OUT = DATA / "metrics" / "asp.json"
MANUAL = DATA / "manual"
FX_TICKERS = {"CNY": ("CNY=X", True), "JPY": ("JPY=X", True), "HKD": ("HKD=X", True),
              "TWD": ("TWD=X", True), "EUR": ("EURUSD=X", False), "KRW": ("KRW=X", True), "SEK": ("SEK=X", True)}
QUARTERS_SHOWN = 6


def read_csv(name):
    p = MANUAL / name
    if not p.exists():
        return []
    with open(p, encoding="utf-8-sig") as f:
        return [r for r in csv.DictReader(f) if any(v.strip() for v in r.values() if v)]


def num(v):
    try:
        return float(str(v).replace(",", "")) if str(v).strip() != "" else None
    except ValueError:
        return None


def pick_row(df, names):
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def fetch_one(yf, t):
    """單一代號的季報：{季度: {revenue, operating_income}}。"""
    df = yf.Ticker(t).quarterly_income_stmt
    rev = pick_row(df, ["Total Revenue", "Operating Revenue"])
    op = pick_row(df, ["Operating Income", "Total Operating Income As Reported", "EBIT"])
    out = {}
    for col in df.columns:
        q = quarter_of(col.date() if hasattr(col, "date") else col)
        r = rev.get(col) if rev is not None else None
        o = op.get(col) if op is not None else None
        rec = {"revenue": float(r) if r == r and r is not None else None,
               "operating_income": float(o) if o == o and o is not None else None}
        if rec["revenue"] is not None or rec["operating_income"] is not None:
            out[q] = rec
    return out


def fetch_raw(cfg):
    """抓 yfinance 季報，與舊快取合併（抓不到時保留舊值）。ticker 可以是清單（例如現代＋起亞，數字相加）。"""
    import yfinance as yf
    raw = load_json(RAW, {})
    for c in cfg["asp_companies"]:
        t = c.get("ticker")
        tickers = [str(x) for x in t] if isinstance(t, list) else ([str(t)] if t else [])
        if not tickers:
            continue
        try:
            parts = [fetch_one(yf, x) for x in tickers]
            got = raw.setdefault(c["name"], {})
            for q in set.intersection(*[set(p) for p in parts]):
                vals = [p[q] for p in parts]
                rec = {k: (sum(v[k] for v in vals) if all(v[k] is not None for v in vals) else None)
                       for k in ("revenue", "operating_income")}
                if rec["revenue"] is not None or rec["operating_income"] is not None:
                    got[q] = rec
            log(f"{c['name']} 季報：{len(got)} 期")
        except Exception as e:
            log(f"{c['name']} 季報抓取失敗，保留舊資料：{e}")
    save_json(RAW, raw)
    return raw


def fetch_fx(cfg):
    fx = dict(cfg.get("fx_fallback", {}))
    try:
        import yfinance as yf
        for cur, (tk, invert) in FX_TICKERS.items():
            try:
                df = yf.Ticker(tk).history(period="5d")
                v = float(df["Close"].dropna().iloc[-1])
                fx[cur] = round(1 / v if invert else v, 6)
            except Exception as e:
                log(f"匯率 {cur} 失敗，用備用值：{e}")
    except ImportError:
        pass
    fx["USD"] = 1.0
    return fx


def build(cfg, raw, fx):
    deliveries = {}
    for r in read_csv("deliveries.csv"):
        n = num(r["deliveries"])
        if n:
            deliveries[(r["company"].strip(), r["quarter"].strip())] = {"n": n, "src": r.get("source_url", ""), "note": r.get("note", "")}
    overrides = {(r["company"].strip(), r["quarter"].strip()): r for r in read_csv("financials_override.csv")}

    companies = []
    for c in cfg["asp_companies"]:
        name, cur = c["name"], c["currency"]
        qs = sorted({q for (n, q) in deliveries if n == name}
                    | set(raw.get(name, {}).keys())
                    | {q for (n, q) in overrides if n == name})[-QUARTERS_SHOWN:]
        rows = []
        for q in qs:
            d = deliveries.get((name, q))
            ov = overrides.get((name, q))
            if ov:
                rev, op, ccy, fsrc = num(ov["revenue"]), num(ov["operating_income"]), ov.get("currency") or cur, ov.get("source_url", "")
            else:
                f = raw.get(name, {}).get(q, {})
                rev, op, ccy, fsrc = f.get("revenue"), f.get("operating_income"), cur, "Yahoo Finance"
            rate = fx.get(ccy)
            row = {"quarter": q, "deliveries": d["n"] if d else None,
                   "revenue": rev, "operating_income": op, "currency": ccy,
                   "fin_source": fsrc if (rev or op) else "",
                   "del_source": d["src"] if d else "", "del_note": d["note"] if d else ""}
            if d and rate:
                row["asp_usd"] = round(rev * rate / d["n"]) if rev else None
                row["profit_usd"] = round(op * rate / d["n"]) if op is not None else None
            rows.append(row)
        companies.append({"name": name, "note": c.get("note", ""), "currency": cur, "quarters": rows})
    return companies


def main():
    cfg = settings()
    try:
        raw = fetch_raw(cfg)
    except ImportError:
        raw = load_json(RAW, {})
    fx = fetch_fx(cfg)
    save_json(OUT, {"updated": now_tpe().isoformat(timespec="minutes"), "fx_usd": fx,
                    "companies": build(cfg, raw, fx)})


if __name__ == "__main__":
    main()
