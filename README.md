# 車業雷達 Car Radar

個人用的汽車產業儀表板，包含數據、每日新聞和議題追蹤。放在 GitHub Pages，每天台灣時間早上 6 點自動更新。

網址：https://marzlo.github.io/Car-Radar/

## 第一次上線（大約 10 分鐘）

1. **把檔案推上去**

   在這個資料夾打開終端機（Git Bash 或 PowerShell）：

   ```bash
   git init -b main
   git remote add origin https://github.com/marzlo/Car-Radar.git
   git add .
   git commit -m "init: 車業雷達"
   git push -u origin main
   ```

2. **開啟 GitHub Pages**

   Repo → Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。

3. **設定 Claude API key**（懶人包、英文標題翻譯、乘聯會月報都會用到）

   Repo → Settings → Secrets and variables → Actions → New repository secret
   - Name：`ANTHROPIC_API_KEY`
   - Secret：你的 API key（在 https://console.anthropic.com 建立）

   沒設定也能跑。懶人包會改成顯示各分類的最新頭條，乘聯會的數字就要自己補。

4. **讓 Actions 可以寫回 repo**

   Settings → Actions → General → Workflow permissions 選 **Read and write permissions** → Save。

5. **手動跑第一次**

   Actions → 每日更新 → Run workflow。大約 3 分鐘後打開網址就會看到資料。

## 日常維護

| 想做的事 | 改哪裡 |
|---|---|
| 新增或修改議題、寫下新的判斷 | `issues/*.md`（格式見 `issues/README.md`），或在網頁上按「✎ 編輯這個議題」 |
| 每季補交車量 | `data/manual/deliveries.csv` 加一行（公司,季度,交車量,來源網址,備註） |
| 手動填財報（覆蓋自動值） | `data/manual/financials_override.csv` |
| 補乘聯會月報（沒有 API key 時） | `data/metrics/cn_nev.json` 的 `rows` 加一筆 |
| 加股票、新聞來源、分類關鍵字 | `config/settings.yml` |
| 換 AI 模型 | Settings → Variables 新增 `CLAUDE_MODEL`，或改 `config/settings.yml` |

改完 push 上去，幾分鐘後網頁就會更新。

## 資料怎麼來

| 區塊 | 來源 | 頻率 |
|---|---|---|
| 股價 | Yahoo Finance（yfinance） | 每天 |
| 中國新能源滲透率、零售量 | 乘聯會月報。每月由 Claude 上網搜尋最新正式數字，檢查合理性後才寫入 | 每月 |
| 每車售價與利潤 | 營收、營業利益來自 Yahoo Finance 季報；交車量手動填；小米只用汽車分部數字（手動） | 每季 |
| 新聞 | Google 新聞（中英文關鍵字）、Electrek、InsideEVs、CnEVPost 的 RSS | 每天 |
| 懶人包、議題近況、標題翻譯 | Claude API | 每天 |

每次更新都會 commit 到 `data/`，所以 git 紀錄就是完整的歷史。`data/news/archive/` 存每天的新聞，`data/brief_history.json` 存每天的懶人包。

## 本機預覽

```bash
python -m http.server 8000
# 打開 http://localhost:8000
```

本機跑更新（需要網路）：

```bash
pip install -r requirements.txt
python scripts/update_all.py                    # 全部
python scripts/update_all.py fetch_news         # 只跑一步
```

## 注意

- 這個 repo 和網頁都是公開的，不要放工作上的內部資訊。
- 每車售價與利潤是用全公司營收和營業利益除以交車量估算，適合看趨勢，不適合精確比較。各公司的口徑差異寫在 `config/settings.yml` 的 note。
- 如果 repo 60 天沒有任何活動，GitHub 會自動停用排程。每天的自動 commit 通常就算活動，但如果發現沒更新，到 Actions 頁面重新啟用就好。
- AI 費用：每天大約一次懶人包呼叫，加上每月一次搜尋，用 Sonnet 每月大約幾美元以內。
