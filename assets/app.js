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
  // ── 新聞 ──
  const CATS = ["全部", "Stellantis", "電池", "智駕", "座艙・SDV", "車企動向", "供應鏈", "其他"];
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
    const list = metrics();
    const newForm = S.editing?.mode === "new" ? `<div class="issue-body">${issueForm(null, list)}</div>` : "";
    if (!issues.length && !newForm) { $("#issues").innerHTML = `<p class="empty">還沒有議題。按右上角「＋ 新增議題」。</p>`; return; }
    $("#issues").innerHTML = newForm + issues.map(i => {
      const ex = i.id === S.open;
      const rel = news.filter(n => n.issues?.includes(i.id));
      const ai = notes.filter(n => n.issue === i.id);
      const tl = [
        ...i.entries.map(e => ({ d: e.date, k: e.label, x: e.text, me: true })),
        ...ai.map(n => ({ d: n.date, k: "AI 整理", x: n.note, ids: n.news_ids }))
      ].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : (a.me ? -1 : 1));
      const m = list.find(x => x.id === i.metric);
      const ed = S.editing && S.editing.id === i.id ? S.editing.mode : null;
      return `<button class="issue-btn" aria-expanded="${ex}" data-id="${esc(i.id)}">
          <span class="t">${esc(i.title)}</span><span class="pill ${esc(i.status)}">${esc(i.status_label)}</span>
          <span class="s">從 ${esc(i.since)} 開始・${i.entries.length} 筆我的紀錄・${ai.length} 筆 AI 整理・近 7 天 ${rel.length} 則新聞${i._pending ? "・<b>同步中</b>" : ""}</span>
        </button>
        ${ex ? `<div class="issue-body">
          ${ed === "edit" ? issueForm(i, list) : `<div class="compare">
            <div><span class="eyebrow">當時（${esc(i.since)}）</span>${esc(i.then)}</div>
            <div><span class="eyebrow">現在</span>${esc(i.now)}</div>
          </div>`}
          <ol class="tl">${tl.map(e => `<li class="${e.me ? "me" : ""}"><span class="d">${esc(e.d)}</span><span class="k">${esc(e.k)}</span>
            <div class="x">${esc(e.x)}</div>
            ${(e.ids || []).map(id => news.find(n => n.id === id)).filter(Boolean).map(n => `<a href="${safeUrl(n.link)}" target="_blank" rel="noopener">${esc(n.title_zh || n.title)}</a>`).join("")}
          </li>`).join("")}</ol>
          ${ed === "entry" ? entryForm() : ""}
          <div class="chips">
            ${ed ? "" : `<button class="chip-strong" data-edit="edit">✎ 更新判斷／設定</button><button class="chip-strong" data-edit="entry">＋ 新增紀錄</button>`}
            ${ed ? "" : S.confirmDel === i.id
              ? `<span class="del-confirm">確定刪除這個議題？<button class="chip-danger" data-del-yes>刪除</button><button data-del-no>取消</button><span class="fmsg" id="delmsg"></span></span>`
              : `<button class="chip-danger" data-del>🗑 刪除議題</button>`}
            ${rel.length ? `<button data-filter="${esc(i.id)}">看 ${rel.length} 則相關新聞</button>` : ""}
            ${m ? `<button data-metric="${esc(m.id)}">${esc(m.name)} ${nf(m.last, m.dec)} ${esc(m.unit)}</button>` : ""}
          </div>
        </div>` : ""}`;
    }).join("");
    $("#issues").querySelectorAll(".issue-btn").forEach(b => b.onclick = () => { S.open = S.open === b.dataset.id ? "" : b.dataset.id; S.editing = null; S.confirmDel = null; store.set("issue", S.open); renderIssues(); });
    $("#issues").querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { S.issueFilter = b.dataset.filter; S.cat = "全部"; renderNews(); $("#news-h").scrollIntoView({ behavior: "smooth" }); });
    $("#issues").querySelectorAll("[data-metric]").forEach(b => b.onclick = () => { S.metric = b.dataset.metric; renderGauges(); $("#kpi-h").scrollIntoView({ behavior: "smooth" }); });
    $("#issues").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { S.editing = { id: S.open, mode: b.dataset.edit }; renderIssues(); });
    $("#issues").querySelectorAll("[data-del]").forEach(b => b.onclick = () => { S.confirmDel = S.open; renderIssues(); });
    $("#issues").querySelectorAll("[data-del-no]").forEach(b => b.onclick = () => { S.confirmDel = null; renderIssues(); });
    $("#issues").querySelectorAll("[data-del-yes]").forEach(b => b.onclick = () => deleteIssue(S.open, b));
    bindIssueForm();
  }

  // ── 議題編輯：直接在網頁上改，存回 GitHub 的 issues/*.md ──
  const STATUS_LABEL = { keep: "觀點維持", revise: "修正中", flip: "已推翻", watch: "觀察中" };
  const todayTpe = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const isPlaceholder = t => /^（(還沒寫|新議題)/.test(t || "");

  function issueForm(i, list) {
    const isNew = !i;
    const v = i || { title: "", status: "watch", then: "", now: "", keywords: [], metric: "" };
    return `<form class="iform" id="issueForm" novalidate>
      <h3>${isNew ? "新增議題" : "更新判斷／設定"}</h3>
      <label for="f-title">議題（建議寫成問句）</label>
      <input id="f-title" required value="${esc(v.title)}" placeholder="例如：Stellantis 在 Filosa 領導下能否止跌回升？">
      <div class="frow">
        <div><label for="f-status">狀態</label>
          <select id="f-status">${Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}"${k === v.status ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label for="f-metric">相關數據</label>
          <select id="f-metric"><option value="">（無）</option>${list.map(m => `<option value="${esc(m.id)}"${m.id === v.metric ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
      </div>
      <label for="f-then">${isNew ? "我現在的判斷（會記為「當時」）" : "當時的判斷"}</label>
      <textarea id="f-then" rows="2">${esc(isPlaceholder(v.then) ? "" : v.then)}</textarea>
      ${isNew ? "" : `<label for="f-now">現在的判斷</label>
      <textarea id="f-now" rows="3" placeholder="現在怎麼看？觀點維持、修正，還是推翻？">${esc(isPlaceholder(v.now) ? "" : v.now)}</textarea>
      <label class="check"><input type="checkbox" id="f-log" checked> 把「現在的判斷」同時記一筆到時間軸（標籤：回顧，日期：今天）</label>`}
      <label for="f-kw">關鍵字（用逗號分隔，越前面越重要）</label>
      <div class="kwrow"><input id="f-kw" value="${esc((v.keywords || []).join(", "))}" placeholder="留空的話，儲存時會依議題名稱自動產生">
        <button class="ghost" type="button" id="kwSuggest">✨ 自動產生</button></div>
      <span class="muted small">每天也會用前 8 個關鍵字去 Google 新聞（中英文）搜尋，找到的新聞直接歸到這個議題。</span>
      <div class="factions"><button class="primary" type="submit">${isNew ? "建立議題" : "儲存"}</button><button class="ghost" type="button" data-cancel>取消</button><span class="fmsg" id="fmsg"></span></div>
    </form>`;
  }

  function entryForm() {
    return `<form class="iform" id="entryForm" novalidate>
      <h3>新增紀錄</h3>
      <div class="frow">
        <div><label for="e-date">日期</label><input id="e-date" type="date" value="${todayTpe()}"></div>
        <div><label for="e-label">標籤</label><input id="e-label" value="筆記" list="e-labels">
          <datalist id="e-labels"><option value="筆記"><option value="我的判斷"><option value="回顧"><option value="觀察"><option value="新聞"></datalist></div>
      </div>
      <label for="e-text">內容</label>
      <textarea id="e-text" rows="4" placeholder="今天看到什麼、想到什麼"></textarea>
      <div class="factions"><button class="primary" type="submit">加入時間軸</button><button class="ghost" type="button" data-cancel>取消</button><span class="fmsg" id="fmsg"></span></div>
    </form>`;
  }

  // 依議題名稱產生關鍵字：比對內建詞庫（中英文同義詞、車企名稱）
  const KW_GROUPS = [
    [/智駕|智慧駕駛|智能駕駛|自動駕駛|自駕|輔助駕駛|NOA|ADAS|FSD|autonomous|self.?driving/i, ["智駕", "自動駕駛", "輔助駕駛", "NOA", "ADAS", "FSD", "autonomous driving", "self-driving"]],
    [/方案|採用|供應商|晶片|平台|算力/, ["Mobileye", "Nvidia DRIVE", "地平線", "Horizon Robotics", "Momenta", "華為乾崑", "Qualcomm Snapdragon Ride", "端到端"]],
    [/robotaxi|無人車|自駕計程/i, ["Robotaxi", "Waymo", "蘿蔔快跑", "無人駕駛計程車"]],
    [/光達|雷達|LiDAR|感測/i, ["LiDAR", "光達", "激光雷達", "禾賽", "Hesai"]],
    [/電池|固態|鋰|鈉|續航/, ["電池", "battery", "固態電池", "solid-state battery", "LFP", "鈉離子", "CATL", "寧德時代"]],
    [/充電|快充|超充|換電/, ["充電", "快充", "超充", "charging", "NACS", "換電"]],
    [/座艙|車機|中控|CarPlay|Android Auto|資訊娛樂|infotainment/i, ["智慧座艙", "車機", "CarPlay", "Android Auto", "infotainment", "cockpit", "8295"]],
    [/SDV|軟體定義|軟件定義|OTA|中央運算|電子電氣|E\/E/i, ["SDV", "software-defined vehicle", "軟體定義汽車", "OTA", "中央運算", "zonal architecture"]],
    [/價格戰|降價|利潤|毛利|獲利|虧損/, ["價格戰", "降價", "price war", "price cut", "毛利", "profit margin"]],
    [/關稅|貿易|出口|出海|海外/, ["關稅", "tariff", "汽車出口", "export", "出海", "海外工廠"]],
    [/氫|燃料電池/, ["氫能車", "燃料電池", "hydrogen", "fuel cell"]],
    [/補貼|補助|獎勵|稅收|減稅/, ["電動車補貼", "購車補助", "EV subsidy", "EV incentive", "tax credit"]],
    [/混動|插電|增程|PHEV|EREV/i, ["插電混動", "增程", "PHEV", "EREV", "hybrid"]],
  ];
  const BRANDS = [
    [/Stellantis|斯泰蘭蒂斯/i, ["Stellantis"]], [/Tesla|特斯拉/i, ["Tesla", "特斯拉"]], [/BYD|比亞迪/i, ["BYD", "比亞迪"]],
    [/Toyota|豐田/i, ["Toyota", "豐田"]], [/小米|Xiaomi/i, ["小米汽車", "Xiaomi EV"]], [/華為|Huawei|問界|鴻蒙智行/i, ["華為", "Huawei", "鴻蒙智行"]],
    [/\bGM\b|通用/i, ["GM", "General Motors", "通用汽車"]], [/Ford|福特/i, ["Ford", "福特"]], [/理想|Li Auto/i, ["理想汽車", "Li Auto"]],
    [/蔚來|NIO/i, ["蔚來", "NIO"]], [/小鵬|XPeng/i, ["小鵬", "XPeng"]], [/Waymo/i, ["Waymo"]], [/Jeep/i, ["Jeep"]],
    [/鴻海|Foxconn/i, ["鴻海", "Foxconn"]], [/Nvidia|輝達/i, ["Nvidia", "輝達"]], [/Mobileye/i, ["Mobileye"]],
  ];
  function suggestKeywords(title) {
    const out = [];
    const add = arr => arr.forEach(k => { if (!out.includes(k)) out.push(k); });
    BRANDS.forEach(([re, ks]) => { if (re.test(title)) add(ks); });
    (title.match(/[A-Za-z][A-Za-z0-9\-]{2,}/g) || []).forEach(w => { if (!/^(the|and|for|with|EV|OTA)$/i.test(w)) add([w]); });
    const groups = KW_GROUPS.filter(([re]) => re.test(title)).map(g => g[1]);
    groups.forEach(ks => add(ks.slice(0, 4)));   // 每組前 4 個先排前面（每天搜尋只用前 8 個）
    groups.forEach(ks => add(ks.slice(4)));
    if (!out.length) {  // 詞庫沒對到：拿掉問句用語，用剩下的詞
      const core = title.replace(/[？?！!。，,、：:「」『』（）()]/g, " ")
        .replace(/目前|現在|未來|各|哪些|什麼|為何|如何|是否|能否|會不會|真正|何時|什麼時候|誰的|嗎|呢|的/g, " ")
        .split(/\s+/).filter(w => w.length >= 2);
      add(core.slice(0, 4));
    }
    return out.slice(0, 12);
  }

  function bindIssueForm() {
    const sg = $("#kwSuggest");
    if (sg) sg.onclick = () => {
      const t = $("#f-title").value.trim();
      if (!t) { $("#fmsg").textContent = "請先填議題名稱"; return; }
      const cur = $("#f-kw").value.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean);
      const merged = [...cur, ...suggestKeywords(t).filter(k => !cur.includes(k))];
      $("#f-kw").value = merged.join(", ");
      $("#fmsg").textContent = "";
    };
    document.querySelectorAll("#issues [data-cancel]").forEach(b => b.onclick = () => { S.editing = null; renderIssues(); });
    const f = $("#issueForm"), e = $("#entryForm");
    if (f) f.onsubmit = ev => { ev.preventDefault(); saveIssueForm(); };
    if (e) e.onsubmit = ev => { ev.preventDefault(); saveEntryForm(); };
  }

  const yq = s => JSON.stringify(String(s ?? ""));   // JSON 字串也是合法的 YAML
  function issueToMd(i) {
    const body = i.entries.map(e => `## ${e.date} | ${e.label}\n${e.text.trim()}\n`).join("\n");
    return `---\ntitle: ${yq(i.title)}\nstatus: ${i.status}\nsince: ${yq(i.since)}\nkeywords: ${JSON.stringify(i.keywords || [])}\nmetric: ${yq(i.metric || "")}\nthen: ${yq(i.then)}\nnow: ${yq(i.now)}\n---\n\n${body}`;
  }
  const b64 = s => { const bytes = new TextEncoder().encode(s); let bin = ""; bytes.forEach(x => bin += String.fromCharCode(x)); return btoa(bin); };

  async function saveToGitHub(issue, message) {
    const token = store.get(TOKEN_KEY);
    if (!token) throw Object.assign(new Error("需要先設定 GitHub 權杖（同手動更新）"), { needToken: true });
    const path = `issues/${issue.id}.md`;
    const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
    const hdr = { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" };
    let sha;
    const g = await fetch(url + "?ref=main&t=" + Date.now(), { headers: hdr });
    if (g.ok) sha = (await g.json()).sha;
    else if (g.status === 401) throw Object.assign(new Error("權杖無效或已過期"), { needToken: true });
    const clean = { ...issue }; delete clean._pending;
    const r = await fetch(url, { method: "PUT", headers: hdr, body: JSON.stringify({ message, content: b64(issueToMd(clean)), branch: "main", ...(sha ? { sha } : {}) }) });
    if (r.status === 401 || r.status === 403 || r.status === 404)
      throw Object.assign(new Error(`權杖權限不足（${r.status}）：需要 Car-Radar 的 Contents「Read and write」權限`), { needToken: true });
    if (r.status === 409) throw new Error("檔案剛被改過，請重新整理頁面再試一次");
    if (!r.ok) throw new Error("GitHub 回應 " + r.status);
  }

  async function deleteIssue(id, btn) {
    const issue = D.issues.issues.find(x => x.id === id);
    const token = store.get(TOKEN_KEY);
    if (!token) { openPanel(); return; }
    btn.disabled = true; $("#delmsg").textContent = "刪除中…";
    try {
      const url = `https://api.github.com/repos/${REPO}/contents/issues/${encodeURIComponent(id)}.md`;
      const hdr = { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28" };
      const g = await fetch(url + "?ref=main&t=" + Date.now(), { headers: hdr });
      if (g.status === 404) throw new Error("GitHub 上找不到這個議題檔案（可能還在同步，稍後再試）");
      if (!g.ok) throw Object.assign(new Error(`權杖權限不足（${g.status}）`), { needToken: g.status === 401 || g.status === 403 });
      const { sha } = await g.json();
      const r = await fetch(url, { method: "DELETE", headers: hdr, body: JSON.stringify({ message: `議題：刪除「${issue.title}」`, sha, branch: "main" }) });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`權杖權限不足（${r.status}）：需要 Contents「Read and write」`), { needToken: true });
      if (!r.ok) throw new Error("GitHub 回應 " + r.status);
      D.issues.issues = D.issues.issues.filter(x => x.id !== id);
      S.open = ""; S.confirmDel = null; store.set("issue", "");
      renderIssues(); renderNews();
      msg(`已刪除「${esc(issue.title)}」。網站約 2 分鐘後同步。（GitHub 的 commit 紀錄裡還找得回來）`, "ok");
      setTimeout(() => { if ($("#refreshMsg").classList.contains("ok")) msg(""); }, 10000);
    } catch (err) {
      $("#delmsg").textContent = err.message; btn.disabled = false;
      if (err.needToken) openPanel();
    }
  }

  function applyLocal(issue, isNew) {
    issue.status_label = STATUS_LABEL[issue.status] || issue.status;
    issue._pending = true;
    D.issues = D.issues || { issues: [] };
    const arr = D.issues.issues;
    const idx = arr.findIndex(x => x.id === issue.id);
    if (idx >= 0) arr[idx] = issue; else arr.unshift(issue);
    S.editing = null; S.open = issue.id; store.set("issue", S.open);
    renderIssues();
    msg(`已存到 GitHub。網站約 2 分鐘後同步（${isNew ? "新議題" : "這次修改"}已先顯示在頁面上）。`, "ok");
    setTimeout(() => { if ($("#refreshMsg").classList.contains("ok")) msg(""); }, 10000);
  }

  async function withSave(fn) {
    const btn = document.querySelector("#issues form .primary");
    const fm = $("#fmsg");
    if (btn) btn.disabled = true;
    if (fm) fm.textContent = "儲存中…";
    try { await fn(); }
    catch (err) {
      if (fm) fm.textContent = err.message;
      if (err.needToken) openPanel();
    } finally { if (btn) btn.disabled = false; }
  }

  function saveIssueForm() {
    const title = $("#f-title").value.trim();
    if (!title) { $("#fmsg").textContent = "請填寫議題名稱"; $("#f-title").focus(); return; }
    const isNew = S.editing?.mode === "new";
    const old = isNew ? null : D.issues.issues.find(x => x.id === S.editing.id);
    let kw = $("#f-kw").value.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean);
    if (!kw.length) kw = suggestKeywords(title);
    const then = $("#f-then").value.trim();
    const today = todayTpe();
    let issue;
    if (isNew) {
      const id = "issue-" + today.replace(/-/g, "") + "-" + Date.now().toString(36).slice(-4);
      issue = { id, title, status: $("#f-status").value, since: today, keywords: kw, metric: $("#f-metric").value,
        then: then || "（新議題：寫下你一開始的判斷）", now: "（還沒寫）",
        entries: then ? [{ date: today, label: "我的判斷", text: then }] : [{ date: today, label: "開始追蹤", text: "開始追蹤這個議題。" }] };
    } else {
      const now = $("#f-now").value.trim();
      issue = { ...old, title, status: $("#f-status").value, keywords: kw, metric: $("#f-metric").value,
        then: then || old.then, now: now || old.now, entries: [...old.entries] };
      if (now && $("#f-log").checked && now !== old.now) issue.entries.push({ date: today, label: "回顧", text: now });
    }
    withSave(async () => {
      await saveToGitHub(issue, isNew ? `議題：新增「${title}」` : `議題：更新「${title}」`);
      applyLocal(issue, isNew);
    });
  }

  function saveEntryForm() {
    const text = $("#e-text").value.trim();
    if (!text) { $("#fmsg").textContent = "請填寫內容"; $("#e-text").focus(); return; }
    const old = D.issues.issues.find(x => x.id === S.editing.id);
    const entry = { date: $("#e-date").value || todayTpe(), label: $("#e-label").value.trim() || "筆記", text };
    const issue = { ...old, entries: [...old.entries, entry].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0) };
    withSave(async () => {
      await saveToGitHub(issue, `議題：「${old.title}」新增紀錄`);
      applyLocal(issue, false);
    });
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

  // ── 車企版圖：銷量 × 市值 ──
  const REGIONS = ["中國", "歐洲", "美國", "日韓"];
  const RCOLOR = { "中國": "var(--r-cn)", "歐洲": "var(--r-eu)", "美國": "var(--r-us)", "日韓": "var(--r-jk)" };
  const usd = v => {
    if (v == null) return "—";
    if (v >= 1e12) return "$" + nf(v / 1e12, 2) + " 兆";
    if (v >= 1e8) return "$" + nf(v / 1e8, v >= 1e11 ? 0 : 1) + " 億";
    return "$" + nf(v);
  };
  const units = v => v == null ? "—" : (v >= 1e4 ? nf(v / 1e4, 1) + " 萬" : nf(v));

  function capChange(c, days) {
    const h = c.cap_hist || [];
    if (h.length < 2) return null;
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const base = [...h].reverse().find(x => x[0] <= cutoff);
    if (!base) return null;
    return (h.at(-1)[1] - base[1]) / base[1] * 100;
  }

  // 最近 4 季每車營業利益的小長條：綠＝獲利、紅＝虧損，中線＝0
  function miniBars(series) {
    const vals = series.map(x => x.v).filter(v => v != null);
    if (vals.length < 2) return "";
    const m = Math.max(...vals.map(Math.abs)) || 1, W = 64, H = 26, bw = W / series.length;
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)"/>${series.map((x, i) => {
      if (x.v == null) return "";
      const h = Math.max(1, Math.abs(x.v) / m * (H / 2 - 1));
      return `<rect x="${i * bw + 2}" width="${bw - 4}" y="${x.v >= 0 ? H / 2 - h : H / 2}" height="${h}" fill="var(${x.v >= 0 ? "--up" : "--down"})"><title>${x.q}：${x.v < 0 ? "−" : ""}${usd(Math.abs(x.v))}</title></rect>`;
    }).join("")}</svg>`;
  }

  function renderMarket() {
    const aspBy = Object.fromEntries((D.asp?.companies || []).map(a => [a.name, a]));
    const all = (D.market?.companies || []).map(c => {
      const a = aspBy[c.name];
      const qs = (a?.quarters || []).filter(q => q.asp_usd != null || q.profit_usd != null).sort((x, y) => x.quarter < y.quarter ? -1 : 1);
      const lastA = [...qs].reverse().find(q => q.asp_usd != null), lastP = [...qs].reverse().find(q => q.profit_usd != null);
      return { ...c, units: c.sales?.units ?? null, perCar: c.cap_usd && c.sales?.units ? c.cap_usd / c.sales.units : null,
        aspNote: a?.note || "", asp: lastA?.asp_usd ?? null, aspQ: lastA?.quarter, profit: lastP?.profit_usd ?? null, profitQ: lastP?.quarter,
        pSeries: qs.slice(-4).map(q => ({ q: q.quarter, v: q.profit_usd })) };
    });
    const ok = all.filter(c => c.cap_usd && c.units);
    if (!ok.length) {
      $("#regionCards").innerHTML = `<p class="empty">市值資料還沒抓到。下一次自動更新（或按手動更新）後就會出現；銷量已在 data/manual/sales_annual.csv。</p>`;
      $("#shareBars").innerHTML = ""; $("#scatter").innerHTML = ""; $("#mktTable").innerHTML = ""; $("#mktFoot").textContent = ""; return;
    }
    const year = Math.max(...ok.map(c => c.sales.year));
    const totU = ok.reduce((a, c) => a + c.units, 0), totC = ok.reduce((a, c) => a + c.cap_usd, 0);
    const reg = REGIONS.map(r => {
      const cs = ok.filter(c => c.region === r);
      const u = cs.reduce((a, c) => a + c.units, 0), cap = cs.reduce((a, c) => a + c.cap_usd, 0);
      return { r, n: cs.length, u, cap, per: u ? cap / u : null, top: [...cs].sort((a, b) => b.cap_usd - a.cap_usd)[0] };
    });
    $("#mapMeta").textContent = `${year} 年銷量・市值 ${shortTime(D.market.updated)}`;

    // 地區卡片
    $("#regionCards").innerHTML = reg.map(g => `<div class="rcard" style="--rc:${RCOLOR[g.r]}">
      <div class="rhead"><span class="dot"></span><b>${g.r}品牌</b><span class="muted small">${g.n} 家</span></div>
      <dl>
        <div><dt>${year} 銷量</dt><dd>${units(g.u)}<small> 輛</small></dd></div>
        <div><dt>市值合計</dt><dd>${usd(g.cap)}</dd></div>
        <div><dt>每賣一輛車的市值<button type="button" class="term" data-term="perCar" aria-label="說明">ⓘ</button></dt><dd>${usd(g.per)}</dd></div>
        <div><dt>市值最高</dt><dd class="small">${esc(g.top?.name || "—")}</dd></div>
      </dl></div>`).join("");

    // 份額對照：銷量 vs 市值
    const bar = (label, key, tot) => `<div class="sbar"><span class="slabel">${label}</span><div class="strack">${reg.map(g => {
      const p = g[key] / tot * 100;
      return `<span style="width:${p}%;background:${RCOLOR[g.r]}" title="${g.r} ${p.toFixed(1)}%">${p >= 7 ? `${g.r} ${p.toFixed(0)}%` : ""}</span>`;
    }).join("")}</div></div>`;
    $("#shareBars").innerHTML = bar("銷量份額", "u", totU) + bar("市值份額", "cap", totC) +
      `<p class="foot">只計算下表追蹤的 ${ok.length} 家車企／集團。兩條長度一樣時，代表市場給的估值與賣車規模相當；市值份額明顯大於銷量份額，代表市場給了更高的估值溢價。</p>`;

    // 散布圖：x = 銷量、y = 市值（對數座標），斜虛線 = 每輛車市值
    const W = 720, H = 420, L = 78, R = 44, T = 16, B = 40;
    const tickU = v => v >= 1e4 ? nf(v / 1e4, 0) + " 萬" : nf(v);
    const tickC = v => v >= 1e12 ? "$" + nf(v / 1e12, 0) + " 兆" : "$" + nf(v / 1e8, 0) + " 億";
    const lx = Math.log10, xs = ok.map(c => lx(c.units)), ys = ok.map(c => lx(c.cap_usd));
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs) + 0.15), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys) + 0.05);
    const X = v => L + (lx(v) - x0) / (x1 - x0) * (W - L - R), Y = v => T + (y1 - lx(v)) / (y1 - y0) * (H - T - B);
    const xt = []; for (let e = x0; e <= x1; e++) xt.push(10 ** e);
    const yt = []; for (let e = y0; e <= y1; e++) yt.push(10 ** e);
    const iso = [1e4, 1e5, 1e6].map(per => {
      // cap = per × units；畫在可視範圍內
      const ua = 10 ** x0, ub = 10 ** x1;
      let p1 = [ua, per * ua], p2 = [ub, per * ub];
      const clip = (u, c) => [Math.min(Math.max(u, 10 ** x0), 10 ** x1), c];
      if (p1[1] < 10 ** y0) p1 = [10 ** y0 / per, 10 ** y0];
      if (p2[1] > 10 ** y1) p2 = [10 ** y1 / per, 10 ** y1];
      if (p1[0] >= p2[0]) return "";
      p1 = clip(...p1); p2 = clip(...p2);
      return `<line x1="${X(p1[0])}" y1="${Y(p1[1])}" x2="${X(p2[0])}" y2="${Y(p2[1])}" stroke="var(--muted)" stroke-dasharray="3 4" opacity=".55"/>
        <text x="${X(p2[0]) - 4}" y="${Y(p2[1]) + 12}" text-anchor="end" font-size="10.5" fill="var(--muted)">每輛 ${usd(per)}</text>`;
    }).join("");
    const pts = [...ok].sort((a, b) => b.cap_usd - a.cap_usd);
    // 標籤避讓：依市值由大到小放，跟已放的標籤或點重疊就改放左邊，再不行就只留滑鼠提示
    const boxes = pts.map(c => ({ x: X(c.units) - 6, y: Y(c.cap_usd) - 6, w: 12, h: 12 }));
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const labelOf = c => c.name.replace(/ (Group|Motor Group)$/, "");
    const tw = t => [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 11 : 6.3), 0);
    const placed = [];
    const lab = new Map();
    pts.forEach((c, i) => {
      const t = labelOf(c), w = tw(t), cx = X(c.units), cy = Y(c.cap_usd);
      for (const [lx, anchor] of [[cx + 9, "start"], [cx - 9, "end"]]) {
        const box = { x: anchor === "start" ? lx : lx - w, y: cy - 8, w, h: 14 };
        if (box.x < L || box.x + w > W - 2) continue;
        if (placed.some(b => hit(b, box)) || boxes.some((b, j) => j !== i && hit(b, box))) continue;
        placed.push(box); lab.set(c.name, { lx, anchor, t }); break;
      }
    });
    $("#scatter").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="各車企銷量與市值散布圖">
      ${xt.map(v => `<line x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}" stroke="var(--line)"/><text x="${X(v)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="var(--muted)">${tickU(v)}</text>`).join("")}
      ${yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${tickC(v)}</text>`).join("")}
      <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" font-size="11.5" fill="var(--muted)">${year} 年銷量（輛，對數刻度）→</text>
      <text x="12" y="${(T + H - B) / 2}" text-anchor="middle" font-size="11.5" fill="var(--muted)" transform="rotate(-90 12 ${(T + H - B) / 2})">市值（美元，對數刻度）→</text>
      ${iso}
      ${pts.map(c => `<g class="pt"><title>${esc(c.name)}｜銷量 ${units(c.units)} 輛｜市值 ${usd(c.cap_usd)}｜每輛 ${usd(c.perCar)}</title>
        <circle cx="${X(c.units)}" cy="${Y(c.cap_usd)}" r="6" fill="${RCOLOR[c.region]}" stroke="var(--surface)" stroke-width="1.5"/>
        ${lab.has(c.name) ? `<text x="${lab.get(c.name).lx}" y="${Y(c.cap_usd) + 4}" text-anchor="${lab.get(c.name).anchor}" font-size="11" fill="var(--fg)">${esc(lab.get(c.name).t)}</text>` : ""}</g>`).join("")}
    </svg>
    <div class="legend">${REGIONS.map(r => `<span><i style="background:${RCOLOR[r]};border-radius:50%;width:9px;height:9px"></i>${r}</span>`).join("")}<span>虛線：每賣一輛車對應的市值</span><span>擠在一起的點沒有名字，滑鼠移上去可看</span></div>`;

    // 表格
    const rank = (arr, k) => Object.fromEntries([...arr].sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1)).map((c, i) => [c.name, i + 1]));
    const rU = rank(all, "units"), rC = rank(all, "cap_usd");
    const key = S.mktSort || "units";
    const filt = S.mktRegion || "全部";
    const rows = all.filter(c => filt === "全部" || c.region === filt).sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1));
    const maxPer = Math.max(...ok.map(c => c.perCar));
    $("#mktTools").innerHTML = `<div class="tabs" role="tablist">${["全部", ...REGIONS].map(r => `<button role="tab" aria-selected="${r === filt}" data-mr="${r}">${r}</button>`).join("")}</div>
      <div class="seg" role="tablist">${[["units", "依銷量"], ["cap_usd", "依市值"], ["perCar", "依每輛市值"], ["asp", "依每車售價"], ["profit", "依每車利益"]].map(([k, l]) => `<button role="tab" data-ms="${k}" aria-selected="${k === key}">${l}</button>`).join("")}</div>`;
    $("#mktTable").innerHTML = `<thead><tr><th>車企／集團</th><th>地區</th><th>${year} 銷量<button type="button" class="term" data-term="sales" aria-label="說明">ⓘ</button></th><th>市值（USD）<button type="button" class="term" data-term="cap" aria-label="說明">ⓘ</button></th><th>每賣一輛車的市值<button type="button" class="term" data-term="perCar" aria-label="說明">ⓘ</button></th><th>每車平均售價<button type="button" class="term" data-term="asp" aria-label="說明">ⓘ</button></th><th>每車營業利益<button type="button" class="term" data-term="profit" aria-label="說明">ⓘ</button></th><th>市值 30 天<button type="button" class="term" data-term="cap30" aria-label="說明">ⓘ</button></th></tr></thead><tbody>` +
      rows.map(c => {
        const ch = capChange(c, 30);
        return `<tr><td class="co"><b>${esc(c.name)}</b><span>${esc(c.brands)}</span></td>
          <td><span class="rchip" style="--rc:${RCOLOR[c.region]}">${esc(c.region)}</span></td>
          <td class="cell" title="${esc((c.sales?.metric || "") + (c.sales?.note ? "；" + c.sales.note : ""))}">${units(c.units)}<span class="rank">#${rU[c.name]}</span></td>
          <td class="cell">${usd(c.cap_usd)}<span class="rank">#${rC[c.name]}</span></td>
          <td class="cell">${usd(c.perCar)}<span class="bar"><i style="left:0;width:${c.perCar ? Math.max(1, c.perCar / maxPer * 100) : 0}%;background:${RCOLOR[c.region]}"></i></span></td>
          ${c.asp != null ? `<td class="cell" title="${esc(c.aspNote)}">${usd(c.asp)}<span class="rank">${esc(c.aspQ.replace("Q", " Q"))}</span></td>` : `<td class="cell na" title="這家公司還沒有季度交車量，可在 config/settings.yml 的 asp_companies 加入">未追蹤</td>`}
          ${c.profit != null ? `<td class="cell ${c.profit < 0 ? "down" : "up"}" title="${esc(c.aspNote)}">${c.profit < 0 ? "−" : ""}${usd(Math.abs(c.profit))}${miniBars(c.pSeries)}<span class="rank">${esc(c.profitQ.replace("Q", " Q"))}</span></td>` : `<td class="cell na">${c.asp != null ? "缺財報" : "未追蹤"}</td>`}
          <td class="cell ${ch == null ? "na" : ch > 0 ? "up" : "down"}">${ch == null ? "累積中" : (ch > 0 ? "▲ " : "▼ ") + Math.abs(ch).toFixed(1) + "%"}</td></tr>`;
      }).join("") + "</tbody>";
    $("#mktTools").querySelectorAll("[data-mr]").forEach(b => b.onclick = () => { S.mktRegion = b.dataset.mr; renderMarket(); });
    $("#mktTools").querySelectorAll("[data-ms]").forEach(b => b.onclick = () => { S.mktSort = b.dataset.ms; renderMarket(); });
    $("#mktFoot").innerHTML = `銷量：各公司 ${year} 年官方公布數字（口徑不同：有的是交車、有的是批發或含合資，滑鼠移到銷量上可看說明），在 <code>data/manual/sales_annual.csv</code> 每年補一次。
      市值：Yahoo Finance 每天更新，用最新匯率換成美元；現代集團為現代＋起亞市值相加。小米市值含手機業務、福斯含保時捷股份，每輛市值會偏高。「市值 30 天」需要累積一個月的每日資料才會出現。`;
  }

  // ── 名詞小字典：滑鼠移到 ⓘ 上出現說明，移走就消失（手機點一下） ──
  const GLOSSARY = {
    perCar: () => {
      const cs = (D.market?.companies || []).filter(c => c.cap_usd && c.sales?.units);
      const ex = cs.find(c => c.name === "BYD") || cs[0];
      const sorted = [...cs].sort((a, b) => b.cap_usd / b.sales.units - a.cap_usd / a.sales.units);
      const hi = sorted[0], lo = sorted.at(-1);
      const per = c => usd(c.cap_usd / c.sales.units);
      return `<b>每賣一輛車的市值</b> = 市值 ÷ 一年賣出的車數
        ${ex ? `<div class="tip-ex">例：${esc(ex.name)} 市值 ${usd(ex.cap_usd)} ÷ ${units(ex.sales.units)} 輛 ≈ <b>${per(ex)}</b></div>` : ""}
        <p>股市替這家公司「每賣出一輛車」估了多少價值。<b>不是車價，也不是利潤</b>，而是估值溢價：同樣賣一輛車，投資人願意為誰付比較多。</p>
        <ul><li><b>高</b>：市場看的是賣車以外的題材（AI、自駕、能源）${hi ? `，目前最高是 ${esc(hi.name)}（${per(hi)}）` : ""}</li>
        <li><b>低</b>：賣很多車但市場覺得獲利薄、成長有限${lo ? `，目前最低是 ${esc(lo.name)}（${per(lo)}）` : ""}</li></ul>
        <p class="tip-note">市值含公司所有業務（小米含手機、BYD 含電池）；銷量含合資的（上汽、長安）分母較大，數字會偏低。適合搭配「每車營業利益」一起看。長條是和全表最高者的比例。</p>`;
    },
    sales: () => `<b>年銷量</b>：各公司官方公布的全年數字。
      <p>口徑不完全相同：有的是交車（交到客人手上）、有的是批發（賣給經銷商），上汽、廣汽、長安含合資品牌，GM 是全球批發。滑鼠移到每一格的數字上可以看該公司的口徑。</p>
      <p class="tip-note">資料在 data/manual/sales_annual.csv，每年一月各家公布後補一次。</p>`,
    cap: () => `<b>市值</b> = 股價 × 流通股數，代表股市此刻對整家公司的定價。
      <p>每天從 Yahoo Finance 更新，用最新匯率換成美元，方便跨國比較。現代集團是現代＋起亞相加。</p>
      <p class="tip-note">匯率變動也會讓美元市值變化，即使當地股價沒動。</p>`,
    asp: () => {
      const cs = (D.asp?.companies || []).map(c => ({ c, q: [...c.quarters].reverse().find(q => q.asp_usd != null && q.revenue) })).filter(x => x.q);
      const ex = cs.find(x => x.c.name === "Tesla") || cs[0];
      return `<b>每車平均售價（ASP）</b> = 一季營收 ÷ 那一季交車量，換成美元。
        ${ex ? `<div class="tip-ex">例：${esc(ex.c.name)} ${ex.q.quarter} 營收 ${big(ex.q.revenue)} ${ex.q.currency} ÷ ${units(ex.q.deliveries)} 輛 ≈ <b>${usd(ex.q.asp_usd)}</b></div>` : ""}
        <p>看車企賣的是便宜車還是高價車、價格戰有沒有把均價壓下來。</p>
        <p class="tip-note">用全公司營收估算：Tesla 含能源業務、BYD 含代工，會偏高；小米只用汽車分部。顯示的是最近一季有資料的數字。</p>`;
    },
    profit: () => {
      const cs = (D.asp?.companies || []).map(c => ({ c, q: [...c.quarters].reverse().find(q => q.profit_usd != null) })).filter(x => x.q);
      const ex = cs.find(x => x.c.name === "Toyota") || cs[0];
      return `<b>每車營業利益</b> = 一季營業利益 ÷ 那一季交車量，換成美元。
        ${ex ? `<div class="tip-ex">例：${esc(ex.c.name)} ${ex.q.quarter} 營業利益 ${big(ex.q.operating_income)} ${ex.q.currency} ÷ ${units(ex.q.deliveries)} 輛 ≈ <b>${usd(ex.q.profit_usd)}</b></div>` : ""}
        <p>每賣一輛車實際賺（或虧）多少。<span class="up">綠色</span>獲利、<span class="down">紅色</span>虧損；右邊小長條是最近 4 季的變化，中線是 0。</p>
        <p class="tip-note">和「每賣一輛車的市值」對照：利潤低但市值高＝市場在押未來；利潤高但市值低＝可能被低估。「未追蹤」代表這家還沒有季度交車量。</p>`;
    },
    cap30: () => `<b>市值 30 天</b>：和 30 天前相比，美元市值漲跌幾 %。
      <p>綠色 ▲ 上漲、紅色 ▼ 下跌。從開始追蹤那天起每天記錄一次，滿一個月才會出現數字，之前顯示「累積中」。</p>`,
  };
  const tip = document.createElement("div");
  tip.className = "tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;
  function showTip(el) {
    const f = GLOSSARY[el.dataset.term];
    if (!f) return;
    tipFor = el;
    tip.innerHTML = f();
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.hidden = true; tipFor = null; }
  document.addEventListener("mouseover", e => { const t = e.target.closest?.(".term"); if (t && t !== tipFor) showTip(t); });
  document.addEventListener("mouseout", e => { const t = e.target.closest?.(".term"); if (t && !t.contains(e.relatedTarget)) hideTip(); });
  document.addEventListener("focusin", e => { if (e.target.classList?.contains("term")) showTip(e.target); });
  document.addEventListener("focusout", e => { if (e.target.classList?.contains("term")) hideTip(); });
  document.addEventListener("click", e => { const t = e.target.closest?.(".term"); if (t) { e.preventDefault(); tipFor === t ? hideTip() : showTip(t); } else if (!e.target.closest?.(".tip")) hideTip(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") hideTip(); });
  window.addEventListener("scroll", hideTip, { passive: true });

  async function init() {
    const [status, nev, stocks, asp, news, issues, brief, history, feed, market] = await Promise.all([
      get("data/status.json", null), get("data/metrics/cn_nev.json", null), get("data/metrics/stocks.json", null),
      get("data/metrics/asp.json", null), get("data/news/latest.json", null), get("data/issues.json", null),
      get("data/brief.json", null), get("data/brief_history.json", null), get("data/issue_feed.json", null),
      get("data/metrics/market.json", null)
    ]);
    D = { status, nev, stocks, asp, news, issues, brief, history, feed, market };
    $("#alert").hidden = true;
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
    renderMarket();
    renderNews();
    renderIssues();
  }
  init();
  $("#newIssueBtn").onclick = () => { S.editing = { mode: "new" }; S.open = ""; renderIssues(); $("#f-title")?.focus(); };

  // ── 手動更新：用 GitHub API 觸發 workflow，跑完自動重新載入資料 ──
  const API = `https://api.github.com/repos/${REPO}/actions`;
  const WF = "daily.yml";
  const TOKEN_KEY = "car-radar-gh-token";
  let busy = false;
  const msg = (text, cls = "") => {
    const el = $("#refreshMsg");
    el.hidden = !text; el.className = "refresh-msg " + cls; el.innerHTML = text;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const gh = (path, token, opts = {}) => fetch(API + path, {
    ...opts,
    headers: { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) }
  });

  function openPanel() {
    if (!$("#refreshPanel").open) $("#refreshPanel").showModal();
    $("#tokenClear").hidden = !store.get(TOKEN_KEY);
    $("#tokenInput").value = "";
    $("#tokenInput").focus();
  }

  async function runRefresh() {
    const token = store.get(TOKEN_KEY);
    if (!token) { openPanel(); return; }
    if ($("#refreshPanel").open) $("#refreshPanel").close();
    if (busy) return;
    busy = true; $("#refreshBtn").disabled = true;
    const started = Date.now();
    try {
      msg("正在請 GitHub 開始更新…");
      const r = await gh(`/workflows/${WF}/dispatches`, token, { method: "POST", body: JSON.stringify({ ref: "main" }) });
      if (r.status === 401 || r.status === 403 || r.status === 404) {
        msg(`權杖無效或權限不足（${r.status}）。請重新設定：需要 Car-Radar 的 Actions 和 Contents「Read and write」權限。`, "err");
        openPanel(); return;
      }
      if (r.status !== 204) throw new Error("GitHub 回應 " + r.status);
      let run = null;
      for (let i = 0; i < 80; i++) {          // 最多等約 10 分鐘
        await sleep(i < 4 ? 4000 : 8000);
        const res = await gh(`/workflows/${WF}/runs?event=workflow_dispatch&per_page=5`, token);
        if (!res.ok) continue;
        const runs = (await res.json()).workflow_runs || [];
        run = runs.find(x => new Date(x.created_at).getTime() >= started - 60000) || run;
        const secs = Math.round((Date.now() - started) / 1000);
        if (!run) { msg(`等待 GitHub 排入工作…（${secs} 秒）`); continue; }
        if (run.status !== "completed") {
          msg(`更新中：抓股價、財報、新聞，接著部署網頁（${secs} 秒，通常 1–2 分鐘）。<a href="${safeUrl(run.html_url)}" target="_blank" rel="noopener">看進度</a>`);
          continue;
        }
        if (run.conclusion === "success") {
          await sleep(5000);
          await init();
          msg("更新完成，已載入最新資料。", "ok");
          setTimeout(() => { if ($("#refreshMsg").classList.contains("ok")) msg(""); }, 8000);
        } else {
          msg(`更新失敗（${esc(run.conclusion)}）。<a href="${safeUrl(run.html_url)}" target="_blank" rel="noopener">點這裡看錯誤紀錄</a>`, "err");
        }
        return;
      }
      msg(`等太久了，請到 <a href="https://github.com/${REPO}/actions" target="_blank" rel="noopener">Actions 頁面</a> 看狀態。`, "err");
    } catch (e) {
      msg("無法連到 GitHub：" + esc(e.message) + "。請稍後再試。", "err");
    } finally {
      busy = false; $("#refreshBtn").disabled = false;
    }
  }

  $("#refreshBtn").onclick = runRefresh;
  const closePanel = () => { if ($("#refreshPanel").open) $("#refreshPanel").close(); };
  $("#tokenBtn").onclick = openPanel;
  $("#tokenCancel").onclick = closePanel;
  $("#tokenX").onclick = closePanel;
  $("#refreshPanel").addEventListener("click", e => { if (e.target === $("#refreshPanel")) closePanel(); });  // 點背景關閉
  $("#tokenClear").onclick = () => { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { } $("#tokenClear").hidden = true; msg("已清除這台電腦上的權杖。", "ok"); };
  $("#tokenSave").onclick = () => {
    const v = $("#tokenInput").value.trim();
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v)) { msg("這看起來不是 GitHub 權杖，應該以 github_pat_ 開頭。", "err"); return; }
    store.set(TOKEN_KEY, v);
    $("#tokenInput").value = "";
    if ($("#refreshPanel").open) $("#refreshPanel").close();
    runRefresh();
  };
  $("#tokenInput").addEventListener("keydown", e => { if (e.key === "Enter") $("#tokenSave").click(); });
})();
