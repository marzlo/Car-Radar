/* 車業雷達：讀 data/*.json 畫出頁面。沒有框架，直接改這支就好。 */
(() => {
  const REPO = "marzlo/Car-Radar";
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => /^https?:\/\//i.test(u || "") ? esc(u) : "#";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  };
  const nf = (v, d = 0) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
  const big = v => {
    if (v == null) return "—";
    const a = Math.abs(v);
    if (a >= 1e8) return nf(v / 1e8, 2) + " 億";
    if (a >= 1e4) return nf(v / 1e4, 1) + " 萬";
    return nf(v);
  };
  const ago = iso => {
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    if (m < 60) return Math.max(1, Math.round(m)) + " 分鐘前";
    if (m < 60 * 24) return Math.round(m / 60) + " 小時前";
    return Math.round(m / 1440) + " 天前";
  };
  const shortTime = iso => iso ? iso.slice(5, 16).replace("T", " ") : "—";

  // ── 深淺色切換 ──
  const applyTheme = t => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(store.get("theme"));
  $("#themeBtn").onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const t = dark ? "light" : "dark"; applyTheme(t); store.set("theme", t);
  };

  async function get(path, fallback) {
    try {
      const r = await fetch(path + "?v=" + Date.now());
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch (e) { return fallback; }
  }

  const S = { metric: store.get("metric"), range: store.get("range") || "3M", cat: store.get("cat") || "全部", issueFilter: null, open: store.get("issue"), aspMetric: store.get("aspMetric") || "asp_usd", shown: 25 };
  let D = {};

  // ── 走勢小圖 ──
  function sparkPath(vals, w, h, pad) {
    const v = vals.filter(x => x != null);
    if (v.length < 2) return null;
    const min = Math.min(...v), max = Math.max(...v), r = (max - min) || 1;
    const pts = vals.map((x, i) => [pad + i * (w - 2 * pad) / (vals.length - 1), h - pad - (x - min) / r * (h - 2 * pad)]);
    return { pts, d: pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ") };
  }

  // ── 指標清單：乘聯會 + 股價 ──
  function metrics() {
    const list = [];
    const nev = D.nev?.rows || [];
    if (nev.length) {
      const s = nev.slice(-12);
      list.push({ id: "cn_nev", name: "中國新能源滲透率", unit: "%", dec: 1, labels: s.map(r => r.month.slice(2).replace("-", "/")), vals: s.map(r => r.penetration),
        last: s.at(-1).penetration, prev: s.at(-2)?.penetration, deltaMode: "pt", sub: s.at(-1).month + " 月報",
        info: [["資料來源", `乘聯會月報（<a href="${safeUrl(s.at(-1).source)}" target="_blank" rel="noopener">最新一筆來源</a>）`], ["更新頻率", "每月（次月 8–12 日公布）"], ["最新月份", s.at(-1).month]] });
      list.push({ id: "cn_nev_units", name: "中國新能源零售量", unit: "萬輛", dec: 1, labels: s.map(r => r.month.slice(2).replace("-", "/")), vals: s.map(r => r.nev_retail / 1e4),
        last: s.at(-1).nev_retail / 1e4, prev: s.at(-2)?.nev_retail / 1e4, sub: s.at(-1).month + " 月報",
        info: [["資料來源", "乘聯會月報"], ["乘用車零售總量", nf(s.at(-1).total_retail / 1e4, 1) + " 萬輛"], ["最新月份", s.at(-1).month]] });
    }
    for (const st of D.stocks?.items || []) {
      const h = st.history || [];
      if (!h.length) continue;
      const days = S.range === "1Y" ? 260 : 66;
      const s = h.slice(-days);
      list.push({ id: st.ticker, name: st.name + " 股價", unit: st.currency, dec: 2, labels: s.map(x => x[0].slice(5)), vals: s.map(x => x[1]),
        spark: h.slice(-66).map(x => x[1]), last: h.at(-1)[1], prev: h.at(-2)?.[1], sub: h.at(-1)[0], isStock: true,
        info: [["代號", st.ticker], ["資料來源", "Yahoo Finance 收盤價"], ["最新交易日", h.at(-1)[0]]] });
    }
    return list;
  }

  function renderGauges() {
    const list = metrics();
    if (!list.length) {
      $("#gauges").innerHTML = `<div class="g empty">還沒有數據。第一次自動更新完成後就會出現。</div>`;
      $("#detail").hidden = true; return;
    }
    $("#detail").hidden = false;
    if (!list.some(m => m.id === S.metric)) S.metric = list[0].id;
    $("#gauges").innerHTML = list.map(m => {
      const sp = sparkPath(m.spark || m.vals, 160, 32, 3);
      let delta = "";
      if (m.prev != null) {
        const diff = m.deltaMode === "pt" ? m.last - m.prev : (m.last - m.prev) / m.prev * 100;
        const cls = Math.abs(diff) < 0.05 ? "flat" : diff > 0 ? "up" : "down";
        const arrow = cls === "flat" ? "→" : diff > 0 ? "▲" : "▼";
        delta = `<span class="delta ${cls}">${arrow} ${Math.abs(diff).toFixed(m.deltaMode === "pt" ? 1 : 2)}${m.deltaMode === "pt" ? " 個百分點" : "%"} ${m.isStock ? "較前日" : "較上月"}</span>`;
      }
      const e = sp?.pts.at(-1);
      return `<button class="g" data-id="${esc(m.id)}" aria-pressed="${m.id === S.metric}">
        <span class="name">${esc(m.name)}</span>
        <span class="val">${nf(m.last, m.dec)}<small>${esc(m.unit)}</small></span>
        ${delta}
        ${sp ? `<svg viewBox="0 0 160 32" preserveAspectRatio="none" aria-hidden="true"><path d="${sp.d}" fill="none" stroke="var(--muted)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="${e[0]}" cy="${e[1]}" r="2.6" fill="var(--accent)"/></svg>` : ""}
      </button>`;
    }).join("");
    $("#gauges").querySelectorAll(".g[data-id]").forEach(b => b.onclick = () => { S.metric = b.dataset.id; store.set("metric", S.metric); renderGauges(); });
    renderDetail(list.find(m => m.id === S.metric));
  }

  function renderDetail(m) {
    const W = 640, H = 230, L = 58, R = 16, T = 14, B = 30, v = m.vals;
    const min = Math.min(...v), max = Math.max(...v), span = (max - min) || 1, lo = min - span * .1, hi = max + span * .1;
    const x = i => L + i * (W - L - R) / Math.max(1, v.length - 1), y = val => T + (hi - val) / (hi - lo) * (H - T - B);
    const ticks = [0, 1, 2, 3].map(i => lo + (hi - lo) * i / 3);
    const line = v.map((val, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(val).toFixed(1)).join(" ");
    const area = line + ` L${x(v.length - 1)} ${H - B} L${x(0)} ${H - B} Z`;
    const step = Math.ceil(v.length / 8);
    const xl = m.labels.map((l, i) => (i % step === 0 || i === v.length - 1) && !(i !== v.length - 1 && v.length - 1 - i < step / 2) ? `<text x="${x(i)}" y="${H - 9}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(l)}</text>` : "").join("");
    const related = (D.issues?.issues || []).filter(i => i.metric === m.id || (m.id === "cn_nev_units" && i.metric === "cn_nev"));
    $("#detail").innerHTML = `
      <div>
        ${m.isStock ? `<div class="range" role="tablist" aria-label="時間範圍">${["3M", "1Y"].map(r => `<button class="ghost" role="tab" data-r="${r}" aria-selected="${S.range === r}" style="${S.range === r ? "background:var(--fg);color:var(--bg)" : ""}">${r === "3M" ? "3 個月" : "1 年"}</button>`).join("")}</div>` : ""}
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.name)} 走勢">
          ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${nf(t, m.dec > 1 && (hi - lo) > 20 ? 0 : 1)}</text>`).join("")}
          <path d="${area}" fill="var(--accent)" opacity=".12"/>
          <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
          ${xl}
          <circle cx="${x(v.length - 1)}" cy="${y(v.at(-1))}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
        </svg>
      </div>
      <dl>
        <div><dt>指標</dt><dd><b>${esc(m.name)}</b>（${esc(m.unit)}）</dd></div>
        ${m.info.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${val}</dd></div>`).join("")}
        <div><dt>區間</dt><dd class="mono">${nf(min, m.dec)} – ${nf(max, m.dec)}</dd></div>
        ${related.map(i => `<div><dt>相關議題</dt><dd><button class="link-issue" data-open="${esc(i.id)}">${esc(i.title)} →</button></dd></div>`).join("")}
      </dl>`;
    $("#detail").querySelectorAll("[data-r]").forEach(b => b.onclick = () => { S.range = b.dataset.r; store.set("range", S.range); renderGauges(); });
    bindIssueLinks($("#detail"));
  }

  // ── 每車售價與利潤 ──
  function renderAsp() {
    const cos = D.asp?.companies || [];
    document.querySelectorAll(".seg button").forEach(b => {
      b.setAttribute("aria-selected", b.dataset.m === S.aspMetric);
      b.onclick = () => { S.aspMetric = b.dataset.m; store.set("aspMetric", S.aspMetric); renderAsp(); };
    });
    if (!cos.length) { $("#asp").innerHTML = `<tr><td class="empty">還沒有資料。</td></tr>`; return; }
    const qs = [...new Set(cos.flatMap(c => c.quarters.map(q => q.quarter)))].sort().slice(-6);
    const k = S.aspMetric;
    const all = cos.flatMap(c => c.quarters.map(q => q[k])).filter(v => v != null);
    const maxAbs = Math.max(1, ...all.map(Math.abs));
    const hasNeg = all.some(v => v < 0);
    const cell = (q) => {
      if (!q) return `<td class="cell na">—</td>`;
      const v = q[k];
      if (v == null) {
        const why = !q.deliveries ? "缺交車量" : "缺財報";
        return `<td class="cell na" title="${why}">—<span class="small"> ${why}</span></td>`;
      }
      const w = Math.abs(v) / maxAbs * (hasNeg ? 50 : 100);
      const left = hasNeg ? (v < 0 ? 50 - w : 50) : 0;
      const tip = `交車 ${nf(q.deliveries)}・營收 ${big(q.revenue)} ${q.currency}・營業利益 ${big(q.operating_income)} ${q.currency}`;
      const cls = k === "profit_usd" ? (v < 0 ? "neg" : "pos") : "";
      return `<td class="cell" title="${esc(tip)}">$${nf(v)}<span class="bar${hasNeg ? " zero" : ""}"><i class="${cls}" style="left:${left}%;width:${w}%"></i></span></td>`;
    };
    $("#asp").innerHTML = `<thead><tr><th>車企</th>${qs.map(q => `<th>${q.replace("Q", " Q")}</th>`).join("")}</tr></thead><tbody>` +
      cos.map(c => {
        const byQ = Object.fromEntries(c.quarters.map(q => [q.quarter, q]));
        return `<tr><td class="co"><b>${esc(c.name)}</b>${c.note ? `<span>${esc(c.note)}</span>` : ""}</td>${qs.map(q => cell(byQ[q])).join("")}</tr>`;
      }).join("") + "</tbody>";
    const fx = D.asp.fx_usd || {};
    $("#aspFoot").innerHTML = (k === "profit_usd" ? `<span class="legend"><span><i style="background:var(--down)"></i>◀ 虧損</span><span>中間直線 = 0</span><span><i style="background:var(--up)"></i>獲利 ▶</span></span>` : "") + `單位：美元／輛。${k === "asp_usd" ? "每車平均售價 = 季營收 ÷ 交車量" : "每車營業利益 = 季營業利益 ÷ 交車量"}，用全公司數字估算（小米只用汽車分部），適合看趨勢，不適合精確比較。
      匯率用最新值統一換算：1 CNY = ${fx.CNY ?? "?"}、1 JPY = ${fx.JPY ?? "?"}、1 EUR = ${fx.EUR ?? "?"} USD。滑鼠移到數字上看交車量與財報原值。
      交車量每季在 <code>data/manual/deliveries.csv</code> 補一行。更新：${esc(shortTime(D.asp.updated))}`;
  }

  // ── 新聞 ──
  const CATS = ["全部", "電池", "智駕", "座艙・SDV", "車企動向", "供應鏈", "其他"];
  function renderNews() {
    const items = D.news?.items || [];
    const issues = D.issues?.issues || [];
    const pool = S.issueFilter ? items.filter(n => n.issues?.includes(S.issueFilter)) : items;
    $("#tabs").innerHTML = CATS.map(c => {
      const n = c === "全部" ? pool.length : pool.filter(x => x.categories?.includes(c)).length;
      if (!n && c !== "全部") return "";
      return `<button role="tab" aria-selected="${c === S.cat}" data-c="${esc(c)}">${esc(c)} <span class="mono" style="opacity:.6">${n}</span></button>`;
    }).join("");
    $("#tabs").querySelectorAll("button").forEach(b => b.onclick = () => { S.cat = b.dataset.c; S.shown = 25; store.set("cat", S.cat); renderNews(); });
    const fi = issues.find(i => i.id === S.issueFilter);
    $("#issueFilter").hidden = !fi;
    if (fi) {
      $("#issueFilter").innerHTML = `只看議題：<b>${esc(fi.title)}</b> <button class="ghost" id="clearFilter">清除</button>`;
      $("#clearFilter").onclick = () => { S.issueFilter = null; renderNews(); };
    }
    const list = pool.filter(n => S.cat === "全部" || n.categories?.includes(S.cat));
    if (!list.length) { $("#news").innerHTML = `<li class="empty">這個分類目前沒有新聞。</li>`; $("#moreBtn").hidden = true; return; }
    $("#news").innerHTML = list.slice(0, S.shown).map(n => {
      const zh = n.title_zh && n.lang !== "zh";
      const iss = (n.issues || []).map(id => issues.find(i => i.id === id)).filter(Boolean);
      return `<li>
        <div class="meta">${(n.categories || []).map(c => `<span class="cat">${esc(c)}</span>`).join("")}<span>${esc(n.source)}</span><span class="mono" title="${esc(n.time)}">${ago(n.time)}</span></div>
        <h3><a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(zh ? n.title_zh : n.title)}</a></h3>
        ${zh ? `<div class="orig">${esc(n.title)}</div>` : ""}
        ${n.summary ? `<p>${esc(n.summary)}</p>` : ""}
        ${iss.map(i => `<button class="link-issue" data-open="${esc(i.id)}">↳ 議題：${esc(i.title)}</button>`).join("")}
      </li>`;
    }).join("");
    $("#moreBtn").hidden = list.length <= S.shown;
    $("#moreBtn").onclick = () => { S.shown += 25; renderNews(); };
    bindIssueLinks($("#news"));
  }

  // ── 議題 ──
  function renderIssues() {
    const issues = D.issues?.issues || [];
    const news = D.news?.items || [];
    const notes = D.feed?.notes || [];
    if (!issues.length) { $("#issues").innerHTML = `<p class="empty">還沒有議題。在 repo 的 issues 資料夾新增 .md 檔。</p>`; return; }
    const list = metrics();
    $("#issues").innerHTML = issues.map(i => {
      const ex = i.id === S.open;
      const rel = news.filter(n => n.issues?.includes(i.id));
      const ai = notes.filter(n => n.issue === i.id);
      const tl = [
        ...i.entries.map(e => ({ d: e.date, k: e.label, x: e.text, me: true })),
        ...ai.map(n => ({ d: n.date, k: "AI 整理", x: n.note, ids: n.news_ids }))
      ].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : (a.me ? -1 : 1));
      const m = list.find(x => x.id === i.metric);
      return `<button class="issue-btn" aria-expanded="${ex}" data-id="${esc(i.id)}">
          <span class="t">${esc(i.title)}</span><span class="pill ${esc(i.status)}">${esc(i.status_label)}</span>
          <span class="s">從 ${esc(i.since)} 開始・${i.entries.length} 筆我的紀錄・${ai.length} 筆 AI 整理・近 7 天 ${rel.length} 則新聞</span>
        </button>
        ${ex ? `<div class="issue-body">
          <div class="compare">
            <div><span class="eyebrow">當時（${esc(i.since)}）</span>${esc(i.then)}</div>
            <div><span class="eyebrow">現在</span>${esc(i.now)}</div>
          </div>
          <ol class="tl">${tl.map(e => `<li class="${e.me ? "me" : ""}"><span class="d">${esc(e.d)}</span><span class="k">${esc(e.k)}</span>
            <div class="x">${esc(e.x)}</div>
            ${(e.ids || []).map(id => news.find(n => n.id === id)).filter(Boolean).map(n => `<a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title_zh || n.title)}</a>`).join("")}
          </li>`).join("")}</ol>
          <div class="chips">
            ${rel.length ? `<button data-filter="${esc(i.id)}">看 ${rel.length} 則相關新聞</button>` : ""}
            ${m ? `<button data-metric="${esc(m.id)}">${esc(m.name)} ${nf(m.last, m.dec)} ${esc(m.unit)}</button>` : ""}
            <a href="https://github.com/${REPO}/edit/main/issues/${encodeURIComponent(i.id)}.md" target="_blank" rel="noopener">✎ 編輯這個議題</a>
          </div>
        </div>` : ""}`;
    }).join("");
    $("#issues").querySelectorAll(".issue-btn").forEach(b => b.onclick = () => { S.open = S.open === b.dataset.id ? "" : b.dataset.id; store.set("issue", S.open); renderIssues(); });
    $("#issues").querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { S.issueFilter = b.dataset.filter; S.cat = "全部"; renderNews(); $("#news-h").scrollIntoView({ behavior: "smooth" }); });
    $("#issues").querySelectorAll("[data-metric]").forEach(b => b.onclick = () => { S.metric = b.dataset.metric; renderGauges(); $("#kpi-h").scrollIntoView({ behavior: "smooth" }); });
  }

  function bindIssueLinks(root) {
    root.querySelectorAll("[data-open]").forEach(b => b.onclick = () => {
      S.open = b.dataset.open; store.set("issue", S.open); renderIssues();
      $("#iss-h").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ── 懶人包 ──
  function renderBrief(day) {
    const news = D.news?.items || [];
    if (!day || !day.items?.length) {
      $("#brief").innerHTML = `<li><span class="muted">今天還沒有懶人包。第一次自動更新後就會出現。</span></li>`;
      $("#briefMode").textContent = ""; return;
    }
    $("#brief").innerHTML = day.items.map(b => {
      const links = (b.news_ids || []).map(id => news.find(n => n.id === id)).filter(Boolean).slice(0, 2);
      return `<li><span>${esc(b.text)}<span class="tag">→ ${esc(b.category || "")}</span>${links.map(n => `<a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.source)}</a>`).join("")}</span></li>`;
    }).join("");
    $("#briefMode").textContent = day.ai ? "由 Claude 整理" : "AI 未啟用：顯示各分類最新頭條";
  }

  function setupBriefHistory() {
    const days = (D.history?.days || []).slice().reverse();
    const today = D.brief;
    const opts = days.length ? days : (today ? [today] : []);
    $("#briefDate").innerHTML = opts.map((d, i) => `<option value="${esc(d.date)}">${esc(d.date)}${i === 0 ? "（最新）" : ""}</option>`).join("");
    $("#briefDate").disabled = opts.length < 2;
    $("#briefDate").onchange = e => renderBrief(opts.find(d => d.date === e.target.value));
    renderBrief(today || opts[0]);
  }

  async function init() {
    const [status, nev, stocks, asp, news, issues, brief, history, feed] = await Promise.all([
      get("data/status.json", null), get("data/metrics/cn_nev.json", null), get("data/metrics/stocks.json", null),
      get("data/metrics/asp.json", null), get("data/news/latest.json", null), get("data/issues.json", null),
      get("data/brief.json", null), get("data/brief_history.json", null), get("data/issue_feed.json", null)
    ]);
    D = { status, nev, stocks, asp, news, issues, brief, history, feed };
    if (status?.updated) {
      const stale = Date.now() - new Date(status.updated).getTime() > 36 * 3600e3;
      $("#updated").innerHTML = `<span class="lamp ${status.failed?.length || stale ? "warn" : ""}"></span>${esc(shortTime(status.updated))}`;
      const msgs = [];
      if (status.failed?.length) msgs.push(`上次更新有步驟失敗：${status.failed.join("、")}（其他資料照常更新）。可到 GitHub 的 Actions 頁面看紀錄。`);
      if (stale) msgs.push("已超過一天半沒有自動更新，請檢查 GitHub Actions 是否被停用。");
      if (msgs.length) { $("#alert").hidden = false; $("#alert").textContent = msgs.join(" "); }
    } else {
      $("#updated").textContent = "尚未自動更新";
    }
    $("#newsCount").textContent = news?.items ? `近 7 天 ${news.items.length} 則` : "—";
    $("#newsMeta").textContent = news ? `${news.feeds_ok}/${news.feeds_total} 個來源正常・${shortTime(news.updated)}` : "";
    setupBriefHistory();
    renderGauges();
    renderAsp();
    renderNews();
    renderIssues();
  }
  init();
})();
