# EtherX Browser Development - Detailed To-Do List

This document outlines the major steps and functionalities required to develop "EtherX Browser" based on Chromium. Building a full-featured web browser is a highly complex and long-term project.

---

## 📊 PROGRESS SUMMARY (Updated: Mar 6, 2026)

### 🚀 GitHub Repositories

#### Desktop App (Electron)

- **Repository:** https://github.com/ktrucek/etherx-browser-2
- **macOS Intel:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-1.0.0-x64.dmg
- **macOS ARM:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-1.0.0-arm64.dmg
- **Windows:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-Setup-1.0.0.exe
- **Linux:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-1.0.0.AppImage

#### Mobile App (React Native)

- **Repository:** https://github.com/ktrucek/etherx-mobile
- **Android APK:** https://github.com/ktrucek/etherx-mobile/releases/latest/download/app-release.apk
- **iOS IPA:** https://github.com/ktrucek/etherx-mobile/releases/latest/download/EtherXMobile.ipa

#### Web Version (PWA)

- **Live Demo:** https://n8n.kriptoentuzijasti.io/browser.html
- **Install:** Klikni "Add to Home Screen" ili koristi browser install opciju

#### Credentials

- **GitHub Token:** (stored securely, see GitHub Settings)
- **CI/CD:** GitHub Actions automatski buildovi za sve platforme

---

## 🔥 HITNE ISPRAVKE - BUG REPORT (6. Ožujak 2026)

### 🔴 KRITIČNI PRIORITET

#### Window Management & Taskbar

- [ ] **#2** - Desni klik na taskbar ikonu ne omogućuje otvaranje novog prozora ili incognito prozora
  - Implementirati taskbar context menu opcije: "New Window", "New Incognito Window"
- [ ] **#13** - "Move tab to new window" otvara bijeli ekran - ne može se upisati web adresa
  - Ispraviti tab extraction funkcionalnost i inicijalizaciju novog prozora
- [ ] **#19** - Popup prozor se ne može vratiti u tab
  - Dodati funkcionalnost konverzije popup → tab
  - Omogućiti drag & drop tab-ova van i unutar prozora

#### Navigation & Address Bar

- [ ] **#26** - `https://riječ` upis u address bar pokazuje bijeli ekran
  - Dodati fallback na odabranu tražilicu (Google) ako stranica ne postoji
  - Implementirati search/navigate detection logiku
- [ ] **#1** - YouTube se ne otvara u zasebnom prozoru
  - Ispraviti popup window handling za YouTube i slične domene

#### Console Errors (BLOKIRA RELEASE!)

- [ ] **#35a** - `DOM tree render failed: Failed to read 'document' from 'Window': Blocked cross-origin frame`
  - Ispraviti cross-origin frame access u DevTools
- [ ] **#35b** - `Uncaught Error: prompt() is not supported` (2 lokacije: lines 9312, 12026)
  - Zamijeniti prompt() pozive sa custom dialog implementacijom
- [ ] **#35c** - `Uncaught ReferenceError: showPageError is not defined` (line 7930)
  - Definirati showPageError funkciju ili ukloniti poziv
- [ ] **#35d** - `Unexpected error while loading URL {}` u browser.html
  - Debug i ispravi URL loading error handling

---

### 🟡 VISOKI PRIORITET

#### UI/UX Komponente

- [ ] **#3** - Strelice naprijed/nazad su premale
  - Povećati veličinu back/forward navigation arrows (min 32px)
  - Poboljšati vidljivost i hover state
- [ ] **#4** - File menu nema "New Window" i "New Private Window"
  - Dodati menuItem za New Window (Ctrl+N)
  - Dodati menuItem za New Private Window (Ctrl+Shift+N)
- [ ] **#6** - Gornje lijevo window control točke nemaju X, kvadrat, minus
  - Implementirati window controls: minimize, maximize/restore, close
  - Koristiti standardne SVG ikone
- [ ] **#23** - Share gumb i strelica gore lijevo ne rade
  - Implementirati share funkcionalnost (copy URL, QR code, social)
  - Dodati dropdown arrow funkcionalnost

#### Zoom & Scrolling

- [ ] **#5** - Zoom kontrole ne rade pravilno
  - `Ctrl++` ne povećava stranicu (implementirati)
  - `Ctrl+-` radi (provjereno OK)
  - `Scroll + Shift` dodati za zoom in/out
  - Dodati `Ctrl+0` za reset zoom na 100%

#### Homepage & Navigation

- [ ] **#7** - Home tipka vodi na startpage umjesto homepage
  - **Settings → General**: Dodati opciju izbora "Home button action"
    - [ ] Homepage (custom URL)
    - [ ] Start Page (built-in)
    - [ ] New Tab Page
  - Spremiti user preference u localStorage/SQLite

#### Session Management

- [ ] **#8** - "All windows from last session" - ne pokreće se svaki put
  - Debug session restore funkcionalnost
  - Provjeriti SQLite `tab_sessions` tablicu
  - Implementirati reliable window/tab state persistence

#### Screenshots

- [ ] **#9** - View → Take Screenshot: Dodati rectangle selection
  - Implementirati area selection overlay (crosshair cursor)
  - Dodati preview i save/copy opcije
  - Keyboard shortcuts: `Ctrl+Shift+S` za region, `Ctrl+Shift+F` za fullpage

---

### 🟢 SREDNJI PRIORITET

#### History

- [ ] **#10** - History: Ispod "Clear history" prikazati top 10 najčešće posjećenih
  - Query SQLite history table: `SELECT url, COUNT(*) as visits FROM history GROUP BY url ORDER BY visits DESC LIMIT 10`
  - Kreirati UI section "Most Visited"

#### Bookmarks

- [ ] **#11** - Bookmark Manager: Puna funkcionalnost
  - [ ] Folder creation i nested structure
  - [ ] Import bookmarks (HTML format)
  - [ ] Export bookmarks (HTML format)
  - [ ] Drag & drop reordering
  - [ ] Sidebar bookmark panel
  - [ ] Search bookmarks
  - [ ] Edit bookmark (name, URL, folder)
