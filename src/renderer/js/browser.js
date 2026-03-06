/**
 * EtherX Browser — Renderer: Main Browser Logic
 * Copyright © 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
 * PROPRIETARY AND CONFIDENTIAL — See LICENSE file.
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  tabs:          [],     // array of tab objects
  activeTabId:   null,
  settings:      {},
  strings:       {},
  zoom:          100,
  adBlockOn:     true,
  isIncognito:   false,  // true if current active tab is incognito
  tabCounter:    0,
  suggestions:   [],
  suggestionIdx: -1,
};

// ─── Tab Group Colors ─────────────────────────────────────────────────────────
const GROUP_COLORS = {
  'Social Media':        '#e74c3c',
  'Video':               '#e67e22',
  'Shopping':            '#f1c40f',
  'News':                '#2ecc71',
  'Development':         '#3498db',
  'Crypto / Web3':       '#9b59b6',
  'Finance':             '#1abc9c',
  'Work / Productivity': '#e91e63',
  'AI & Tech':           '#00bcd4',
  'Education':           '#8bc34a',
  'Other':               '#607d8b',
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const tabList        = $('tabList');
const contentArea    = $('contentArea');
const urlInput       = $('urlInput');
const secureIcon     = $('secureIcon');
const phishingBadge  = $('phishingBadge');
const suggestPanel   = $('suggestionsPanel');
const suggestList    = $('suggestionsList');
const phishingBanner = $('phishingBanner');
const tabGroupsBar   = $('tabGroupsBar');

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
  // Load settings & i18n
  state.settings = await etherx.settings.get();
  const lang = state.settings.language || 'hr';
  state.strings = await etherx.i18n.getStrings(lang);

  // Apply language to placeholders
  applyStrings();

  // Restore tabs
  const savedTabs = await etherx.tabs.getAll();
  if (savedTabs && savedTabs.length > 0) {
    savedTabs.sort((a, b) => a.tabOrder - b.tabOrder);
    for (const t of savedTabs) {
      createTab({ ...t, restore: true });
    }
    const active = savedTabs.find(t => t.isActive) || savedTabs[0];
    activateTab(active.id);
  } else {
    createTab({ url: 'etherx://newtab' });
  }

  // Ad blocker status
  const adEnabled = state.settings.adblock_enabled !== 'false';
  state.adBlockOn = adEnabled;
  updateAdBlockUI();

  // App version
  const version = await etherx.app.getVersion();
  $('statusVersion').textContent = `EtherX ${version}`;
  $('aboutVersion').textContent = `Verzija ${version}`;

  // Ad block stats update
  setInterval(updateAdStats, 5000);

  // Listen for external open-url
  etherx.on('open-url', url => {
    createTab({ url });
  });
})();

// ─── Strings / i18n ──────────────────────────────────────────────────────────
function applyStrings() {
  const s = state.strings;
  urlInput.placeholder = s.search || 'Search or type URL...';
  $('btnNewTab').title    = s.newTab;
  $('btnBack').title      = s.back;
  $('btnForward').title   = s.forward;
  $('btnReload').title    = s.reload;
  $('btnHome').title      = s.home;
  $('btnMenu').title      = 'Menu';
  $('statusAdBlock').textContent = state.adBlockOn ? (s.adBlockOn || 'AdBlock: ON') : (s.adBlockOff || 'AdBlock: OFF');
  $('statusSecurity').textContent = s.secureConn || '🔒 TLS 1.3';
  $('statusAI').textContent = '🤖 AI: ' + (state.settings.ai_enabled !== 'false' ? 'ON' : 'OFF');
}

// ─── Tab Management ───────────────────────────────────────────────────────────

let _tabIdCounter = Date.now();
function nextTabId() { return 'tab-' + (++_tabIdCounter); }

function createTab({ url, title, tabOrder, isActive, scrollX = 0, scrollY = 0,
                     isPinned = false, groupName = null, incognito = false,
                     id, restore = false } = {}) {
  const tabId = id || nextTabId();
  const tabUrl = url || 'etherx://newtab';
  const tabTitle = title || state.strings.newTab || 'New Tab';

  const tab = {
    id: tabId,
    url: tabUrl,
    title: tabTitle,
    favicon: '',
    tabOrder: tabOrder ?? state.tabs.length,
    isActive: !!isActive,
    scrollX, scrollY,
    isPinned, groupName,
    incognito: !!incognito,
    webviewLoading: false,
  };

  state.tabs.push(tab);

  // Build tab DOM element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab' + (incognito ? ' incognito' : '') + (isPinned ? ' pinned' : '');
  tabEl.dataset.tabId = tabId;

  if (groupName && GROUP_COLORS[groupName]) {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'tab-group-label';
    groupLabel.style.background = GROUP_COLORS[groupName];
    groupLabel.textContent = groupName;
    tabEl.appendChild(groupLabel);
  }

  const favEl = document.createElement('div');
  favEl.className = 'tab-favicon-placeholder';
  favEl.textContent = 'X';
  tabEl.appendChild(favEl);

  if (!isPinned) {
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tabTitle;
    tabEl.appendChild(titleEl);
  }

  const closeEl = document.createElement('span');
  closeEl.className = 'tab-close';
  closeEl.textContent = '×';
  closeEl.title = state.strings.close || 'Close';
  closeEl.addEventListener('click', e => { e.stopPropagation(); closeTab(tabId); });
  tabEl.appendChild(closeEl);

  tabEl.addEventListener('click', () => activateTab(tabId));
  tabEl.addEventListener('contextmenu', e => showContextMenu(e, tabId));
  tabList.appendChild(tabEl);

  // Build WebView
  const wv = document.createElement('webview');
  wv.id = 'wv-' + tabId;
  wv.setAttribute('allowpopups', 'false');
  wv.setAttribute('webpreferences', 'contextIsolation=true, javascript=yes, images=yes');

  // User Agent
  const ua = state.settings.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 EtherX/1.0';
  wv.setAttribute('useragent', ua);

  wv.addEventListener('page-title-updated', e => {
    tab.title = e.title;
    updateTabTitle(tabId, e.title);
    if (!incognito) persistTab(tab);
  });

  wv.addEventListener('page-favicon-updated', e => {
    if (e.favicons && e.favicons[0]) {
      tab.favicon = e.favicons[0];
      updateTabFavicon(tabId, e.favicons[0]);
    }
  });

  wv.addEventListener('did-start-loading', () => {
    tab.webviewLoading = true;
    if (state.activeTabId === tabId) {
      $('btnReload').textContent = '✕';
      $('btnReload').title = state.strings.stop || 'Stop';
      showLoadingBar(tabId);
    }
  });

  wv.addEventListener('did-stop-loading', () => {
    tab.webviewLoading = false;
    if (state.activeTabId === tabId) {
      $('btnReload').textContent = '↻';
      $('btnReload').title = state.strings.reload || 'Reload';
      hideLoadingBar(tabId);
      updateNavButtons(tabId);
      updateOmnibox(tabId);
    }
    if (!incognito) {
      // Save to history
      etherx.history.add({ url: tab.url, title: tab.title, favicon: tab.favicon, incognito: false });
      persistTab(tab);
    }
    // Phishing check
    runPhishingCheck(tabId, tab.url);
  });

  wv.addEventListener('did-navigate', e => {
    tab.url = e.url;
    if (state.activeTabId === tabId) updateOmnibox(tabId);
    if (!incognito) persistTab(tab);
  });

  wv.addEventListener('did-navigate-in-page', e => {
    tab.url = e.url;
    if (state.activeTabId === tabId) updateOmnibox(tabId);
  });

  wv.addEventListener('did-fail-load', e => {
    if (e.errorCode !== -3) { // -3 = aborted, normal
      if (state.activeTabId === tabId) showErrorPage(tabId, e.errorDescription, tab.url);
    }
    tab.webviewLoading = false;
  });

  wv.addEventListener('new-window', e => {
    createTab({ url: e.url });
  });

  contentArea.appendChild(wv);

  // Navigate after a brief delay to ensure ready
  setTimeout(() => {
    wv.src = resolveUrl(tabUrl);
  }, 50);

  if (!restore && !isActive) {
    activateTab(tabId);
  }

  if (!incognito) persistTab(tab);

  return tabId;
}

function activateTab(tabId) {
  // Deactivate old
  if (state.activeTabId) {
    const oldTab = getTab(state.activeTabId);
    if (oldTab) {
      oldTab.isActive = false;
      const oldEl = document.querySelector(`.tab[data-tab-id="${state.activeTabId}"]`);
      oldEl?.classList.remove('active');
      const oldWv = $('wv-' + state.activeTabId);
      oldWv?.classList.remove('active');
    }
  }

  state.activeTabId = tabId;
  const tab = getTab(tabId);
  if (!tab) return;

  tab.isActive = true;
  const el = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
  el?.classList.add('active');
  const wv = $('wv-' + tabId);
  wv?.classList.add('active');

  state.isIncognito = !!tab.incognito;
  document.body.classList.toggle('incognito-active', state.isIncognito);

  updateOmnibox(tabId);
  updateNavButtons(tabId);
  persistTabOrder();
}

function closeTab(tabId) {
  const idx = state.tabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;
  const tab = state.tabs[idx];

  if (tab.incognito) {
    etherx.tabs.clearInc(tabId);
  } else {
    etherx.tabs.delete(tabId);
  }

  state.tabs.splice(idx, 1);
  document.querySelector(`.tab[data-tab-id="${tabId}"]`)?.remove();
  $('wv-' + tabId)?.remove();

  if (state.tabs.length === 0) {
    createTab({ url: 'etherx://newtab' });
  } else if (state.activeTabId === tabId) {
    const newActive = state.tabs[Math.min(idx, state.tabs.length - 1)];
    activateTab(newActive.id);
  }
}

function getTab(tabId) { return state.tabs.find(t => t.id === tabId); }
function getActiveWv() { return state.activeTabId ? $('wv-' + state.activeTabId) : null; }

function updateTabTitle(tabId, title) {
  const el = document.querySelector(`.tab[data-tab-id="${tabId}"] .tab-title`);
  if (el) el.textContent = title;
}

function updateTabFavicon(tabId, faviconUrl) {
  const ph = document.querySelector(`.tab[data-tab-id="${tabId}"] .tab-favicon-placeholder`);
  if (!ph) return;
  const img = document.createElement('img');
  img.className = 'tab-favicon';
  img.src = faviconUrl;
  img.onerror = () => ph.textContent = 'X';
  img.onload = () => ph.replaceWith(img);
}

// ─── Persistence ─────────────────────────────────────────────────────────────
function persistTab(tab) {
  if (tab.incognito) return; // NEVER persist incognito
  etherx.tabs.save({
    id:        tab.id,
    url:       tab.url,
    title:     tab.title,
    favicon:   tab.favicon,
    tabOrder:  tab.tabOrder,
    isActive:  tab.isActive,
    scrollX:   tab.scrollX || 0,
    scrollY:   tab.scrollY || 0,
    isPinned:  tab.isPinned || false,
    groupName: tab.groupName || null,
    incognito: false,
  });
}

function persistTabOrder() {
  const nonIncognito = state.tabs
    .filter(t => !t.incognito)
    .map((t, i) => ({ id: t.id, tabOrder: i, isActive: t.id === state.activeTabId }));
  etherx.tabs.updateOrder(nonIncognito);
}

// ─── URL / Omnibox ────────────────────────────────────────────────────────────
function resolveUrl(input) {
  if (!input || input === 'etherx://newtab') return getNewTabUrl();
  if (input.startsWith('etherx://')) return getNewTabUrl();
  if (input.startsWith('about:')) return input;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^localhost(:\d+)?(\/|$)/.test(input)) return `http://${input}`;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(input)) return `http://${input}`;
  if (!input.includes(' ') && input.includes('.')) return `https://${input}`;
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function getNewTabUrl() {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(getNewTabHtml());
}

function updateOmnibox(tabId) {
  const tab = getTab(tabId);
  if (!tab || tabId !== state.activeTabId) return;
  const url = tab.url || '';
  urlInput.value = url.startsWith('data:') ? '' : url;
  const isHttps = url.startsWith('https://');
  const isHttp  = url.startsWith('http://');
  secureIcon.textContent = isHttps ? '🔒' : isHttp ? '⚠️' : '🌐';
  secureIcon.className = 'omnibox-icon ' + (isHttps ? 'secure' : isHttp ? 'insecure' : '');
  secureIcon.title = isHttps ? (state.strings.secureConn || 'Secure') : isHttp ? 'Not secure (HTTP)' : '';
}

function navigateActive(urlOrQuery) {
  const wv = getActiveWv();
  if (!wv) return;
  const url = resolveUrl(urlOrQuery);
  const tab = getTab(state.activeTabId);
  if (tab) tab.url = url;
  wv.src = url;
}

function updateNavButtons(tabId) {
  const wv = $('wv-' + tabId);
  if (!wv) return;
  try {
    $('btnBack').disabled    = !wv.canGoBack();
    $('btnForward').disabled = !wv.canGoForward();
  } catch { /* webview not ready */ }
}

