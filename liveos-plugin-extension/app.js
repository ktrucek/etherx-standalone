const viewConfig = {
  dashboard: {
    title: "LiveOS Plugin Dashboard",
    subtitle: "Separate dashboard plugin layout for LiveOS analytics",
    panels: ["trend-panel", "gift-panel", "chat-panel", "supporters-panel", "sentiment-panel", "music-panel", "insights-panel", "timeline-panel", "health-panel", "actions-panel"]
  },
  sessions: {
    title: "Live Sessions",
    subtitle: "Session flow, health and live activity across the stream.",
    panels: ["trend-panel", "timeline-panel", "health-panel", "chat-panel"]
  },
  analytics: {
    title: "Analytics",
    subtitle: "Trend, sentiment and recommendations for better engagement.",
    panels: ["trend-panel", "sentiment-panel", "insights-panel", "health-panel"]
  },
  users: {
    title: "Users",
    subtitle: "Supporters, chat audience and user-focused actions.",
    panels: ["supporters-panel", "chat-panel", "actions-panel"]
  },
  gifts: {
    title: "Gifts",
    subtitle: "Gift distribution, top gifters and event timeline.",
    panels: ["gift-panel", "supporters-panel", "timeline-panel"]
  },
  chat: {
    title: "Chat AI",
    subtitle: "Chat feed, response flow and AI guidance.",
    panels: ["chat-panel", "insights-panel", "actions-panel"]
  },
  music: {
    title: "Music & BPM",
    subtitle: "Track timing, mood fit and music-driven engagement.",
    panels: ["music-panel", "sentiment-panel", "insights-panel"]
  },
  scanner: {
    title: "Content Scanner",
    subtitle: "Scan actions, timeline events and AI content insights.",
    panels: ["actions-panel", "timeline-panel", "insights-panel"]
  },
  alerts: {
    title: "Alerts",
    subtitle: "Watch anomalies, retention drops and system health warnings.",
    panels: ["insights-panel", "health-panel", "timeline-panel"]
  },
  automations: {
    title: "Automations",
    subtitle: "Quick automation entry points and execution health.",
    panels: ["actions-panel", "health-panel", "chat-panel"]
  },
  tools: {
    title: "AI Tools",
    subtitle: "Focused AI controls for summaries, scans and content actions.",
    panels: ["actions-panel", "insights-panel", "chat-panel"]
  },
  settings: {
    title: "Settings",
    subtitle: "Plugin status, controls and operational overview.",
    panels: ["health-panel", "actions-panel", "supporters-panel"]
  }
};

const navKeyMap = {
  "Plugin Dashboard": "dashboard",
  "Live Sessions": "sessions",
  "Analytics": "analytics",
  "Users": "users",
  "Gifts": "gifts",
  "Chat AI": "chat",
  "Music & BPM": "music",
  "Content Scanner": "scanner",
  "Alerts": "alerts",
  "Automations": "automations",
  "AI Tools": "tools",
  "Settings": "settings"
};

const actionRoutes = {
  "⌕ Scan User": "users",
  "✦ AI Summary": "tools",
  "⇪ Export Data": "dashboard",
  "◎ Shadowban Check": "alerts",
  "⇄ Translate All": "chat",
  "♫ Music ID": "music",
  "◌ User Profile": "users",
  "⟡ Gift Analysis": "gifts",
  "▣ Content Report": "scanner"
};

