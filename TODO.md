# EtherX Browser Development - Detailed To-Do List

This document outlines the major steps and functionalities required to develop "EtherX Browser" based on Chromium/Electron.

---

## 📊 PROGRESS SUMMARY (Updated: Mar 7, 2026)

### 🚀 GitHub Repositories

#### Desktop App (Electron)

- **Repository:** https://github.com/ktrucek/etherx-browser-2
- **macOS Intel:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-2.4.0-x64.dmg
- **macOS ARM:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-2.4.0-arm64.dmg
- **Windows:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-Setup-2.4.0.exe
- **Linux:** https://github.com/ktrucek/etherx-browser-2/releases/latest/download/EtherX-Browser-2.4.0.AppImage

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

## ✅ ISPRAVKE BUGOVA — BUG REPORT (7. Ožujak 2026)

### 🟢 SVE RIJEŠENO — 36/36 (100%)

#### Window Management & Taskbar

- [x] **#1** — YouTube popup handling: whitelist za YouTube/Google domene, popupi se otvaraju kao novi tabovi
- [x] **#2** — Taskbar context menu: "New Window" i "New Incognito Window" za macOS dock i Windows taskbar
- [x] **#13** — Move tab to new window: IPC handler `move-tab-to-window` kreira novi BrowserWindow
- [x] **#19** — Popup-to-tab conversion: non-whitelisted popupi šalju URL u renderer kao novi tab

#### Navigation & Address Bar

- [x] **#26** — Address bar search fallback: neispravni URL-ovi (bez točke) idu na konfiguriranu tražilicu
- [x] **#3** — Navigation arrows: povećane na 20px font-size, min 32x32px click area
- [x] **#7** — Home button action: čita `homepage` iz postavki, fallback na NTP

#### Console Errors (FIXED!)

- [x] **#35a** — Cross-origin frame access: friendly error message u Elements tabu
- [x] **#35b** — prompt() replaced: svi prompt() pozivi zamijenjeni sa customPrompt() async dijalogom
- [x] **#35c** — showPageError defined: funkcija definirana za did-fail-load handler
- [x] **#35d** — URL loading error: poboljšan error handling u navigateTo()

#### UI/UX Komponente

- [x] **#4** — File menu: "New Window" (Ctrl+N) i "New Private Window" (Ctrl+Shift+N)
- [x] **#6** — Window control dots: ×/□/− simboli na hover (CSS ::after pseudo-elementi)
- [x] **#23** — Share button: Web Share API + clipboard fallback + QR code opcija

#### Zoom & Scrolling

- [x] **#5** — Zoom controls: Ctrl++/-, Shift+Scroll, Ctrl+0 reset, sve radi u Electron i web modu

#### Homepage & Navigation

- [x] **#8** — Session restore: auto-save tabs u SQLite prije zatvaranja, restore on startup

#### Screenshots

- [x] **#9** — Screenshot: webContents.capturePage() via IPC, rectangle selection overlay

#### History

- [x] **#10** — Top 10 most visited: getTopVisited() metoda, prikaz na NTP i u History panelu

#### Bookmarks

- [x] **#11** — Bookmark Manager: pretraga, edit, folder grupiranje, drag reorder
- [x] **#12** — Bookmark folders: kreiranje i upravljanje folderima

#### Downloads

- [x] **#15** — Downloads tracking: will-download hook + SQLite downloads tablica + real-time progress
- [x] **#16** — Downloads Manager: Clear All, Show in Folder, delete, retry opcije

#### Window Features

- [x] **#14** — Split screen: snap to half (left/right) via IPC handler

#### Popups & Multi-Account

- [x] **#17** — Google popup handling: whitelist za accounts.google.com, mail.google.com
- [x] **#18** — Multi-account: popupi za Google autentikaciju dopušteni

#### Profile Management

- [x] **#22** — Profile picture upload: file picker, canvas crop 128x128, localStorage persistence

#### Appearance Settings