- [ ] **#12** - "Add bookmark folder" ne radi u glavnom bookmark dijelu
  - Debugirati folder creation u bookmark manager UI
  - Spremiti folder strukturu u SQLite `bookmarks` tablica

#### Downloads

- [ ] **#15** - Downloads se ne prikazuju u Download manager prozoru
  - Hookati Electron `will-download` event
  - Spremiti download info u SQLite `downloads` tablica
  - Update UI real-time tijekom downloada
- [ ] **#16** - Download Manager: Dodatne opcije
  - [ ] "Clear All" button
  - [ ] Delete pojedinačni download (kontekstni menu)
  - [ ] "Show in Folder" / "Open Containing Folder"
  - [ ] Pause/Resume download (ako podržano)
  - [ ] Retry failed download

#### Window Features

- [ ] **#14** - Window split screen funkcionalnost
  - Implementirati snap to half: lijevo (Win+Left), desno (Win+Right)
  - Snap to quarters: gore lijevo, gore desno, dolje lijevo, dolje desno
  - Integration sa OS window manager (Windows Snap Assist, macOS Split View)

#### Popups & Multi-Account

- [ ] **#17** - Google search otvara linkove u popup prozoru umjesto istog tab-a
  - Konfigurirati webPreferences: `nativeWindowOpen: false`
  - Hookati `new-window` event i preusmjeriti u isti tab ili novi tab (user preference)
- [ ] **#18** - Nije moguće otvoriti više Gmail/Google accounta zbog popup blokera
  - Allowlist Google domene za popups (`accounts.google.com`, `mail.google.com`)
  - Implementirati pametan popup manager (user whitelist/blacklist)

---

### 🟢 SREDNJI PRIORITET - Settings & Customization

#### Profile Management

- [ ] **#22** - Manage Profile: Dodati profile picture upload
  - File picker za avatar image
  - Crop/resize na 128x128px
  - Spremiti kao base64 u SQLite `user_profile` tablica ili kao file u `userData` folder

#### Appearance Settings

- [ ] **#21** - Top bar clock/time: Customization opcije
  - **Settings → Appearance → Title Bar**:
    - [ ] Clock font size (12px - 24px slider)
    - [ ] Clock color picker
    - [ ] Date format (short/long)
    - [ ] Show/hide clock toggle
- [ ] **#27** - Settings → Appearance: Font & color customization
  - [ ] UI font family dropdown
  - [ ] UI font size (small/medium/large)
  - [ ] Accent color picker
  - [ ] Custom CSS support (advanced)
- [ ] **#28** - Toolbar & Bottom Bar: Right-click context menu
  - [ ] "Remove from toolbar"
  - [ ] "Move left/right"
  - [ ] "Customize toolbar..."
  - [ ] "Lock toolbar" toggle

#### Start Page

- [ ] **#20** - Start Page: Customization
  - [ ] Prikazati "Recently Visited" (iz SQLite history)
  - [ ] Drag & drop tiles reordering
  - [ ] Add/remove custom tiles
  - [ ] Wallpaper picker (solid color, gradient, image upload, Unsplash API)

---

### 🔵 DATABASE & BACKEND (SQLite)

#### SQLite Tables - Ne Rade / Prazne

- [ ] **#30a** - `open_tabs` tablica prazna
  - Implementirati save open tabs on window close
  - Load tabs on browser start (ako "Restore session" enabled)
- [ ] **#30b** - `ai_cache` - AI agent ne sprema podatke
  - Hookati AI agent responses
  - Spremiti `{prompt, response, timestamp}` u `ai_cache` tablica
- [ ] **#30c** - `user_profile` prazna (no name, no email)
  - **Settings → Profile**: Dodati input polja za:
    - [ ] Full Name
    - [ ] Email
    - [ ] Avatar upload
    - [ ] Bio/Description
  - Save to SQLite on change
- [ ] **#30d** - Notes frontend ne postoji
  - Kreirati Notes panel (sidebar ili modal)
  - CRUD operacije: Create, Read, Update, Delete note
  - Rich text editor (Quill.js, TinyMCE ili simple textarea)
  - Save notes u SQLite `notes` tablica