// ─── Loading Bar ──────────────────────────────────────────────────────────────
function showLoadingBar(tabId) {
  let bar = $('loadingBar-' + tabId);
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'loading-bar';
    bar.id = 'loadingBar-' + tabId;
    bar.style.width = '30%';
    contentArea.appendChild(bar);
  }
  bar.style.display = 'block';
  let w = 30;
  bar._timer = setInterval(() => {
    w = Math.min(w + Math.random() * 15, 90);
    bar.style.width = w + '%';
  }, 400);
}
function hideLoadingBar(tabId) {
  const bar = $('loadingBar-' + tabId);
  if (bar) {
    clearInterval(bar._timer);
    bar.style.width = '100%';
    setTimeout(() => { bar.style.display = 'none'; bar.style.width = '0'; }, 300);
  }
}

// ─── Error Page ───────────────────────────────────────────────────────────────
function showErrorPage(tabId, errorMsg, url) {
  const wv = $('wv-' + tabId);
  if (!wv) return;
  wv.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Error</title>
<style>body{font-family:sans-serif;background:#1a1a1a;color:#e8e8e8;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0;}
.box{text-align:center;max-width:500px;padding:40px;}
h1{font-size:48px;color:#ff5f56;margin-bottom:16px;}
p{color:#888;margin-bottom:8px;}
a{color:#667eea;cursor:pointer;}
</style></head>
<body><div class="box">
<h1>⚠</h1>
<h2>Stranica nije dostupna</h2>
<p>${url}</p>
<p style="color:#666;font-size:12px">${errorMsg || 'Connection error'}</p>
</div></body></html>`);
}

// ─── Phishing Detection ───────────────────────────────────────────────────────
async function runPhishingCheck(tabId, url) {
  if (!url || url.startsWith('data:') || url.startsWith('etherx:') || url.startsWith('about:')) return;
  const result = await etherx.ai.checkPhishing(url);
  if (!result) return;

  if (!result.isSafe && result.level !== 'safe') {
    $('phishingBannerTitle').textContent = state.strings.phishingWarn || 'Warning: Phishing?';
    $('phishingBannerDetails').textContent = result.reasons ? result.reasons.join(', ') : '';
    phishingBanner.classList.remove('hidden');
    phishingBadge.classList.remove('hidden');
    secureIcon.textContent = '⚠️';
    secureIcon.className = 'omnibox-icon phishing';

    if (tabId === state.activeTabId) {
      $('statusSecurity').textContent = '⚠ Phishing Risk';
      $('statusSecurity').className = 'status-item danger';
    }
  } else {
    phishingBanner.classList.add('hidden');
    phishingBadge.classList.add('hidden');
    if (tabId === state.activeTabId) {
      $('statusSecurity').textContent = state.strings.secureConn || '🔒 TLS 1.3';
      $('statusSecurity').className = 'status-item secure';
    }
  }
}

// ─── New Tab Page ─────────────────────────────────────────────────────────────
function getNewTabHtml() {
  return `<!DOCTYPE html>
<html lang="hr"><head><meta charset="UTF-8"><title>Nova kartica</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}
body{background:#1a1a1a;color:#e8e8e8;font-family:-apple-system,sans-serif;
display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;}
.logo{width:72px;height:72px;background:linear-gradient(135deg,#667eea,#764ba2);
border-radius:18px;display:flex;align-items:center;justify-content:center;
font-size:36px;font-weight:900;color:#fff;margin-bottom:20px;}
h1{font-size:28px;margin-bottom:6px;}
p{color:#666;margin-bottom:32px;font-size:14px;}
.cards{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;max-width:600px;}
.card{background:#2d2d2d;border:1px solid #3d3d3d;border-radius:10px;
padding:20px;text-align:center;width:160px;cursor:pointer;transition:.2s;}
.card:hover{border-color:#667eea;background:#2a2a3a;}
.card-icon{font-size:28px;margin-bottom:8px;}
.card-title{font-size:13px;font-weight:600;}
.card-desc{font-size:11px;color:#666;margin-top:4px;}
</style></head>
<body>
<div class="logo">X</div>
<h1>EtherX Browser</h1>
<p>Privatnost. Sigurnost. Web3.</p>
<div class="cards">
<div class="card"><div class="card-icon">🔐</div>
<div class="card-title">Sigurnost</div><div class="card-desc">TLS 1.3 + Ad-block</div></div>
<div class="card"><div class="card-icon">🤖</div>
<div class="card-title">AI Pomoćnik</div><div class="card-desc">WebLLM ugrađen</div></div>
<div class="card"><div class="card-icon">⚡</div>
<div class="card-title">Brzo</div><div class="card-desc">Chromium v8 engine</div></div>
<div class="card"><div class="card-icon">🌐</div>
<div class="card-title">Web3</div><div class="card-desc">dApps i kripto</div></div>
</div>
<p style="margin-top:24px;font-size:11px;color:#444;">© 2024–2026 kriptoentuzijasti.io</p>
</body></html>`;
}

// ─── Smart Suggestions ────────────────────────────────────────────────────────
let _suggTimeout = null;
urlInput.addEventListener('input', e => {
  clearTimeout(_suggTimeout);
  const val = e.target.value.trim();
  if (!val) { hideSuggestions(); return; }
  _suggTimeout = setTimeout(() => showSuggestions(val), 200);
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    hideSuggestions();
    const val = urlInput.value.trim();
    if (!val) return;
    navigateActive(val);
    urlInput.blur();
    return;
  }
  if (e.key === 'Escape') {
    hideSuggestions();
    updateOmnibox(state.activeTabId);
    urlInput.blur();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSuggestion(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSuggestion(-1);
  }
});

urlInput.addEventListener('focus', () => {
  urlInput.select();
});

urlInput.addEventListener('blur', () => {
  setTimeout(hideSuggestions, 200);
});

async function showSuggestions(query) {
  const result = await etherx.ai.smartSearch(query);
  const items = [];

  if (result.type === 'url') {
    items.push({ icon: '🌐', title: result.url, subtitle: 'Idi na stranicu', type: 'url', action: result.url });
  } else if (result.type === 'query') {
    // History matches
    const hist = await etherx.history.get({ search: query, limit: 3 });
    hist.forEach(h => items.push({
      icon: '🕐', title: h.title || h.url, subtitle: h.url, type: 'history', action: h.url
    }));
    // Bookmark matches
    const bmarks = await etherx.bookmarks.getAll();
    bmarks.filter(b => b.title?.toLowerCase().includes(query.toLowerCase()) ||
                       b.url?.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 2)
          .forEach(b => items.push({
            icon: '☆', title: b.title || b.url, subtitle: b.url, type: 'bookmark', action: b.url
          }));

    result.suggestions?.forEach(s => {
      if (s.type === 'search') items.push({ icon: '🔍', title: s.query || query, subtitle: `Search ${s.engine}`, type: 'search', action: s.url });
      if (s.type === 'ai') items.push({ icon: '🤖', title: 'Pitaj AI: ' + query, subtitle: 'WebLLM odgovor', type: 'ai', action: 'ai:' + query });
    });
  }

  state.suggestions = items;
  state.suggestionIdx = -1;

  if (items.length === 0) { hideSuggestions(); return; }

  suggestList.innerHTML = '';
  items.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'suggestion-item';
    el.innerHTML = `
      <div class="suggestion-icon">${item.icon}</div>
      <div class="suggestion-text">
        <div class="suggestion-title">${escapeHtml(item.title)}</div>
        <div class="suggestion-subtitle">${escapeHtml(item.subtitle || '')}</div>
      </div>
      <span class="suggestion-type ${item.type}">${item.type}</span>`;
    el.addEventListener('click', () => {
      hideSuggestions();
      if (item.action.startsWith('ai:')) {
        handleAIQuery(item.action.slice(3));
      } else {
        navigateActive(item.action);
      }
    });
    suggestList.appendChild(el);
  });

  suggestPanel.classList.remove('hidden');
  suggestPanel.classList.add('fade-in');
}

function hideSuggestions() {
  suggestPanel.classList.add('hidden');
  state.suggestions = [];
  state.suggestionIdx = -1;
}

function moveSuggestion(dir) {
  const items = suggestList.querySelectorAll('.suggestion-item');
  if (!items.length) return;
  items.forEach(el => el.classList.remove('focused'));
  state.suggestionIdx = Math.max(-1, Math.min(items.length - 1, state.suggestionIdx + dir));
  if (state.suggestionIdx >= 0) {
    items[state.suggestionIdx].classList.add('focused');
    const s = state.suggestions[state.suggestionIdx];
    if (s) urlInput.value = s.action.startsWith('ai:') ? s.action.slice(3) : s.action;
  }
}

// ─── AI Features ─────────────────────────────────────────────────────────────
async function handleAIQuery(prompt) {
  $('aiAnswerPanel').classList.remove('hidden');
  $('aiAnswerContent').innerHTML = '<div class="ai-loading"><div class="ai-spinner"></div><span>AI razmišlja...</span></div>';

  // Try WebLLM in renderer if available, otherwise show search
  if (typeof window.ai !== 'undefined') {
    // WebLLM available (loaded by webllm.js worker)
    try {
      const answer = await window.ai.generate(prompt);
      $('aiAnswerContent').textContent = answer;
    } catch (e) {
      showAIFallback(prompt);
    }
  } else {
    showAIFallback(prompt);
  }
}

function showAIFallback(prompt) {
  $('aiAnswerContent').innerHTML = `
    <p>WebLLM nije pokrenut. Odaberite pretraživač:</p>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
      ${['Google', 'DuckDuckGo', 'Brave', 'Perplexity'].map(e => `
        <button onclick="navigateActive('${getSearchUrl(e, prompt)}')" style="padding:6px 12px;background:#2d2d2d;border:1px solid #4a4a4a;color:#e8e8e8;border-radius:6px;cursor:pointer;">${e}</button>
      `).join('')}
    </div>`;
}

function getSearchUrl(engine, q) {
  const ENGINES = {
    Google: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    DuckDuckGo: `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    Brave: `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    Perplexity: `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
  };
  return ENGINES[engine] || ENGINES.Google;
}

// ─── Reading Mode ─────────────────────────────────────────────────────────────
async function toggleReadingMode() {
  const overlay = $('readingOverlay');
  if (!overlay.classList.contains('hidden')) {
    overlay.classList.add('hidden');
    $('btnReadingMode').classList.remove('active');
    return;
  }

  const wv = getActiveWv();
  if (!wv) return;

  try {
    const html = await wv.executeJavaScript('document.documentElement.outerHTML');
    const result = await etherx.ai.readingMode(html);
    if (result.ok) {
      $('readingContent').textContent = result.text;
      $('readingWordCount').textContent = `${result.wordCount || 0} riječi`;
      overlay.classList.remove('hidden');
      $('btnReadingMode').classList.add('active');
    }
  } catch (e) {
    $('readingContent').textContent = 'Nije moguće učitati sadržaj.';
    overlay.classList.remove('hidden');
  }
}

// ─── Tab Groups (AI) ──────────────────────────────────────────────────────────
async function autoGroupTabs() {
  const tabData = state.tabs.map(t => ({ id: t.id, url: t.url, title: t.title }));
  const result  = await etherx.ai.groupTabs(tabData);
  if (!result.ok) return;

  result.tabs.forEach(rt => {
    const tab = getTab(rt.id);
    if (tab) tab.groupName = rt.groupName;
    const el = document.querySelector(`.tab[data-tab-id="${rt.id}"]`);
    if (el) {
      let lbl = el.querySelector('.tab-group-label');
      if (!lbl) {
        lbl = document.createElement('div');
        lbl.className = 'tab-group-label';
        el.prepend(lbl);
      }
      lbl.textContent = rt.groupName;
      lbl.style.background = GROUP_COLORS[rt.groupName] || '#607d8b';
    }
    if (!tab?.incognito) persistTab(tab);
  });

  renderTabGroupsBar(result.tabs);
}

function renderTabGroupsBar(tabs) {
  const groups = [...new Set(tabs.map(t => t.groupName).filter(Boolean))];
  if (!groups.length) return;

  tabGroupsBar.innerHTML = '';
  tabGroupsBar.classList.remove('hidden');

  groups.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'tab-group-chip';
    btn.textContent = g;
    btn.style.background = (GROUP_COLORS[g] || '#607d8b') + '33';
    btn.style.color = GROUP_COLORS[g] || '#e8e8e8';
    btn.style.borderColor = GROUP_COLORS[g] || '#607d8b';
    btn.style.border = `1px solid ${GROUP_COLORS[g] || '#607d8b'}`;
    btn.title = `Filter: ${g}`;
    btn.addEventListener('click', () => filterTabsByGroup(g));
    tabGroupsBar.appendChild(btn);
  });
}

function filterTabsByGroup(group) {
  state.tabs.forEach(t => {
    const el = document.querySelector(`.tab[data-tab-id="${t.id}"]`);
    if (el) el.style.display = (!group || t.groupName === group) ? '' : 'none';
  });
}

// ─── Bookmarks ─────────────────────────────────────────────────────────────────
async function toggleBookmarkCurrent() {
  const tab = getTab(state.activeTabId);
  if (!tab) return;
  const allBm = await etherx.bookmarks.getAll();
  const existing = allBm.find(b => b.url === tab.url);
  if (existing) {
    await etherx.bookmarks.delete(existing.id);
    $('btnBookmark').textContent = '☆';
    $('btnBookmark').title = 'Add Bookmark';
  } else {
    const id = 'bm-' + Date.now();
    await etherx.bookmarks.add({ id, url: tab.url, title: tab.title, favicon: tab.favicon });
    $('btnBookmark').textContent = '★';
    $('btnBookmark').title = 'Remove Bookmark';
    if (!$('sidebarBookmarks').classList.contains('hidden')) loadBookmarksSidebar();
  }
}

async function openBookmarksSidebar() {
  $('sidebarBookmarks').classList.remove('hidden');
  await loadBookmarksSidebar();
}

async function loadBookmarksSidebar() {
  const list    = $('bookmarksList');
  const bmarks  = await etherx.bookmarks.getAll();
  list.innerHTML = '';
  if (!bmarks.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:#666;">${state.strings.noResults || 'No bookmarks'}</div>`;
    return;
  }
  bmarks.forEach(b => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.innerHTML = `
      <div class="sidebar-item-icon">☆</div>
      <div class="sidebar-item-text">
        <div class="sidebar-item-title">${escapeHtml(b.title || b.url)}</div>
        <div class="sidebar-item-sub">${escapeHtml(b.url)}</div>
      </div>
      <div class="sidebar-item-actions">
        <button class="item-action-btn" title="Delete" data-id="${b.id}">🗑</button>
      </div>`;
    item.querySelector('.sidebar-item-text').addEventListener('click', () => navigateActive(b.url));
    item.querySelector('.item-action-btn').addEventListener('click', async e => {
      await etherx.bookmarks.delete(e.target.dataset.id);
      loadBookmarksSidebar();
    });
    list.appendChild(item);
  });
}

// Search bookmarks
$('bookmarkSearch').addEventListener('input', async e => {
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('#bookmarksList .sidebar-item').forEach(el => {
    const title = el.querySelector('.sidebar-item-title')?.textContent.toLowerCase() || '';
    const sub   = el.querySelector('.sidebar-item-sub')?.textContent.toLowerCase() || '';
    el.style.display = (title.includes(q) || sub.includes(q)) ? '' : 'none';
  });
});

// ─── History Sidebar ──────────────────────────────────────────────────────────
async function openHistorySidebar() {
  $('sidebarHistory').classList.remove('hidden');
  await loadHistorySidebar();
}

async function loadHistorySidebar(search = '') {
  const list = $('historyList');
  const items = await etherx.history.get({ limit: 100, search });
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:#666;">${state.strings.noResults || 'No history'}</div>`;
    return;
  }
  items.forEach(h => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    const date = new Date(h.last_visited * 1000).toLocaleDateString();
    item.innerHTML = `
      <div class="sidebar-item-icon">🕐</div>
      <div class="sidebar-item-text">
        <div class="sidebar-item-title">${escapeHtml(h.title || h.url)}</div>
        <div class="sidebar-item-sub">${escapeHtml(h.url)} · ${date}</div>
      </div>`;
    item.addEventListener('click', () => navigateActive(h.url));
    list.appendChild(item);
  });
}

$('historySearch').addEventListener('input', e => loadHistorySidebar(e.target.value));
$('btnClearHistory').addEventListener('click', async () => {
  if (confirm('Obrisati cijelu povijest pregledavanja?')) {
    await etherx.history.clear();
    loadHistorySidebar();
  }
});

// ─── Passwords Sidebar ────────────────────────────────────────────────────────
function openPasswordsSidebar() {
  $('sidebarPasswords').classList.remove('hidden');
}

// ─── QR Sync ─────────────────────────────────────────────────────────────────
async function openQRSync(type = 'full') {
  const modal = $('modalQrSync');
  modal.classList.remove('hidden');
  generateQR(type);

  modal.querySelectorAll('.qr-opt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.qr-opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      generateQR(btn.dataset.type);
    });
  });
}