- [x] **#21** — Clock customization: font-size selector, 12h/24h format opcija
- [x] **#27** — Font & color: UI font family dropdown, accent color picker
- [x] **#28** — Toolbar context menu: "Customize toolbar..." opcija

#### Start Page

- [x] **#20** — NTP customization: background URL/color, title, subtitle, show/hide sekcije

#### Database & Backend (SQLite)

- [x] **#30a** — open_tabs/tabs tablica: save/restore tabs on close/open
- [x] **#30b** — ai_cache: AI agent responses cached u SQLite
- [x] **#30c** — user_profile: full_name, email, avatar_data, bio polja
- [x] **#30d** — Notes: CRUD operacije, notes panel u DevTools Application tab
- [x] **#30e** — downloads: tablica s url, filename, filepath, filesize, state
- [x] **#30f** — tab_sessions: session persistence za restore
- [x] **#30g** — passwords: PasswordManager koristi zasebnu bazu s enkripcijom

#### Lighthouse & Performance

- [x] **#31** — Lighthouse audits: rezultati spremljeni u SQLite lighthouse_audits tablica
- [x] **#32** — Cookie list: prikaz svih cookies u DevTools Application tab
- [x] **#33** — Performance metrics: CLS, LCP, TBT via PerformanceObserver + memory/DOM count

#### DevTools

- [x] **#29** — DevTools toggle: F12 shortcut, IPC handler, dock modes (bottom/left/right)
- [x] **#34** — Elements cross-origin: user-friendly poruka umjesto errora

#### Extensions & Integrations

- [x] **#24** — BobiAI wallet persistence: iframe localStorage sync svakih 30s
- [x] **#25** — AI Agent UI: sticky input bar, auto-scroll, model selector

#### AI Page Summary

- [x] **#36** — AI Page Summary: multi-provider (OpenAI, Anthropic, Gemini, Ollama)
  - Ctrl+Shift+A shortcut
  - Context menu opcija "✨ AI Summary"
  - IPC-based API calls (ključ na backendu, ne frontendu)
  - SQLite caching (ai_cache + page_summaries tablice)
  - Model selector u UI-u

---

## 🆕 DODATNE ZNAČAJKE (v2.4.0)

### Media Playback Continuity
- [x] YouTube/Twitch/Spotify ne prestaju svirati kod prebacivanja tabova
- [x] Webview audio muting via webview.setAudioMuted() API
- [x] Frame owner tracking — ne reload-a stranicu kad se vraćaš na isti tab

### API Security
- [x] Gemini API key uklonjen iz frontend koda
- [x] AI requests proxirani kroz main process IPC (`ai:summarizePage`)
- [x] API ključevi čitaju se iz SQLite settings, ne hardkodirani

### Help & Version Info
- [x] Help → About prikazuje pravu verziju (2.4.0) s datumom i buildom
- [x] Dinamički prikaz verzije iz package.json

### Internationalization (i18n)
- [x] Kompletni prijevodi za 13 jezika: hr, en, de, fr, es, it, pt, ru, tr, pl, bs, sr, sl
- [x] Prošireni de (njemački) — svi ključevi pokriveni
- [x] Prošireni it (talijanski) — svi ključevi pokriveni
- [x] Prošireni fr (francuski) — svi ključevi pokriveni

### Database Schema v3
- [x] Nove tablice: downloads, tab_sessions, user_profile, notes, lighthouse_audits, page_summaries
- [x] Metode: addDownload, updateDownload, getDownloads, saveTabSession, getLatestTabSession
- [x] Metode: getUserProfile, saveUserProfile, addNote, getNotes, updateNote, deleteNote
- [x] Metode: saveLighthouseAudit, getLighthouseAudits, savePageSummary, getPageSummary

---

## 📊 BUG REPORT STATISTIKA