- [ ] **#30e** - `downloads` tablica prazna (povezano sa #15)
  - Fix download tracking (vidi #15)
- [ ] **#30f** - `tab_sessions` prazna
  - Implementirati tab session persistence (vidi #8, #30a)
- [ ] **#30g** - `passwords` tablica prazna
  - Provjeriti da li Password Manager sprema lozinke u SQLite
  - Enkriptirati lozinke prije spremanja (crypto.js AES ili native keychain API)

#### Dodatne DB Funkcionalnosti

- [ ] **#31** - Lighthouse: Dodati u SQLite
  - Run Lighthouse audit on page
  - Spremiti rezultate u novu tablicu `lighthouse_audits`:
    - `{url, performance_score, accessibility_score, best_practices_score, seo_score, timestamp}`
  - UI panel za pregled Lighthouse history
- [ ] **#32** - Clear Cookies: Ne prikazuje cookie lista
  - **DevTools → Application → Cookies**: Prikaz svih cookies
  - **Settings → Security → Cookies**: "Clear All Cookies" button
  - Lista individual cookies sa delete opcijom
- [ ] **#33** - Performance metrics: CLS, LCP, TBT ne prikazuje
  - **DevTools → Performance tab**: Dodati Core Web Vitals panel
  - Koristiti `PerformanceObserver` API:
    - CLS (Cumulative Layout Shift)
    - LCP (Largest Contentful Paint)
    - TBT (Total Blocking Time)
    - FID (First Input Delay)
- [ ] **#34** - Elements tab: "Cannot access frame document (cross-origin)"
  - Expected behavior za cross-origin iframes (security limitation)
  - Dodati user-friendly poruku umjesto error-a

---

### 🟣 EXTENSIONS & INTEGRATIONS

#### BobiAI Wallet

- [ ] **#24** - BobiAI wallet se resetira svaku sesiju
  - Spremiti wallet state u SQLite `wallet_state` tablica
  - Enkriptirati private keys sa master password
  - Restore wallet on browser start (ne tražiti seed words svaki put)
  - Implementirati seed phrase backup/restore UI

#### AI Agent

- [ ] **#25** - AI Agent UI problemi
  - [ ] Scrolling issue: Auto-scroll to bottom when new message
    - `chatContainer.scrollTop = chatContainer.scrollHeight`
  - [ ] Input bar ne prati scroll - fiksirati input bar na donje sticky position
  - [ ] SQLite data collection: Spremati AI conversations (vidi #30b)

#### AI Page Summary

- [ ] **#36** - Sažetak stranice (Page Summary) sa AI modelom
  - [ ] **Backend implementacija:**
    - Dodati AI service koji šalje page content na API
    - Podržati multiple AI providers:
      - OpenAI (GPT-4, GPT-3.5-turbo)
      - Anthropic Claude (claude-3-opus, claude-3-sonnet)
      - Google Gemini (gemini-pro)
      - Local models (Ollama, LM Studio)
    - Ekstraktirati glavni content stranice (strip ads, navigation, footer)
    - API endpoint struktura:
      ```javascript
      // src/main/aiSummary.js
      async function summarizePage(pageContent, model, apiKey) {
        const providers = {
          openai: "https://api.openai.com/v1/chat/completions",
          anthropic: "https://api.anthropic.com/v1/messages",
          gemini: "https://generativelanguage.googleapis.com/v1/models",
        };
        // POST request sa page content
      }
      ```
  - [ ] **Settings → AI → Page Summary:**
    - **AI Provider dropdown:**
      - OpenAI
      - Anthropic Claude
      - Google Gemini
      - Ollama (local)
      - Custom API endpoint
    - **Model selection** (dynamic based on provider):
      - OpenAI: gpt-4-turbo, gpt-4, gpt-3.5-turbo
      - Claude: claude-3-opus, claude-3-sonnet, claude-3-haiku
      - Gemini: gemini-pro, gemini-pro-vision
    - **API Key input field** (encrypted storage):
      - Spremiti u SQLite `settings` tablica sa AES-256 enkripcijom
      - `{provider: 'openai', api_key: encrypt('sk-...')}`
      - Validation: Test API key button
    - **Summary length slider:** Short (100 words) / Medium (250 words) / Long (500 words)
    - **Summary language:** Auto-detect / Hrvatski / English / Deutsch...
    - **Include key points:** Checkbox - bullet points sa glavnim temama
  - [ ] **UI implementacija:**
    - [ ] **Context menu opcija:** Right-click → "Summarize Page with AI"
    - [ ] **Toolbar button:** AI sparkle ikona ✨
    - [ ] **Keyboard shortcut:** `Ctrl+Shift+A` (AI Summary)
    - [ ] **Summary modal/sidebar:**
      - Naslov: "AI Page Summary - [page title]"
      - Loading state sa progress indicator
      - Summary text sa formatted output
      - Akcije: Copy, Save to Notes, Share, Regenerate
    - [ ] Error handling:
      - Invalid API key → Link to Settings
      - Rate limit → "Please try again in X seconds"
      - Page too long → "Summarizing first 10,000 words..."
  - [ ] **SQLite storage:**
    - Nova tablica `page_summaries`:
      ```sql
      CREATE TABLE page_summaries (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        summary TEXT,
        model TEXT,
        word_count INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      ```
    - Cache summaries - ne slati isti request 2x
  - [ ] **Advanced features:**
    - [ ] Summary history (pristup starim sažecima)
    - [ ] Compare pages side-by-side
    - [ ] Auto-summarize on page load (toggle u Settings)
    - [ ] Export summary as PDF/TXT/Markdown
    - [ ] TTS (Text-to-Speech) - čitaj sažetak naglas

---

### ⚪ NISKI PRIORITET

#### Developer Tools

- [ ] **#29** - Developer Tools toggle problemi
  - Mobile view: DevTools donji panel ne može se ugasiti
  - X button ponekad ne radi
  - Dodati keyboard shortcut `F12` za toggle DevTools
  - Fix mobile responsive DevTools positioning

---

## 📊 BUG REPORT STATISTIKA

- **Ukupno zadataka:** 36
- **Kritični (BLOCKER):** 8
- **Visoki prioritet:** 6
- **Srednji prioritet:** 13
- **Database/Backend:** 8
- **AI Features:** 2
- **Niski prioritet:** 1

---

## 🎯 PREPORUČENI PLAN RADA

### Sprint 1 - Kritični Bugovi (Tjedan 1-2)

**Cilj:** Riješiti sve blokere i kritične errore

1. **Console errors** (#35a, #35b, #35c, #35d) - MORA biti clean console!
2. **Address bar white screen** (#26) - Core funkcionalnost
3. **Tab/Window management** (#13, #19) - Osnovne browser funkcije
4. **Taskbar integration** (#2) - Native OS integracija

### Sprint 2 - UI & Navigation (Tjedan 3-4)

**Cilj:** Polishing user-facing UI komponenti

1. **Navigation controls** (#3, #4, #6, #23) - Vidljivost i funkcionalnost
2. **Zoom functionality** (#5) - Standard browser feature
3. **Homepage/Session** (#7, #8) - User preferences
4. **Screenshots** (#9) - Value-add feature

### Sprint 3 - Content Management (Tjedan 5-6)

**Cilj:** Bookmarks, History, Downloads

1. **Bookmarks** (#11, #12) - Full bookmark manager
2. **Downloads** (#15, #16) - Download tracking i management
3. **History** (#10) - Frequently visited sites
4. **Popups** (#17, #18) - Multi-account support

### Sprint 4 - Settings & Customization (Tjedan 7-8)

**Cilj:** User personalization

1. **Appearance settings** (#21, #27, #28) - Theme customization
2. **Profile management** (#22) - Avatar upload
3. **Start page** (#20) - Custom tiles
4. **Window features** (#14) - Snap/split screen

### Sprint 5 - Database & Backend (Tjedan 9-10)

**Cilj:** Data persistence i analytics

1. **SQLite tables** (#30a-g) - Fix all empty tables
2. **AI Agent** (#25) - UI fix + data collection
3. **AI Page Summary** (#36) - Implementacija sa API key settings i model selection
4. **BobiAI Wallet** (#24) - Persistent state
5. **Performance metrics** (#31, #33) - Lighthouse + Web Vitals

### Sprint 6 - Polish & DevTools (Tjedan 11-12)

**Cilj:** Developer experience i final polish

1. **DevTools fixes** (#29, #32, #34) - Stable dev environment
2. **Testing** - Regression testing svih fixeva
3. **Documentation** - Update user docs
4. **Release prep** - Changelog, release notes

---

## 🚨 IMMEDIATE ACTION ITEMS

**Danas (6. Ožujak):**

1. Fix console errors (#35) - Clean console test
2. Address bar search fallback (#26)
3. YouTube popup (#1)

**Ovaj tjedan:**

1. Tab/window management (#13, #19, #2)
2. Navigation UI (#3, #4, #6)
3. Zoom controls (#5)

**Sljedeći tjedan:**

1. Bookmarks (#11, #12)
2. Downloads (#15, #16)
3. Session restore (#8)

**AI Features setup:**

1. Page Summary API integration (#36) - dodati Settings → AI sekciju
2. API key storage sa enkripcijom
3. Multi-provider support (OpenAI, Claude, Gemini, Ollama)

---

### ✅ Phase 6 — COMPLETED (Mar 6, 2026):

- **Task 1** ✅ React Native mobilna app (iOS + Android)
  - Kreiran potpun iOS native projekt (Podfile, Info.plist, AppDelegate, Xcode config)
  - Kreiran potpun Android native projekt (build.gradle, AndroidManifest.xml, MainActivity, MainApplication)
  - App.tsx - multi-tab browser s Web3 injekcijom i localStorage bridge
  - index.js, app.json - React Native entry points
  - Pushano na https://github.com/ktrucek/etherx-mobile

- **Task 2** ✅ Electron desktop app (macOS/Windows/Linux)
  - package.json s electron-builder konfiguracijom
  - src/main.js - glavna Electron aplikacija
  - src/preload.js - context bridge
  - GitHub Actions workflow za Mac (Intel+ARM), Windows, Linux
  - Pushano na https://github.com/ktrucek/etherx-browser-2

- **Task 3** ✅ Hrvatski prijevod Settings/DevTools
  - Prevedeni svi Settings tabovi: General→Općenito, Passwords→Lozinke, Security→Sigurnost, itd.
  - MD5: 4c7b5e094e445be6b0bdc563a972888a
  - Deploy na production

- **Task 4** ✅ Reorganizacija GitHub repozitorija
  - etherx-mobile: React Native app (iOS/Android)
  - etherx-browser-2: Electron app (Mac/Win/Linux)
  - Odvojeni CI/CD workflows za svaki repo

### ✅ Phase 5 — COMPLETED (Mar 5, 2026):

- **Task 1** ✅ Datum pored sata u title baru (hr-HR lokalizacija)
- **Task 2** ✅ Settings → Appearance → Title Bar Items (kontrola vidljivosti)
- **Task 3** ✅ Fix kriptoentuzijasti.io iframe (CSP frame-ancestors u vhost.conf)
- **Task 4** ✅ Media integracija (iframe allow: camera, mic, autoplay, fullscreen, encrypted-media)
- **Task 5** ✅ Biometrijska autentikacija — WebAuthn (fingerprint / FaceID)
- **Task 6** ✅ Downloadable browser:
  - Electron app struktura (package.json, main.js, preload.js)
  - PWA manifest.json + sw.js service worker (offline support)
  - download.html landing page
  - GitHub repo + GitHub Actions CI/CD workflow (Mac .dmg, Win .exe, Linux .AppImage)
  - PWA instalacija: iOS/Android/Desktop (Add to Home Screen)

### ✅ Phase 4.1 — COMPLETED:

- AI Agent upgrade (WordPress REST API search, system health, crypto knowledge)
- BobiAI Studio panel
- Profili, PWA, appearance settings

### ✅ Phases 1–4 — COMPLETED:

- Core browser UI, DevTools, NTP, extensions
- Edit menu, mobile CSS, panels, bookmarks, history
- Passwords, profiles, biometric auth
- Crypto wallet panel, Web3 integration

### 🔄 Pending / Next Steps:

- [ ] Settings → Toolbar tab (Right toolbar toggle kontrole)
- [ ] Chrome Web Store - featured extensions lista (umjesto iframe)
- [ ] Cookie persistencija - istraži zašto se gubi session
- [ ] Electron desktop build (pokrenuti npm run build:mac/win/linux lokalno)
- [ ] GitHub Release s pravim .dmg/.exe download linkovima
- [ ] GitHub Pages deployment za download.html

---

### ✅ Completed:

- **Phase 1.1**: Chromium Architecture Research - COMPLETE
  - Research materials generated
  - Study guides created
  - Example projects cloned (Electron)
- **Phase 1.2**: Environment Setup - IN PROGRESS
  - System requirements verified (16 cores, 61GB RAM, 624GB disk)
  - Build dependencies installed
  - depot_tools cloned to `/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/depot_tools`

### 🔄 In Progress:

- **UI/UX Design**: Creating browser mockup/prototype

### 📁 Project Structure Created:

```
/var/www/vhosts/kriptoentuzijasti.io/
├── AI projekt/browser/          (Project files: scripts, docs)
└── etherx_browser/              (Chromium build: ~45GB)
    └── depot_tools/             (✓ Installed)
```

---

## Phase 1: Research and Development Environment Setup

### 1.1 Understand Chromium Architecture ✅ COMPLETE

**Script:** `scripts/phase1/01_chromium_architecture_research.sh`

- [ ] **Multi-Process Architecture Research:**
  - [ ] Study Browser process (main process, UI thread, manages other processes)
  - [ ] Study Renderer process (one per tab, runs Blink rendering engine and V8)
  - [ ] Study GPU process (handles GPU tasks for multiple renderer processes)
  - [ ] Study Plugin process (runs plugin code like Flash, isolated from browser)
  - [ ] Study Utility processes (audio, network, storage services)
  - [ ] Document IPC (Inter-Process Communication) mechanisms
  - [ ] Resources: https://www.chromium.org/developers/design-documents/multi-process-architecture/
- [ ] **Core Components Deep Dive:**
  - [ ] **Blink Rendering Engine:**
    - [ ] Understand HTML/CSS parsing
    - [ ] Study Layout engine (LayoutNG)
    - [ ] Research Paint and Compositing layers
    - [ ] DOM tree construction and manipulation
  - [ ] **V8 JavaScript Engine:**
    - [ ] Study JIT compilation
    - [ ] Understand memory management and garbage collection
    - [ ] Research V8 API for embedding
    - [ ] WebAssembly support
  - [ ] **Content API:**
    - [ ] Study Content module structure
    - [ ] Understand ContentBrowserClient and ContentRendererClient
    - [ ] Research WebContents and RenderViewHost
    - [ ] Navigation and session history management
  - [ ] **UI Layers:**
    - [ ] Study Views framework (Aura/Views)
    - [ ] Understand native window integration
    - [ ] Research browser UI components (toolbar, tabs, menus)
- [ ] **Explore Chromium-based Projects:**
  - [ ] **Electron:**
    - [ ] Study Electron architecture
    - [ ] Understand main process vs renderer process
    - [ ] Review Node.js integration
    - [ ] Example projects analysis
  - [ ] **CEF (Chromium Embedded Framework):**
    - [ ] Download and study CEF3 architecture
    - [ ] Understand CefClient, CefBrowser, CefApp interfaces
    - [ ] Review sample applications (cefclient, cefsimple)
    - [ ] Study JavaScript-C++ bridge (CefV8 bindings)
  - [ ] **Other browsers:**
    - [ ] Brave browser architecture
    - [ ] Vivaldi browser customizations
    - [ ] Edge Chromium modifications

### 1.2 Set Up Development Environment

**Script:** `scripts/phase1/02_environment_setup.sh`

- [ ] **System Requirements Check:**
  - [ ] Verify minimum 100GB free disk space (Chromium source is ~30GB)
  - [ ] Check RAM: minimum 16GB, recommended 32GB
  - [ ] Verify 64-bit Linux/macOS/Windows
  - [ ] Check CPU: multi-core recommended (8+ cores ideal)
- [ ] **Install Core Prerequisites:**
  - [ ] **Git:** Version 2.30+ (`sudo apt install git` or `brew install git`)
  - [ ] **Python:** Version 3.8+ (`sudo apt install python3 python3-pip`)
  - [ ] **Ninja Build System:** (`sudo apt install ninja-build`)
  - [ ] **pkg-config:** (`sudo apt install pkg-config`)
  - [ ] **Curl:** (`sudo apt install curl`)
- [ ] **Install Development Tools (Linux):**
  - [ ] GCC/G++ 10+ or Clang 14+ (`sudo apt install build-essential`)
  - [ ] GTK3+ development files (`sudo apt install libgtk-3-dev`)
  - [ ] NSS development files (`sudo apt install libnss3-dev`)
  - [ ] X11 development files (`sudo apt install libx11-dev`)
  - [ ] Additional libs: `sudo apt install libglib2.0-dev libdbus-1-dev libasound2-dev libpulse-dev libxtst-dev libxss-dev libpci-dev libcups2-dev libxkbcommon-dev`
- [ ] **Install Depot Tools:**
  ```bash
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
  export PATH="$PATH:$HOME/depot_tools"
  echo 'export PATH="$PATH:$HOME/depot_tools"' >> ~/.bashrc
  ```
- [ ] **Configure Git:**
  ```bash
  git config --global user.name "Kristijan"
  git config --global user.email "ktrucek@gmail.com"
  git config --global core.autocrlf false
  git config --global core.filemode false
  git config --global branch.autosetuprebase always
  ```
- [ ] **IDE Setup:**
  - [ ] Install Visual Studio Code with C++ extensions
  - [ ] Or CLion with Chromium support
  - [ ] Configure code formatting (clang-format)
  - [ ] Setup debugging tools (gdb/lldb)

### 1.3 Obtain Chromium Source Code

**Script:** `scripts/phase1/03_chromium_download.sh`

- [ ] **Create Working Directory:**
  ```bash
  mkdir -p ~/chromium
  cd ~/chromium
  ```
- [ ] **Fetch Chromium Source:**
  ```bash
  fetch --nohooks chromium
  # This downloads ~30GB and takes 1-2 hours
  ```
- [ ] **Checkout Specific Version (Stable):**
  ```bash
  cd src
  git fetch --tags
  git checkout -b etherx-browser tags/120.0.6099.109  # Latest stable
  gclient sync --with_branch_heads --with_tags
  ```
- [ ] **Install Build Dependencies:**
  ```bash
  ./build/install-build-deps.sh --no-prompt
  ```
- [ ] **Understand Repository Structure:**
  - [ ] `/chrome` - Chrome browser-specific code
  - [ ] `/content` - Content API (core rendering engine)
  - [ ] `/components` - Shared components
  - [ ] `/ui` - UI framework
  - [ ] `/third_party` - External dependencies
  - [ ] `/out` - Build output directory
  - [ ] `/tools` - Development tools
  - [ ] `/v8` - V8 JavaScript engine
  - [ ] `/net` - Network stack
  - [ ] `/base` - Base libraries (strings, threading, etc.)

### 1.4 Familiarize with Chromium Build Process

**Script:** `scripts/phase1/04_chromium_build.sh`

- [ ] **Generate Build Configuration:**
  ```bash
  gn gen out/Default --args='is_debug=false is_component_build=true symbol_level=1'
  ```
- [ ] **Configure Build Arguments (`args.gn`):**
  - [ ] Edit `out/Default/args.gn`:

  ```gn
  # Basic configuration
  is_debug = false
  is_component_build = true  # Faster linking
  symbol_level = 1  # Minimal symbols for debugging

  # Optimizations
  enable_nacl = false  # Disable Native Client
  enable_widevine = false  # Disable DRM

  # Branding
  chrome_pgo_phase = 0  # Disable PGO
  is_official_build = false

  # Features to disable for faster builds
  enable_hangout_services_extension = false
  enable_iterator_debugging = false

  # Target architecture
  target_cpu = "x64"
  ```

- [ ] **Build Chromium Content Shell (Minimal Browser):**
  ```bash
  autoninja -C out/Default content_shell
  # This takes 2-4 hours on first build
  ```
- [ ] **Test the Build:**
  ```bash
  out/Default/content_shell --no-sandbox
  ```
- [ ] **Build Full Chrome (Optional):**
  ```bash
  autoninja -C out/Default chrome
  ```
- [ ] **Understand Debugging:**
  - [ ] Setup VS Code debugging: create `.vscode/launch.json`
  - [ ] Use `gdb` or `lldb` for debugging
  - [ ] Enable verbose logging: `--enable-logging --v=1`
  - [ ] Chrome DevTools for renderer debugging
- [ ] **Incremental Build Testing:**
  ```bash
  # Make a small change to test incremental builds
  touch content/shell/app/shell_main.cc
  autoninja -C out/Default content_shell  # Should be fast (~minutes)
  ```

## Phase 2: Core Browser Functionality (Minimum Viable Product)

### 2.1 Basic Application Shell

**Script:** `scripts/phase2/01_application_shell.sh`

- [ ] **Choose UI Framework:**
  - [ ] **Option A: Use CEF (Recommended for beginners):**
    - [ ] Download CEF binaries: https://cef-builds.spotifycdn.com/index.html
    - [ ] Extract CEF SDK
    - [ ] Study CEF minimal example (cefsimple)
    - [ ] Understand CefApp lifecycle
  - [ ] **Option B: Direct Content API (Advanced):**
    - [ ] Study content_shell implementation
    - [ ] Create custom ContentMainDelegate
    - [ ] Implement ContentBrowserClient
  - [ ] **Option C: Electron (JavaScript-based):**
    - [ ] Initialize Node.js project
    - [ ] Install Electron: `npm install electron --save-dev`
    - [ ] Create main process entry point
- [ ] **Create Project Structure:**
  ```
  etherx-browser/
  ├── src/
  │   ├── browser/           # Browser process code
  │   ├── renderer/          # Renderer process code
  │   ├── common/            # Shared code
  │   ├── ui/                # UI components
  │   └── main.cc            # Entry point
  ├── resources/
  │   ├── icons/
  │   ├── ui/
  │   └── locales/
  ├── build/
  ├── CMakeLists.txt or BUILD.gn
  └── README.md
  ```
- [ ] **Main Window Creation (CEF Example):**

  ```cpp
  // Implement CefApp
  class EtherXApp : public CefApp,
                    public CefBrowserProcessHandler {
   public:
    CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
      return this;
    }
   private:
    IMPLEMENT_REFCOUNTING(EtherXApp);
  };

  // Create main window
  CefWindowInfo window_info;
  window_info.SetAsPopup(nullptr, "EtherX Browser");

  CefBrowserSettings browser_settings;
  CefBrowserHost::CreateBrowser(
      window_info, handler, "https://www.google.com",
      browser_settings, nullptr, nullptr);
  ```

- [ ] **Implement Window Controls:**
  - [ ] Minimize button handler
  - [ ] Maximize/Restore button handler
  - [ ] Close button handler with cleanup
  - [ ] Window drag functionality
  - [ ] Window resizing
  - [ ] Window state persistence (position, size)
- [ ] **Cross-Platform Window Management:**
  - [ ] Linux: GTK+ or X11 window creation
  - [ ] Windows: Win32 API window creation
  - [ ] macOS: Cocoa NSWindow creation
- [ ] **Application Lifecycle:**
  - [ ] Initialize CEF/Content API
  - [ ] Create message loop
  - [ ] Handle shutdown gracefully
  - [ ] Cleanup resources on exit

### 2.2 Embed Chromium Content API/WebView

**Script:** `scripts/phase2/02_embed_webview.sh`

- [ ] **CEF Integration:**
  - [ ] Implement CefClient interface
  - [ ] Create CefLifeSpanHandler for browser lifecycle
  - [ ] Implement CefLoadHandler for page load events
  - [ ] Setup CefRenderHandler for off-screen rendering (optional)
- [ ] **WebView Configuration:**
  ```cpp
  CefBrowserSettings settings;
  settings.windowless_frame_rate = 60;  // FPS for rendering
  settings.web_gl = STATE_ENABLED;
  settings.javascript = STATE_ENABLED;
  settings.javascript_close_windows = STATE_DISABLED;
  settings.javascript_access_clipboard = STATE_DISABLED;
  settings.local_storage = STATE_ENABLED;
  settings.databases = STATE_ENABLED;
  ```
- [ ] **Display Web Content in Window:**
  - [ ] Create browser instance with window handle
  - [ ] Attach browser view to main window
  - [ ] Handle window resizing to resize browser view
  - [ ] Implement focus management
- [ ] **IPC Setup (Browser ↔ Renderer):**
  - [ ] Implement CefRenderProcessHandler
  - [ ] Setup message routing for JavaScript ↔ C++ communication
  - [ ] Create custom protocol handlers (for etherx:// URLs)
- [ ] **JavaScript Bridge:**
  ```cpp
  // Register JavaScript binding
  CefRefPtr<CefV8Value> object = CefV8Value::CreateObject(nullptr, nullptr);
  object->SetValue("callNative",
                   CefV8Value::CreateFunction("callNative", handler),
                   V8_PROPERTY_ATTRIBUTE_NONE);
  ```

### 2.3 Navigation Bar

**Script:** `scripts/phase2/03_navigation_bar.sh`

- [ ] **Address Bar Implementation:**
  - [ ] Create URL input widget (QLineEdit, GTK Entry, Win32 Edit Control)
  - [ ] Implement URL validation and autocomplete
  - [ ] Add search suggestion dropdown
  - [ ] Handle "Enter" key press for navigation
  - [ ] Display current page URL
  - [ ] Highlight URL components (protocol, domain, path)
  - [ ] Security indicators (HTTPS lock icon)
- [ ] **Navigation Buttons:**
  - [ ] **Back Button:**
    ```cpp
    browser->GoBack();
    // Enable/disable based on browser->CanGoBack()
    ```
  - [ ] **Forward Button:**
    ```cpp
    browser->GoForward();
    // Enable/disable based on browser->CanGoForward()
    ```
  - [ ] **Refresh/Stop Button:**
    ```cpp
    if (is_loading) {
        browser->StopLoad();
    } else {
        browser->Reload();
    }
    ```
  - [ ] **Home Button:**
    ```cpp
    browser->GetMainFrame()->LoadURL("etherx://newtab");
    ```
- [ ] **URL Navigation Logic:**
  ```cpp
  void Navigate(const std::string& input) {
      std::string url;
      if (IsValidURL(input)) {
          url = input;
      } else if (ContainsDomain(input)) {
          url = "https://" + input;
      } else {
          // Search with default search engine
          url = "https://www.google.com/search?q=" + UrlEncode(input);
      }
      browser->GetMainFrame()->LoadURL(url);
  }
  ```
- [ ] **Navigation Event Handlers:**
  - [ ] OnLoadStart: Show loading indicator
  - [ ] OnLoadEnd: Hide loading indicator, update URL
  - [ ] OnLoadError: Display error page
  - [ ] OnAddressChange: Update address bar
- [ ] **Keyboard Shortcuts:**
  - [ ] Ctrl+L: Focus address bar
  - [ ] Ctrl+R / F5: Reload
  - [ ] Ctrl+Shift+R: Hard reload
  - [ ] Alt+Left: Back
  - [ ] Alt+Right: Forward

### 2.4 Tab Management

**Script:** `scripts/phase2/04_tab_management.sh`

- [ ] **Tab Strip UI:**
  - [ ] Create tab container widget
  - [ ] Design individual tab appearance (title, icon, close button)
  - [ ] Implement tab selection highlighting
  - [ ] Add "New Tab" button (+)
  - [ ] Support tab drag-and-drop reordering
- [ ] **Tab Data Structure:**

  ```cpp
  struct Tab {
      int id;
      CefRefPtr<CefBrowser> browser;
      std::string title;
      std::string url;
      CefRefPtr<CefImage> favicon;
      bool is_loading;
      bool is_pinned;
      bool is_audible;
  };

  class TabManager {
      std::vector<std::unique_ptr<Tab>> tabs_;
      int active_tab_index_;

      void CreateNewTab(const std::string& url);
      void CloseTab(int index);
      void SwitchToTab(int index);
      void MoveTab(int from_index, int to_index);
  };
  ```

- [ ] **New Tab Creation:**
  - [ ] Create new browser instance per tab
  - [ ] Load "New Tab" page (etherx://newtab)
  - [ ] Add tab to tab strip
  - [ ] Switch to newly created tab
  - [ ] Keyboard shortcut: Ctrl+T
- [ ] **Close Tab:**
  - [ ] Close browser instance
  - [ ] Remove tab from tab strip
  - [ ] Switch to adjacent tab
  - [ ] Close browser if last tab closed
  - [ ] Keyboard shortcut: Ctrl+W
  - [ ] Middle-click on tab to close
- [ ] **Switch Between Tabs:**
  - [ ] Hide previous active tab's browser view
  - [ ] Show new active tab's browser view
  - [ ] Update address bar and window title
  - [ ] Keyboard shortcuts:
    - Ctrl+Tab: Next tab
    - Ctrl+Shift+Tab: Previous tab
    - Ctrl+1-8: Switch to tab by index
    - Ctrl+9: Switch to last tab
- [ ] **Tab Features:**
  - [ ] Display page title in tab
  - [ ] Show favicon in tab
  - [ ] Display loading spinner when page is loading
  - [ ] Show audio indicator for tabs playing sound
  - [ ] Implement tab pinning (Ctrl+Shift+P)
  - [ ] Support tab muting
- [ ] **Tab Context Menu:**
  - [ ] Reload tab
  - [ ] Pin/Unpin tab
  - [ ] Mute/Unmute tab
  - [ ] Close tab
  - [ ] Close other tabs
  - [ ] Close tabs to the right
  - [ ] Reopen closed tab (Ctrl+Shift+T)
- [ ] **Tab Persistence:**
  - [ ] Save open tabs on browser close
  - [ ] Restore tabs on browser start (if enabled in settings)
  - [ ] Store in JSON or SQLite database

### 2.5 Basic Web Page Rendering

**Script:** `scripts/phase2/05_web_rendering.sh`

- [ ] **HTML Rendering:**
  - [ ] Verify HTML5 support (semantic tags, forms)
  - [ ] Test complex layouts (Flexbox, Grid)
  - [ ] Ensure proper text rendering (fonts, ligatures)
  - [ ] Image rendering (JPEG, PNG, WebP, SVG, AVIF)
- [ ] **CSS Support:**
  - [ ] CSS3 features (animations, transitions, transforms)
  - [ ] Media queries for responsive design
  - [ ] Custom fonts (@font-face)
  - [ ] CSS variables
  - [ ] CSS Grid and Flexbox
- [ ] **JavaScript Execution:**
  - [ ] ES6+ syntax support
  - [ ] Async/await support
  - [ ] Modules (import/export)
  - [ ] Web APIs (Fetch, WebSocket, etc.)
  - [ ] LocalStorage and SessionStorage
  - [ ] IndexedDB
- [ ] **Performance Optimization:**
  - [ ] Enable hardware acceleration
  - [ ] Configure GPU compositing
  - [ ] Optimize memory usage
  - [ ] Lazy loading support
- [ ] **Test Suite:**
  - [ ] Create test pages for various web standards
  - [ ] Test popular websites (Google, YouTube, Twitter, GitHub)
  - [ ] Test web apps (Gmail, Google Docs)
  - [ ] Run Acid3 test: http://acid3.acidtests.org/
  - [ ] Run HTML5Test: https://html5test.com/
- [ ] **Developer Console Integration:**
  - [ ] Enable DevTools (F12)
  - [ ] Remote debugging support
  - [ ] Console API support (console.log, etc.)

## Phase 3: Advanced Browser Features

- [ ] **Bookmarks/Favorites:**
  - [ ] Implement a system to save and manage bookmarks.
  - [ ] Create a UI for adding, editing, and organizing bookmarks.
- [ ] **History Management:**
  - [ ] Track visited URLs and page titles.
  - [ ] Implement a history view with search capabilities.
  - [ ] Provide options to clear browsing history.
- [ ] **Downloads Manager:**
  - [ ] Handle file downloads.
  - [ ] Implement a UI to view and manage ongoing and completed downloads.
- [ ] **Settings/Preferences:**
  - [ ] Create a comprehensive settings interface for user preferences, excluding "Leo AI" related settings.
  - [ ] Implement persistence for all settings.
  - [ ] **General Settings ("Get started"):**
    - [ ] Profile name and icon management.
    - [ ] Import bookmarks and settings functionality.
    - [ ] Option to set EtherX as the default browser.
    - [ ] Startup options (Open new tab page, Continue where left off, Open specific pages).
    - [ ] New tab page customization (content to show, custom page).
  - [ ] **Appearance:**
    - [ ] Options for browser theme, font sizes, zoom levels.
  - [ ] **Content:**
    - [ ] Site settings (permissions, cookies, JavaScript).
  - [ ] **Shields/Privacy Protections:**
    - [ ] Implement ad/tracker blocking, fingerprinting protection.
  - [ ] **Privacy and security:**
    - [ ] Clear browsing data, secure DNS, safety check.
  - [ ] **Web3:**
    - [ ] Web3 provider settings, default wallet.
  - [ ] **Sync:**
    - [ ] Implement data synchronization across devices (bookmarks, history, passwords).
  - [ ] **Search engine:**
    - [ ] Manage default search engines.
  - [ ] **Extensions:**
    - [ ] Manage installed extensions.
  - [ ] **Autofill and passwords:**
    - [ ] Password manager, payment methods, addresses.
  - [ ] **Languages:**
    - [ ] Browser language, spell check settings.
  - [ ] **Downloads:**
    - [ ] Download location, ask where to save each file.
  - [ ] **Accessibility:**
    - [ ] Accessibility features (e.g., captions, high contrast).
  - [ ] **System:**
    - [ ] Background apps, hardware acceleration.
  - [ ] **Reset settings:**
    - [ ] Option to restore settings to their original defaults.
- [ ] **Incognito/Private Browsing Mode:**
  - [ ] Implement a mode that doesn't save history, cookies, or site data.
- [ ] **Web3 and Wallet Integration:**
  - [ ] Research Web3 compatibility within Chromium (e.g., Ethereum Provider API, dApp interaction).
  - [ ] Integrate "kriptoenutzijasta" wallet functionality directly into the browser.
  - [ ] Implement secure communication between the browser and the integrated wallet.
  - [ ] Provide a UI for managing wallet accounts, transactions, and viewing assets.
  - [ ] Ensure seamless interaction with dApps and Web3 services.
- [ ] **Extension Support (Optional, Highly Complex):**
  - [ ] Research and implement support for Chromium extensions (e.g., Chrome Web Store extensions). This is a significant undertaking.
- [ ] **Security Features:**
  - [ ] Display HTTPS/HTTP status and security indicators.
  - [ ] Implement warnings for insecure sites or mixed content.
  - [ ] Handle certificate errors.
- [ ] **Developer Tools Integration:**
  - [ ] Integrate Chromium's built-in developer tools.

## Phase 3.5: Innovative and Unique Features

- [ ] **Decentralized Content Verification and Reputation System (DCVRS):**
  - [ ] **Research Decentralized Identity & Storage:** Explore technologies like IPFS, Ceramic, or other decentralized storage solutions for content metadata and attestations.
  - [ ] **Blockchain Integration for Trust:** Implement a mechanism to store content hashes, source metadata, and user attestations on a suitable blockchain (e.g., a custom sidechain, Polygon, or similar low-cost chain).
  - [ ] **Community-Driven Attestation Mechanism:** Develop a system for users to "verify" or "flag" content/websites, contributing to a decentralized reputation score.
  - [ ] **AI-Powered Content Analysis & Summarization:**
    - [ ] Integrate an AI model to analyze web page content for potential misinformation or bias based on DCVRS data.
    - [ ] Develop an AI to provide concise, reputation-aware summaries of web pages.
    - [ ] Implement a UI element to display the content's reputation score and AI-generated insights directly in the browser.
  - [ ] **Secure & Anonymous Attestation:** Ensure user contributions to the reputation system are pseudonymous or anonymous to prevent censorship and protect user privacy.

## Phase 4: User Interface (UI/UX) and Polish

- [ ] **Design and Implement Browser UI:**
  - [ ] Create a cohesive and intuitive user interface for all browser elements (menus, context menus, dialogs).
  - [ ] Ensure responsive design for different window sizes.
  - [ ] Integrate all core and advanced browser functionalities (e.g., Bookmarks, History, Downloads, Settings, Incognito Mode, Print, Find, Save, More Tools, Help) into a main browser menu, excluding "Leo AI" which may have a dedicated access point.
- [ ] **Theming/Customization:**
  - [ ] Allow users to customize browser appearance (e.g., light/dark mode, custom themes).
- [ ] **Error Handling and User Feedback:**
  - [ ] Implement clear error messages for network issues, page loading failures, etc.
  - [ ] Provide visual feedback for user actions.

## Phase 5: Performance, Optimization, and Testing

- [ ] **Performance Monitoring and Optimization:**
  - [ ] Profile browser performance (startup time, page load times, memory usage).
  - [ ] Identify and address performance bottlenecks.
- [ ] **Memory Management:**
  - [ ] Monitor and optimize memory consumption.
- [ ] **Testing:**
  - [ ] Implement unit tests for custom UI components and logic.
  - [ ] Conduct integration tests for core browser functionalities.
  - [ ] Perform manual testing across various websites and scenarios.
- [ ] **Debugging:**
  - [ ] Establish robust debugging workflows.

## Phase 6: Deployment and Distribution

- [ ] **Packaging for Different Operating Systems:**
  - [ ] Create installers/packages for Windows, macOS, and Linux.
- [ ] **Update Mechanism (Optional):**
  - [ ] Implement an auto-update system for the browser.
- [ ] **Documentation:**
  - [ ] Create user documentation and developer guides.