async function generateQR(type) {
  const container = $('qrContainer');
  container.innerHTML = '<div class="qr-loading">Generiranje QR koda...</div>';
  const result = await etherx.qrsync.exportProfile();
  if (result.ok) {
    container.innerHTML = `<img src="${result.qrDataUrl}" alt="QR Code" style="max-width:280px;border-radius:6px;">`;
    $('qrHint').textContent = result.isPartial
      ? 'Podaci su preveliki za jedan QR. Koristite LAN sinkronizaciju.'
      : (state.strings.qrScanInfo || 'Scan QR code on another device to sync.');
  } else {
    container.innerHTML = `<p style="color:#ff5f56">Greška: ${result.error}</p>`;
  }
}

// ─── Cast ─────────────────────────────────────────────────────────────────────
async function openCast() {
  $('modalCast').classList.remove('hidden');
  const container = $('castDevices');
  container.innerHTML = '<div class="cast-loading">Tražim uređaje...</div>';
  const devices = await etherx.cast.getDevices();
  container.innerHTML = '';
  devices.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cast-device';
    el.innerHTML = `<div class="cast-device-icon">${d.type === 'local' ? '🖥' : '📺'}</div>
      <div class="cast-device-info">
        <div class="cast-device-name">${escapeHtml(d.name)}</div>
        <div class="cast-device-type">${d.type}</div>
      </div>`;
    el.addEventListener('click', () => {
      if (d.type === 'local') alert('Prikaz na ovom ekranu (Fullscreen mode)');
    });
    container.appendChild(el);
  });
}

