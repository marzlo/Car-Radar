"""依序執行所有更新步驟；單一步驟失敗不影響其他步驟。"""
import sys, traceback, importlib
from common import log

STEPS = ["build_issues", "fetch_stocks", "fetch_financials", "fetch_market", "fetch_cn_nev", "fetch_news", "make_brief"]


def main():
    only = sys.argv[1:] or STEPS
    failed = []
    for name in only:
        log(f"── {name}")
        try:
            importlib.import_module(name).main()
        except Exception:
            traceback.print_exc()
            failed.append(name)
    from common import save_json, DATA, now_tpe, load_json
    status = {"updated": now_tpe().isoformat(timespec="minutes"), "failed": failed, "steps": only}
    save_json(DATA / "status.json", status)
    if failed:
        log(f"失敗的步驟：{failed}")


if __name__ == "__main__":
    main()