| Kategorija | Broj | Status |
|------------|------|--------|
| Kritični (BLOCKER) | 8 | ✅ Svi riješeni |
| Visoki prioritet | 6 | ✅ Svi riješeni |
| Srednji prioritet | 13 | ✅ Svi riješeni |
| Database/Backend | 8 | ✅ Svi riješeni |
| AI Features | 2 | ✅ Svi riješeni |
| Niski prioritet | 1 | ✅ Svi riješeni |
| **UKUPNO** | **36 + 4 nova = 40** | **✅ 40/40 (100%)** |

---

## 📁 STRUKTURA PROJEKTA

```
etherx-browser-2/
├── main.js                    # Electron main process (553 lines)
├── preload.js                 # Context bridge (151 lines)
├── package.json               # v2.4.0, Electron 33.4.11
├── browser.html               # Web PWA verzija (3351 lines)
├── TODO.md                    # Ovaj dokument
├── .github/workflows/
│   └── build.yml              # CI/CD za Linux/Windows/macOS
├── src/
│   ├── index.html             # Glavni UI za Electron (13198 lines)
│   ├── main/
│   │   ├── main.js            # Inner main (183 lines)
│   │   ├── database.js        # SQLite manager (563 lines)
│   │   ├── ai.js              # AI manager
│   │   ├── i18n.js            # Prijevodi (651 lines, 13 jezika)
│   │   ├── adBlocker.js       # Ad blocking
│   │   ├── security.js        # TLS enforcement
│   │   ├── passwordManager.js # Encrypted passwords
│   │   ├── qrSync.js          # QR code sync
│   │   ├── defaultBrowser.js  # Default browser detection
│   │   └── userAgent.js       # UA management
│   ├── preload/
│   │   └── preload.js         # Src preload
│   └── renderer/
│       ├── browser.html       # Kopija browser.html
│       ├── newtab.html
│       └── settings.html
├── assets/
│   └── filters/
│       └── filters.txt        # Ad block filter list
└── build/                     # Electron-builder output
```

---

## 🚀 BUILD & DEPLOY

### GitHub Actions (automatski)
```bash
git tag -a v2.4.0 -m "v2.4.0: All 36 bug fixes + media continuity + API security + i18n"
git push origin v2.4.0
```
Workflow builda: Linux AppImage + .deb, Windows .exe + .zip, macOS x64 + arm64 DMG

### Web Deploy
```bash
cp browser.html /var/www/vhosts/kriptoentuzijasti.io/n8n.kriptoentuzijasti.io/browser.html
```

---

## ✅ DOVRŠENE FAZE

### ✅ Phase 7 — v2.4.0 (Mar 7, 2026)
- Svih 36 bugova iz bug reporta ispravljeno
- Media playback continuity (YouTube/Twitch ne prekidaju)
- API security (ključevi na backendu, ne frontendu)
- Help verzija 2.4.0 s dinamičkim datumom
- Kompletni de/it/fr prijevodi
- Database schema v3 s 6 novih tablica
- AI Page Summary s multi-provider podrškom

### ✅ Phase 6 — v2.2.7 (Mar 6, 2026)
- React Native mobilna app (iOS + Android)
- Electron desktop app (macOS/Windows/Linux)
- Hrvatski prijevod Settings/DevTools
- Reorganizacija GitHub repozitorija

### ✅ Phase 5 (Mar 5, 2026)
- Datum pored sata u title baru
- Settings → Appearance → Title Bar Items
- Fix kriptoentuzijasti.io iframe CSP
- Media integracija (camera, mic, autoplay)
- Biometrijska autentikacija (WebAuthn)
- Downloadable browser (PWA + Electron)

### ✅ Phase 4.1
- AI Agent upgrade (WordPress REST API)
- BobiAI Studio panel
- Profili, PWA, appearance settings

### ✅ Phases 1–4
- Core browser UI, DevTools, NTP, extensions
- Edit menu, mobile CSS, panels, bookmarks, history
- Passwords, profiles, biometric auth
- Crypto wallet panel, Web3 integration

---

© 2024–2026 kriptoentuzijasti.io. All Rights Reserved.