// ─── Save Page ────────────────────────────────────────────────────────────────
async function savePage() {
  const tab = getTab(state.activeTabId);
  if (!tab) return;
  const result = await etherx.share.saveAs(tab.url, tab.title);
  if (result.ok && result.filePath) {
    const wv = getActiveWv();
    if (wv) wv.savePage(result.filePath, 'HTMLComplete');
  }
}

// ─── Share ─────────────────────────────────────────────────────────────────────
async function shareCurrentPage() {
  const tab = getTab(state.activeTabId);
  if (!tab) return;
  etherx.share.url(tab.url, tab.title);
}

// ─── Ad Block UI ─────────────────────────────────────────────────────────────
async function updateAdStats() {
  const stats = await etherx.adblock.stats();
  $('statusAdsBlocked').textContent = `${stats.blocked || 0} reklama blokirano`;
}

function updateAdBlockUI() {
  const btn = $('btnAdBlock');
  if (state.adBlockOn) {
    btn.classList.add('active');
    btn.title = state.strings.adBlockOn || 'Ad Blocker: ON';
    $('statusAdBlock').textContent = state.strings.adBlockOn || '🛡 AdBlock: ON';
  } else {
    btn.classList.remove('active');
    btn.title = state.strings.adBlockOff || 'Ad Blocker: OFF';
    $('statusAdBlock').textContent = state.strings.adBlockOff || '🛡 AdBlock: OFF';
  }
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function showContextMenu(e, tabId) {
  e.preventDefault();
  const menu = $('contextMenu');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 240) + 'px';
  menu.classList.remove('hidden');
}