const chartData = {
  "1H": {
    area: "M0 224 C52 196,96 205,142 180 S240 122,286 130 S372 86,416 92 S512 76,560 120 S612 180,640 150 L640 260 L0 260 Z",
    line: "M0 224 C52 196,96 205,142 180 S240 122,286 130 S372 86,416 92 S512 76,560 120 S612 180,640 150",
    peak: "Peak: 612 viewers",
    labels: ["00m", "10m", "20m", "30m", "40m", "50m"]
  },
  "6H": {
    area: "M0 210 C40 160,80 190,120 165 S200 110,240 125 S320 80,360 90 S440 65,500 95 S575 200,640 155 L640 260 L0 260 Z",
    line: "M0 210 C40 160,80 190,120 165 S200 110,240 125 S320 80,360 90 S440 65,500 95 S575 200,640 155",
    peak: "Peak: 997 viewers",
    labels: ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00"]
  },
  "24H": {
    area: "M0 232 C44 222,86 198,126 176 S206 98,252 112 S338 146,382 138 S466 78,512 96 S594 154,640 132 L640 260 L0 260 Z",
    line: "M0 232 C44 222,86 198,126 176 S206 98,252 112 S338 146,382 138 S466 78,512 96 S594 154,640 132",
    peak: "Peak: 1.4K viewers",
    labels: ["00", "04", "08", "12", "16", "20"]
  },
  "7D": {
    area: "M0 240 C70 210,122 148,182 138 S286 176,336 160 S434 92,486 104 S566 118,640 96 L640 260 L0 260 Z",
    line: "M0 240 C70 210,122 148,182 138 S286 176,336 160 S434 92,486 104 S566 118,640 96",
    peak: "Peak: 2.1K viewers",
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  }
};

const bars = Array.from({ length: 52 }, (_, index) => {
  const base = 18 + Math.abs(Math.sin(index * 0.52)) * 42;
  const pulse = index % 6 === 0 ? 10 : 0;
  return Math.round(base + pulse + (index % 4) * 3);
});

const waveform = document.getElementById("waveform");
if (waveform) {
  bars.forEach((height, index) => {
    const bar = document.createElement("span");
    bar.style.height = `${height}px`;
    if (index % 7 === 0) bar.style.background = "linear-gradient(180deg, #64d9ff, #844dff)";
    waveform.appendChild(bar);
  });
}

const dateNode = document.getElementById("currentDate");
if (dateNode) {
  const now = new Date();
  dateNode.textContent = now.toLocaleDateString("hr-HR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

const titleNode = document.querySelector(".page-title-row h1");
const subtitleNode = document.querySelector(".topbar > div > p");
const metricCards = Array.from(document.querySelectorAll(".metric-card"));
const navButtons = Array.from(document.querySelectorAll(".sidebar-nav .nav-item"));
const panelMap = new Map(Array.from(document.querySelectorAll(".content-grid > .panel")).map((panel) => {
  const match = Array.from(panel.classList).find((cls) => cls.endsWith("-panel") && cls !== "panel");
  return [match, panel];
}));

function showToast(message) {
  let host = document.getElementById("pluginToast");
  if (!host) {
    host = document.createElement("div");
    host.id = "pluginToast";
    host.className = "plugin-toast";
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => host.classList.remove("show"), 2200);
}

function setView(key) {
  const conf = viewConfig[key] || viewConfig.dashboard;
  navButtons.forEach((button) => {
    const label = button.textContent.replace(/^[^A-Za-z]+/, "").trim();
    button.classList.toggle("active", navKeyMap[label] === key);
  });
  panelMap.forEach((panel, panelKey) => {
    panel.classList.toggle("hidden-by-view", !conf.panels.includes(panelKey));
  });
  if (titleNode) titleNode.textContent = conf.title;
  if (subtitleNode) subtitleNode.textContent = conf.subtitle;
}

navButtons.forEach((button) => {
  const label = button.textContent.replace(/^[^A-Za-z]+/, "").trim();
  const key = navKeyMap[label] || "dashboard";
  button.dataset.viewKey = key;
  button.addEventListener("click", () => setView(key));
});

metricCards.forEach((card) => {
  card.addEventListener("click", () => {
    const label = card.querySelector(".metric-label")?.textContent?.trim() || "Metric";
    const route = /Viewers/i.test(label) ? "analytics"
      : /Gift/i.test(label) ? "gifts"
      : /Supporters/i.test(label) ? "users"
      : "sessions";
    setView(route);
    showToast(`${label} focus opened`);
  });
});

Array.from(document.querySelectorAll(".segmented")).forEach((group) => {
  const buttons = Array.from(group.querySelectorAll("button"));
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((node) => node.classList.toggle("active", node === button));
      const chart = group.closest(".trend-panel")?.querySelector(".chart-line");
      const selected = button.textContent.trim();
      const conf = chartData[selected];
      if (chart && conf) {
        const area = chart.querySelector(".area-path");
        const line = chart.querySelector(".line-path");
        const peak = chart.querySelector(".chart-label.peak");
        const axis = chart.querySelector(".chart-axis");
        if (area) area.setAttribute("d", conf.area);
        if (line) line.setAttribute("d", conf.line);
        if (peak) peak.textContent = conf.peak;
        if (axis) axis.innerHTML = conf.labels.map((item) => `<span>${item}</span>`).join("");
      }
      showToast(`Range switched to ${selected}`);
    });
  });
});