document.addEventListener('click', e => {
  if (!e.target.closest('#contextMenu')) $('contextMenu').classList.add('hidden');
  if (!e.target.closest('#mainMenu') && !e.target.closest('#btnMenu')) $('mainMenu').classList.add('hidden');
});

$('contextMenu').addEventListener('click', e => {
  const action = e.target.dataset.action;
  if (!action) return;
  handleMenuAction(action);
  $('contextMenu').classList.add('hidden');
});

$('mainMenu').addEventListener('click', e => {
  const action = e.target.dataset.action;
  if (!action) return;
  handleMenuAction(action);
  $('mainMenu').classList.add('hidden');
});

function handleMenuAction(action) {
  const wv = getActiveWv();
  switch (action) {
    case 'newTab':      createTab({ url: 'etherx://newtab' }); break;
    case 'newIncognito': createTab({ url: 'etherx://newtab', incognito: true }); break;
    case 'saveAs':      savePage(); break;
    case 'share':       shareCurrentPage(); break;
    case 'cast':        openCast(); break;
    case 'zoomIn':      setZoom(state.zoom + 10); break;
    case 'zoomOut':     setZoom(state.zoom - 10); break;
    case 'fullscreen':  toggleFullscreen(); break;
    case 'history':     openHistorySidebar(); break;
    case 'bookmarks':   openBookmarksSidebar(); break;
    case 'passwords':   openPasswordsSidebar(); break;
    case 'groupTabs':   autoGroupTabs(); break;
    case 'qrSync':      openQRSync(); break;
    case 'setDefault':  setDefaultBrowser(); break;
    case 'settings':    openSettings(); break;
    case 'devTools':    etherx.window.devTools(); break;
    case 'about':       $('modalAbout').classList.remove('hidden'); break;
    case 'readingMode': toggleReadingMode(); break;
    case 'back':        wv?.goBack(); break;
    case 'forward':     wv?.goForward(); break;
    case 'reload':      wv?.reload(); break;
    case 'viewSource':  if (wv) createTab({ url: 'view-source:' + getTab(state.activeTabId)?.url }); break;
    case 'print':       wv?.print(); break;
  }
}

// ─── Zoom ────────────────────────────────────────────────────────────────────
function setZoom(level) {
  state.zoom = Math.max(50, Math.min(200, level));
  const wv = getActiveWv();
  if (wv) wv.setZoomFactor(state.zoom / 100);
  $('statusZoom').textContent = state.zoom + '%';
}

// ─── Fullscreen ───────────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}

// ─── Default Browser ──────────────────────────────────────────────────────────
async function setDefaultBrowser() {
  const result = await etherx.defaultBrowser.set();
  if (result.ok) alert(result.message || state.strings.setDefaultOk || 'Done!');
  else alert(result.error || 'Error');
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function openSettings() {
  createTab({ url: 'etherx://settings' });
}

// ─── Modal close buttons ───────────────────────────────────────────────────────
document.querySelectorAll('.modal-close, .sidebar-close-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    if (targetId) $(targetId).classList.add('hidden');
  });
});

// ─── Nav Buttons ─────────────────────────────────────────────────────────────
$('btnBack').addEventListener('click', () => getActiveWv()?.goBack());
$('btnForward').addEventListener('click', () => getActiveWv()?.goForward());
$('btnReload').addEventListener('click', () => {
  const wv = getActiveWv();
  if (!wv) return;
  const tab = getTab(state.activeTabId);
  if (tab?.webviewLoading) wv.stop();
  else wv.reload();
});
$('btnHome').addEventListener('click', () => {
  const home = state.settings.homepage || 'etherx://newtab';
  navigateActive(home);
});
$('btnNewTab').addEventListener('click', () => createTab({ url: 'etherx://newtab' }));
$('btnIncognito').addEventListener('click', () => createTab({ url: 'etherx://newtab', incognito: true }));
$('btnBookmark').addEventListener('click', toggleBookmarkCurrent);
$('btnMenu').addEventListener('click', e => {
  e.stopPropagation();
  const menu = $('mainMenu');
  const rect = $('btnMenu').getBoundingClientRect();
  menu.style.top  = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.left  = 'auto';
  menu.classList.toggle('hidden');
});
$('btnAdBlock').addEventListener('click', async () => {
  state.adBlockOn = !state.adBlockOn;
  await etherx.adblock.toggle(state.adBlockOn);
  etherx.settings.save({ ...state.settings, adblock_enabled: String(state.adBlockOn) });
  state.settings.adblock_enabled = String(state.adBlockOn);
  updateAdBlockUI();
});
$('btnReadingMode').addEventListener('click', toggleReadingMode);
$('btnReadingClose').addEventListener('click', () => {
  $('readingOverlay').classList.add('hidden');
  $('btnReadingMode').classList.remove('active');
});
$('btnReadingTranslate').addEventListener('click', async () => {
  const text = $('readingContent').textContent;
  const lang = state.settings.language === 'en' ? 'hr' : 'en';
  $('readingContent').textContent = state.strings.loading || 'Loading...';
  const r = await etherx.ai.translate(text, lang);
  $('readingContent').textContent = r.translated || text;
});
$('btnAiClose').addEventListener('click', () => $('aiAnswerPanel').classList.add('hidden'));
$('btnPhishingClose').addEventListener('click', () => phishingBanner.classList.add('hidden'));
$('btnPhishingProceed').addEventListener('click', () => phishingBanner.classList.add('hidden'));
$('aboutWebsite').addEventListener('click', e => {
  e.preventDefault();
  navigateActive('https://kriptoentuzijasti.io');
  $('modalAbout').classList.add('hidden');
});