const chatInput = document.querySelector(".chat-input-row input");
const chatSendButton = document.querySelector(".chat-input-row button");
const chatList = document.querySelector(".chat-list");
function sendChatMessage() {
  const value = String(chatInput?.value || "").trim();
  if (!value || !chatList) return;
  const row = document.createElement("div");
  row.className = "chat-item tone-green injected";
  row.innerHTML = `<span class="chat-user">You</span><span class="chat-event">${value}</span><small>now</small>`;
  chatList.prepend(row);
  if (chatInput) chatInput.value = "";
  showToast("Message pushed to feed");
}
chatSendButton?.addEventListener("click", sendChatMessage);
chatInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendChatMessage();
});

Array.from(document.querySelectorAll(".actions-grid button")).forEach((button) => {
  button.addEventListener("click", () => {
    const label = button.textContent.trim();
    const route = actionRoutes[label] || "dashboard";
    setView(route);
    showToast(`${label} opened`);
  });
});

Array.from(document.querySelectorAll(".ghost-btn.small, .tiny-actions button, .top-icons button, .profile-actions button")).forEach((button) => {
  button.addEventListener("click", () => {
    const label = button.textContent.trim() || "Action";
    showToast(`${label} triggered`);
  });
});

document.querySelector(".ghost-btn:not(.small)")?.addEventListener("click", () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    activeView: titleNode?.textContent || "LiveOS Plugin Dashboard",
    metrics: Array.from(document.querySelectorAll(".metric-card")).map((card) => ({
      label: card.querySelector(".metric-label")?.textContent?.trim() || "",
      value: card.querySelector("strong")?.textContent?.trim() || "",
      meta: card.querySelector("small")?.textContent?.trim() || ""
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `liveos-plugin-export-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Dashboard export created");
});

document.querySelector(".primary-btn")?.addEventListener("click", () => {
  setView("tools");
  showToast("Plugin tools opened");
});

document.querySelector(".search")?.addEventListener("click", () => {
  setView("dashboard");
  showToast("Quick search is visual only in this plugin build");
});

setView("dashboard");

const liveosViewState = { range: {}, drafts: {} };
const liveosMeta = {
  dashboard: { label: "Plugin Dashboard", title: "LiveOS Plugin Dashboard", subtitle: "Separate dashboard plugin layout for LiveOS analytics.", visible: ["trend-panel", "gift-panel", "chat-panel", "supporters-panel", "sentiment-panel", "music-panel", "insights-panel", "timeline-panel", "health-panel", "actions-panel"], range: "6H" },
  sessions: { label: "Live Sessions", title: "Live Sessions", subtitle: "Session flow, health and live activity across the stream.", visible: ["trend-panel", "chat-panel", "timeline-panel", "health-panel", "actions-panel"], range: "24H" },
  analytics: { label: "Analytics", title: "Analytics", subtitle: "Trend, sentiment and recommendations for better engagement.", visible: ["trend-panel", "gift-panel", "sentiment-panel", "insights-panel", "health-panel"], range: "7D" },
  users: { label: "Users", title: "Users", subtitle: "Supporters, chat audience and user-focused actions.", visible: ["chat-panel", "supporters-panel", "insights-panel", "actions-panel"], range: "1H" },
  gifts: { label: "Gifts", title: "Gifts", subtitle: "Gift distribution, top gifters and event timeline.", visible: ["gift-panel", "supporters-panel", "timeline-panel", "insights-panel", "actions-panel"], range: "6H" },
  chat: { label: "Chat AI", title: "Chat AI", subtitle: "Chat feed, response flow and AI guidance.", visible: ["chat-panel", "insights-panel", "timeline-panel", "actions-panel"], range: "1H" },
  music: { label: "Music & BPM", title: "Music & BPM", subtitle: "Track timing, mood fit and music-driven engagement.", visible: ["music-panel", "trend-panel", "sentiment-panel", "insights-panel", "actions-panel"], range: "24H" },
  scanner: { label: "Content Scanner", title: "Content Scanner", subtitle: "Scan actions, timeline events and AI content insights.", visible: ["actions-panel", "timeline-panel", "insights-panel", "health-panel"], range: "1H" },
  alerts: { label: "Alerts", title: "Alerts", subtitle: "Watch anomalies, retention drops and system health warnings.", visible: ["insights-panel", "timeline-panel", "health-panel", "actions-panel"], range: "24H" },
  automations: { label: "Automations", title: "Automations", subtitle: "Quick automation entry points and execution health.", visible: ["actions-panel", "health-panel", "timeline-panel", "insights-panel"], range: "24H" },
  tools: { label: "AI Tools", title: "AI Tools", subtitle: "Focused AI controls for summaries, scans and content actions.", visible: ["actions-panel", "chat-panel", "insights-panel", "health-panel"], range: "1H" },
  settings: { label: "Settings", title: "Settings", subtitle: "Plugin status, controls and operational overview.", visible: ["health-panel", "actions-panel", "insights-panel", "supporters-panel"], range: "7D" }
};
const liveosTargets = ["users", "tools", "dashboard", "alerts", "chat", "music", "users", "gifts", "scanner"];
const liveosDots = ["pink", "coral", "blue", "orange", "violet", "white"];
const liveosTones = ["tone-gold", "tone-blue", "tone-violet", "tone-green"];
function liveosEsc(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/\x27/g, "&#39;"); }
function liveosMetaFor(key) { return liveosMeta[key] || liveosMeta.dashboard; }
function liveosKeyFromLabel(label) { return Object.keys(liveosMeta).find((key) => liveosMeta[key].label === label) || "dashboard"; }
function liveosModel(key) {
  const meta = liveosMetaFor(key);
  const words = meta.label.replace(/&/g, "and").split(/\s+/).filter(Boolean);
  const first = words[0] || meta.label;
  const second = words[1] || "Flow";
  return {
    metrics: [
      { icon: "◷", label: `${first} Time`, value: `${2 + words.length}h ${10 + key.length}m`, meta: `${meta.label} runtime`, delta: "+12%" },
      { icon: "◌", label: `${first} Reach`, value: `${300 + key.length * 23}`, meta: `${second} active`, delta: "+9%" },
      { icon: "✦", label: `${second} Score`, value: `${72 + key.length}%`, meta: `${meta.label} quality`, delta: "+6%" },
      { icon: "⟡", label: `${first} Events`, value: `${18 + key.length}`, meta: `${meta.label} events`, delta: "+4" },
      { icon: "♡", label: `${first} Confidence`, value: `${84 + (key.length % 10)}%`, meta: `${meta.label} model`, delta: "Stable" }
    ],
    breakdown: [0,1,2,3,4,5].map((index) => ({ dot: liveosDots[index], name: `${index === 5 ? "Others" : (index === 0 ? first : second)} ${index === 5 ? "" : ["Core","Pulse","Lift","Boost","Mix"][index] || "Lane"}`.trim(), value: `${Math.max(1, key.length - (index % 3))}.${214 + index * 111}`, share: `${31 - index * 5}%` })),
    chat: [0,1,2,3].map((index) => ({ tone: liveosTones[index], user: `${index % 2 === 0 ? first : second}${["Lead","Desk","Ops","Flow"][index]}`, event: `${meta.label} ${["headline item needs attention","queue moved into active review","summary refreshed for the latest block","follow-up action prepared"][index]}`, time: ["now","35s","1m","2m"][index] })),
    leaders: [1,2,3,4,5].map((index) => ({ rank: String(index), name: `${first}${index}`, amount: `${20 + index * key.length}`, total: `${meta.label.toLowerCase()} signal` })),
    insights: [
      { cls: "good", text: `${meta.label} is strongest when the first 3 minutes stay interactive`, score: `${91 + (key.length % 7)}%` },
      { cls: "info", text: `${second} responses are driving the clearest lift in ${first.toLowerCase()} performance`, score: `${84 + (key.length % 6)}%` },
      { cls: "warn", text: `${meta.label} starts to soften when response gaps stay too long`, score: `${58 + (key.length % 9)}%` }
    ],
    timeline: [
      { text: `• ${meta.label} checkpoint captured for ${first.toLowerCase()} lane`, time: "now" },
      { text: `• ${second} flow updated with a fresh ${first.toLowerCase()} signal`, time: "2m ago" },
      { text: `• ${meta.label} action batch queued for execution`, time: "7m ago" },
      { text: `• ${meta.title} summary stored for the next review`, time: "12m ago" }
    ],
    health: [
      { label: `${first} Engine`, value: "Online", meta: "Good" },
      { label: `${second} Sync`, value: `${93 + (key.length % 6)}%`, meta: "Stable" },
      { label: `${first} Queue`, value: `${4 + (key.length % 5)}`, meta: "Light" },
      { label: `${meta.label} Uptime`, value: "99.1%", meta: "Healthy" }
    ],
    sentiment: { score: `${80 + (key.length % 9)}%`, mood: `${first} Positive`, rows: [{ label: "Positive", value: `${80 + (key.length % 9)}%` }, { label: "Neutral", value: `${12 - (key.length % 4)}%` }, { label: "Negative", value: `${4 + (key.length % 3)}%` }] },
    music: { track: `${meta.label} Pulse`, genre: `${first} lane`, bpm: `⟲ ${92 + key.length * 3}`, fit: `${second} fit` },
    actions: [`⌕ ${first} Scan`, `✦ ${second} Summary`, `⇪ Export ${first}`, `◎ ${first} Alerts`, `⇄ ${second} Translate`, `♫ ${first} Music`, `◌ ${second} Profile`, `⟡ ${first} Analysis`, `▣ ${second} Report`]
  };
}
function liveosRenderMetrics(model) {
  metricCards.forEach((card, index) => {
    const data = model.metrics[index];
    card.querySelector(".metric-icon").textContent = data.icon;
    card.querySelector(".metric-label").textContent = data.label;
    card.querySelector("strong").textContent = data.value;
    card.querySelector("small").textContent = data.meta;
    card.querySelector("em").textContent = data.delta;
  });
}
function liveosRenderTrend(meta) {
  const panel = panelMap.get("trend-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Trend`;
  panel.querySelector(".panel-head p").textContent = `${meta.label} movement across the active range`;
  const active = liveosViewState.range[state.view] || meta.range;
  panel.querySelector(".segmented").innerHTML = ["1H","6H","24H","7D"].map((range) => `<button class="${range === active ? "active" : ""}" data-range="${range}">${range}</button>`).join("");
  const conf = chartData[active] || chartData[meta.range] || chartData["6H"];
  panel.querySelector(".area-path")?.setAttribute("d", conf.area);
  panel.querySelector(".line-path")?.setAttribute("d", conf.line);
  const peak = panel.querySelector(".chart-label.peak"); if (peak) peak.textContent = conf.peak.replace("Peak", `${meta.label} peak`);
  const axis = panel.querySelector(".chart-axis"); if (axis) axis.innerHTML = conf.labels.map((label) => `<span>${label}</span>`).join("");
}
function liveosRenderGift(model, meta) {
  const panel = panelMap.get("gift-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Breakdown`;
  panel.querySelector(".panel-head p").textContent = `${model.breakdown.length} tracked slices for ${meta.label.toLowerCase()}`;
  panel.querySelector(".donut-hole strong").textContent = `${18 + meta.label.length}`;
  panel.querySelector(".legend").innerHTML = model.breakdown.map((item) => `<div><span class="dot ${item.dot}"></span><span class="legend-name">${liveosEsc(item.name)}</span><b>${liveosEsc(item.value)}</b><small>(${liveosEsc(item.share)})</small></div>`).join("");
}
function liveosRenderChat(model, meta) {
  const panel = panelMap.get("chat-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Feed`;
  panel.querySelector(".panel-head p").textContent = `${model.chat.length} active rows in ${meta.label.toLowerCase()}`;
  const drafts = liveosViewState.drafts[state.view] || [];
  panel.querySelector(".chat-list").innerHTML = drafts.concat(model.chat).map((row) => `<div class="chat-item ${row.tone} ${row.injected ? "injected" : ""}"><span class="chat-user">${liveosEsc(row.user)}</span><span class="chat-event">${liveosEsc(row.event)}</span><small>${liveosEsc(row.time)}</small></div>`).join("");
  const input = panel.querySelector(".chat-input-row input"); if (input) { input.value = ""; input.setAttribute("placeholder", `Type ${meta.label.toLowerCase()} note...`); }
}
function liveosRenderSupporters(model, meta) {
  const panel = panelMap.get("supporters-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Leaders`;
  panel.querySelector(".panel-head p").textContent = `Top ranked items for ${meta.label.toLowerCase()}`;
  const btn = panel.querySelector(".ghost-btn.small"); if (btn) btn.textContent = "Inspect";
  panel.querySelector(".supporters-list").innerHTML = model.leaders.map((row) => `<div class="row"><span class="rank">${row.rank}</span><span class="supporter-name">${liveosEsc(row.name)}</span><b>${liveosEsc(row.amount)}</b><small>${liveosEsc(row.total)}</small></div>`).join("");
}
function liveosRenderSentiment(model, meta) {
  const panel = panelMap.get("sentiment-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Sentiment`;
  panel.querySelector(".panel-head p").textContent = `${meta.label} mood and tone split`;
  panel.querySelector(".gauge-ring strong").textContent = model.sentiment.score;
  panel.querySelector(".gauge-ring span").textContent = model.sentiment.mood;
  panel.querySelector(".mood-stats").innerHTML = model.sentiment.rows.map((row) => `<div><span>${liveosEsc(row.label)}</span><b>${liveosEsc(row.value)}</b></div>`).join("");
}
function liveosRenderMusic(model, meta) {
  const panel = panelMap.get("music-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Audio`;
  panel.querySelector(".panel-head p").textContent = `${meta.label} sound and BPM alignment`;
  panel.querySelector(".track-card strong").textContent = model.music.track;
  panel.querySelector(".track-card p").textContent = model.music.genre;
  panel.querySelector(".track-meta .track-badge").textContent = model.music.bpm;
  const fit = panel.querySelector(".track-meta span:last-child"); if (fit) fit.textContent = model.music.fit;
}
function liveosRenderInsights(model, meta) {
  const panel = panelMap.get("insights-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Insights`;
  panel.querySelector(".panel-head p").textContent = `AI notes for the ${meta.label.toLowerCase()} lane`;
  const btn = panel.querySelector(".ghost-btn.small"); if (btn) btn.textContent = "Open";
  panel.querySelector(".insight-list").innerHTML = model.insights.map((row) => `<div class="insight-item ${row.cls}"><span>${liveosEsc(row.text)}</span><b>${liveosEsc(row.score)}</b></div>`).join("");
}
function liveosRenderTimeline(model, meta) {
  const panel = panelMap.get("timeline-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Timeline`;
  panel.querySelector(".panel-head p").textContent = `${meta.label} event sequence`;
  panel.querySelector(".segmented").innerHTML = ["All", meta.label.split(" ")[0], "Queue", "Health", "Notes"].map((item, index) => `<button class="${index === 0 ? "active" : ""}" data-static-filter="${liveosEsc(item)}">${liveosEsc(item)}</button>`).join("");
  panel.querySelector(".timeline-list").innerHTML = model.timeline.map((row) => `<div class="timeline-item"><span>${liveosEsc(row.text)}</span><small>${liveosEsc(row.time)}</small></div>`).join("");
}
function liveosRenderHealth(model, meta) {
  const panel = panelMap.get("health-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Health`;
  panel.querySelector(".panel-head p").textContent = `${meta.label} system state`;
  const pill = panel.querySelector(".health-pill"); if (pill) pill.textContent = meta.label === "Alerts" ? "Monitoring" : "Healthy";
  panel.querySelector(".health-metrics").innerHTML = model.health.map((row) => `<div><span>${liveosEsc(row.label)}</span><b>${liveosEsc(row.value)}</b><small>${liveosEsc(row.meta)}</small></div>`).join("");
}
function liveosRenderActions(model, meta) {
  const panel = panelMap.get("actions-panel"); if (!panel) return;
  panel.querySelector("h2").textContent = `${meta.label} Actions`;
  panel.querySelector(".panel-head p").textContent = `Quick controls for ${meta.label.toLowerCase()}`;
  panel.querySelector(".actions-grid").innerHTML = model.actions.map((label, index) => `<button data-target="${liveosTargets[index] || state.view}">${liveosEsc(label)}</button>`).join("");
}
function liveosRenderView() {
  const meta = liveosMetaFor(state.view);
  const model = liveosModel(state.view);
  if (titleNode) titleNode.textContent = meta.title;
  if (subtitleNode) subtitleNode.textContent = meta.subtitle;
  navButtons.forEach((button) => { const label = button.textContent.replace(/^[^A-Za-z]+/, "").trim(); button.classList.toggle("active", label === meta.label); });
  panelMap.forEach((panel, key) => panel.classList.toggle("hidden-by-view", !meta.visible.includes(key)));
  liveosRenderMetrics(model); liveosRenderTrend(meta); liveosRenderGift(model, meta); liveosRenderChat(model, meta); liveosRenderSupporters(model, meta); liveosRenderSentiment(model, meta); liveosRenderMusic(model, meta); liveosRenderInsights(model, meta); liveosRenderTimeline(model, meta); liveosRenderHealth(model, meta); liveosRenderActions(model, meta);
}
setView = function (key) { state.view = liveosMeta[key] ? key : "dashboard"; liveosRenderView(); };
function liveosSendChat() {
  const input = panelMap.get("chat-panel")?.querySelector(".chat-input-row input");
  const value = String(input?.value || "").trim(); if (!value) return;
  const drafts = liveosViewState.drafts[state.view] || []; drafts.unshift({ tone: "tone-green", user: "You", event: value, time: "now", injected: true }); liveosViewState.drafts[state.view] = drafts.slice(0, 4);
  liveosRenderChat(liveosModel(state.view), liveosMetaFor(state.view)); showToast("Message pushed to feed");
}
document.addEventListener("click", (event) => {
  const rangeBtn = event.target.closest(".trend-panel .segmented button[data-range]");
  if (rangeBtn) { liveosViewState.range[state.view] = rangeBtn.dataset.range; liveosRenderTrend(liveosMetaFor(state.view)); showToast(`Range switched to ${rangeBtn.dataset.range}`); return; }
  const timelineBtn = event.target.closest(".timeline-panel .segmented button[data-static-filter]");
  if (timelineBtn) { Array.from(timelineBtn.parentElement.querySelectorAll("button")).forEach((button) => button.classList.toggle("active", button === timelineBtn)); showToast(`${timelineBtn.dataset.staticFilter} filter active`); return; }
  const actionBtn = event.target.closest(".actions-grid button[data-target]");
  if (actionBtn) { const target = actionBtn.dataset.target || state.view; if (target === state.view) showToast(`${actionBtn.textContent.trim()} triggered`); else { setView(target); showToast(`${actionBtn.textContent.trim()} opened`); } return; }
  if (event.target.closest(".chat-input-row button")) { liveosSendChat(); }
});
chatInput?.removeEventListener?.("keydown", sendChatMessage);
chatInput?.addEventListener("keydown", (event) => { if (event.key === "Enter") liveosSendChat(); });
liveosRenderView();