// Window controls
$('btnMinimize').addEventListener('click', () => etherx.window.minimize());
$('btnMaximize').addEventListener('click', () => etherx.window.maximize());
$('btnClose').addEventListener('click', () => etherx.window.close());

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case 't': e.preventDefault(); createTab({ url: 'etherx://newtab' }); break;
      case 'w': e.preventDefault(); if (state.activeTabId) closeTab(state.activeTabId); break;
      case 'l': e.preventDefault(); urlInput.focus(); urlInput.select(); break;
      case 'r': e.preventDefault(); getActiveWv()?.reload(); break;
      case 'f': e.preventDefault(); toggleFullscreen(); break;
      case '+': case '=': e.preventDefault(); setZoom(state.zoom + 10); break;
      case '-': e.preventDefault(); setZoom(state.zoom - 10); break;
      case '0': e.preventDefault(); setZoom(100); break;
      case 'h': e.preventDefault(); openHistorySidebar(); break;
      case 'd': e.preventDefault(); toggleBookmarkCurrent(); break;
      case 'j': e.preventDefault(); etherx.window.devTools(); break;
      case 'n': if (e.shiftKey) { e.preventDefault(); createTab({ url: 'etherx://newtab', incognito: true }); } break;
    }
  }
  if (e.key === 'F5') { e.preventDefault(); getActiveWv()?.reload(); }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
  if (e.key === 'F12') { e.preventDefault(); etherx.window.devTools(); }
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
