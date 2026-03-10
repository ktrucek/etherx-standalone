# EtherX Browser — Evidencija razvoja i upute

> Verzija: **v2.4.32** | Datum zadnjeg ažuriranja: 09. 03. 2026.

---

## ✅ Što je do sada urađeno

### 1. Osnovna struktura i UI (Faze 1–7)

- **Settings panel** — potpuno restrukturiran (tabovi: General, Appearance, Advanced, AI, Websites, About)
- **index.html** — rearrangement navigacije, nova sidebar arhitektura
- **SW Status + WebGL2** — ispravno prikazivanje statusa Service Workera i WebGL2 podrške
- **Developer tab bookmarks** — popravak prikaza bookmarkova u Developer panelu
- **Bookmark Manager modal** — potpun modal za upravljanje bookmarkovima (dodaj, uredi, obriši, folderi)
- **BOBIAI Wallet persistencija** — podaci walletа ostaju nakon zatvaranja browsera

---

### 2. DevTools popravci (Faza 8)

| Problem                                             | Rješenje                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Network tab prazan pri otvaranju taba               | Dodan `_netBuffer[]` sustav — buffering do 300 unosa dok je DevTools zatvoren, flush pri otvaranju |
| Sources prikazuje interne fajlove                   | Dodan `SRC_SKIP` filter (proxy.php, browser.html, n8n, localhost, file://)                         |
| SQLite Settings prikazuje API ključeve u plaintextu | Maskiranje: `HIDDEN_KEYS` → `••••••••••`, `MODEL_KEYS` → samo prefix providera                     |
| CSP prikazivalo "Missing"                           | Promijenjeno u `N/A — nije dostupno (proxy mode)`                                                  |
| Cookies panel prazan                                | Popravak: detektira `Array.isArray(res)` prije nego čita `res.cookies`                             |

---

### 3. "Premjesti tab u novi prozor" bug (Faza 9)

- **Bug:** novi prozor učitavao sve tabove iz shared localStorage session restore
- **Fix (main.js):** `loadFile` s `hash: 'move-tab=<url>'`
- **Fix (index.html):** `restoreSession()` detektira hash i otvara samo taj jedan URL, briše hash

---

### 4. AI Settings — kompletni overhaul (Faza 10)

- **Root bug:** `gemini_api_key` (snake_case) vs `geminiApiKey` (camelCase) mismatch → sada se sprema i čita oboje
- Dodan **provider selector** (Gemini / OpenAI / Anthropic)
- Dodan **"⬇ Modeli" gumb** — dohvaća live modele s API-ja i puni dropdown
- Dodan **status banner** — zeleni/crveni indikator konfiguriranosti
- Dodan **4-testni suite**: API konekcija, summarizacija, phishing detekcija, kvota/broj modela
- Dodan **test history** u localStorage (`ex_ai_test_history`) — zadnjih 30 zapisa
- Popravak `summarizeCurrentPage` — čita i camelCase i snake_case ključeve
- **Fix main.js IPC (`ai:summarizePage`):** čita `geminiApiKey || gemini_api_key` — prethodno čitao samo snake_case pa je javljalo "nije konfiguriran" iako je ključ bio upisan

---

### 5. Deploy pipeline (Faza 11)

- **deploy.sh** — dodan korak automatskog bumpa `CACHE_VERSION` u `sw.js`
- **build.yml** — verificirano: Linux (AppImage + .deb), Windows (Portable + .zip), macOS x64, macOS arm64, Release job
- Svaki `bash deploy.sh` sada bumpa: `package.json` → `src/index.html` → `package-lock.json` → `sw.js` → git commit + tag + push → GitHub Actions

---

### 6. Dark Mode popravci (v2.4.31)

| Problem                                              | Rješenje                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Toggle pokazuje "isključeno" pri povratku u Settings | Dodan `_refreshSettingsToggles()` — poziva se svaki put kad se Settings panel otvori                                                 |
| Dupli event listener na `togglePageDarkMode`         | `initSettingsPanel` preskače `togglePageDarkMode` (return za taj id), posebni listener zove `applyPageDarkMode`                      |
| Fluoroscentne boje, Google nije zamračen             | **Defaultna metoda promijenjena** s `CSS filter invert` na `🌙 Nativni (color-scheme: dark)` — radi na Googleu bez iskrivljenih boja |
| CSS invert dostupan za stare stranice                | Ostaje kao opcija "🔄 CSS Invert" u dropdown selectu                                                                                 |

---

### 7. BOBIAI Wallet — povratak na iframe (v2.4.32)

- **Problem:** Copilot je prethodno napravio custom embedded wallet s ethers.js (~500 linija JS)
- **Rješenje:** Wallet panel je vraćen na jednostavan **iframe** koji učitava `https://wallet.kriptoentuzijasti.io`
- Isti dizajn kao BobiAI Studio panel (loading spinner, ↗ popout gumb, ↺ reload gumb)
- Uklonjen cijeli custom wallet JS kod (AES-GCM encrypt, ethers.js, RPC pozivi)

---

### 8. Download panel — kompletni overhaul (v2.4.32)

- **Progress bar** u realnom vremenu (bez full re-rendera — ažurira samo `width` progress bara)
- Prikaz: `primljeno / ukupno — postotak%` (npr. `1.2 MB / 45.0 MB — 3%`)
- **Status ikone:** ⏬ aktivno · ✅ završeno · ❌ greška · ⏸️ pauzirano
- **Gumb "▶ Otvori"** — otvara fajl u asociranoj aplikaciji (`shell.openPath`)
- **Gumb "📂 Folder"** — otvara Explorer/Finder i selektira fajl (`shell.showItemInFolder`)
- **"📂 Otvori folder"** gumb u headeru panela
- **Badge** na `⬇️` toolbar ikoni — prikazuje broj aktivnih downloada
- **Auto-otvori panel** pri pokretanju downloada + toast notifikacije
- `shell:showItemInFolder` i `shell:openPath` dodani u `main.js` IPC i `preload.js`

---

## 🔜 Što još ostaje — prioriteti

### 🔴 ZADNJA VELIKA STVAR: Prijevodi (i18n)

Cijelo sučelje je mješavina hrvatskog i engleskog teksta. Potrebno je:

1. **Inventarizirati sve stringove** u `src/index.html` (~16 000 linija)
2. **Kreirati prijevodne fajlove** (`src/main/i18n.js` već postoji — treba ga nadopuniti)
3. **Jezici koje treba pokriti:**
   - `hr` — Hrvatski (default)
   - `en` — English
   - (opcionalno: `de`, `fr`, `es`)
4. **UI elementi za prevesti:**
   - Settings paneli (sve labele, opisi, gumbi)
   - Toast poruke
   - Kontekstualni izbornici (right-click menu)
   - DevTools paneli
   - Download/Bookmark/History paneli
   - Error poruke
5. **Implementacija:** `window.etherx.i18n.getStrings(lang)` IPC već postoji u preloadu — treba konektirati s HTML-om

---

### 🟡 Redovita ažuriranja aplikacije

Za svako buduće ažuriranje:

```bash
cd "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/standalone-browser"
bash deploy.sh
# → unesi 'y' za uncommitted changes
# → unesi 'y' za potvrdu nove verzije
```

Script automatski:

- Bumpa verziju u `package.json`, `src/index.html`, `package-lock.json`, `sw.js`
- Kreira git commit s porukom `vX.Y.Z: Version bump`
- Kreira git tag `vX.Y.Z`
- Pusha na `origin/main` → okida GitHub Actions build za sve platforme

**Build outputi** (GitHub Releases):

- `EtherX-linux-x86_64.AppImage`
- `EtherX-linux-amd64.deb`
- `EtherX-win-portable.exe`
- `EtherX-win.zip`
- `EtherX-macos-x64.dmg`
- `EtherX-macos-arm64.dmg`

---

### 🟢 Mobilna verzija — "Add to Home Screen" (PWA)

Aplikacija je dostupna kao web stranica na:
**`https://ktrucek.github.io/etherx-standalone/src/index.html`**

#### Kako dodati EtherX na Home Screen mobitela:

**Android (Chrome):**

1. Otvori Chrome i idi na `https://ktrucek.github.io/etherx-standalone/src/index.html`
2. Tapni **⋮ (tri točkice)** → "Dodaj na početni zaslon" / "Add to Home screen"
3. Potvrdi naziv → tapni "Dodaj"
4. Ikona se pojavljuje na Home Screenu kao aplikacija

**iOS (Safari):**

1. Otvori Safari i idi na `https://ktrucek.github.io/etherx-standalone/src/index.html`
2. Tapni **gumb dijeljenja** (□↑) na dnu
3. Skrolaj i tapni "Dodaj na početni zaslon" / "Add to Home Screen"
4. Potvrdi naziv → tapni "Dodaj"
5. Ikona se pojavljuje na Home Screenu kao full-screen PWA

#### Što je potrebno za bolji PWA doživljaj:

Trenutno aplikacija ima `sw.js` (Service Worker) ali nedostaje `manifest.json`. Za punopravni PWA:

**Kreirati `manifest.json` u root folderu:**

```json
{
  "name": "EtherX Browser",
  "short_name": "EtherX",
  "description": "Web3-Native Browser",
  "start_url": "/standalone-browser/src/index.html",
  "display": "standalone",
  "background_color": "#0d0d1a",
  "theme_color": "#667eea",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/standalone-browser/assets/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/standalone-browser/assets/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

**Dodati u `<head>` od `src/index.html`:**

```html
<link rel="manifest" href="/standalone-browser/manifest.json" />
<meta name="theme-color" content="#667eea" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta
  name="apple-mobile-web-app-status-bar-style"
  content="black-translucent"
/>
<meta name="apple-mobile-web-app-title" content="EtherX" />
<link rel="apple-touch-icon" href="/standalone-browser/assets/icon-192.png" />
```

**Trebaju se kreirati ikone:**

- `assets/icon-192.png` (192×192 px)
- `assets/icon-512.png` (512×512 px)

#### Brzi link za slanje na mobitel:

Pošalji ovaj link SMS-om ili WhatsAppom:

```
https://ktrucek.github.io/etherx-standalone/src/index.html
```

Ili kreiraj QR kod na: **https://qr.io** ili **https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://ktrucek.github.io/etherx-standalone/src/index.html**

---

## 📁 Struktura projekta

```
standalone-browser/
├── src/
│   ├── index.html          ← Glavni UI (~16 000 linija)
│   ├── main/
│   │   ├── main.js         ← Electron main process
│   │   ├── ai.js           ← AI manager (Gemini, phishing, sažetak)
│   │   ├── database.js     ← SQLite manager (better-sqlite3)
│   │   ├── i18n.js         ← i18n manager (treba nadopuniti)
│   │   ├── security.js     ← Security/cert manager
│   │   ├── adBlocker.js    ← Ad blocker
│   │   ├── passwordManager.js
│   │   ├── userAgent.js
│   │   └── defaultBrowser.js
│   ├── preload/
│   │   └── preload.js      ← Electron contextBridge API
│   └── renderer/
│       ├── browser.html
│       ├── newtab.html
│       └── settings.html
├── assets/
│   └── filters/
│       └── filters.txt     ← Ad block filter lista
├── sw.js                   ← Service Worker (PWA cache)
├── deploy.sh               ← Deploy script
├── package.json
├── main.js                 ← Entry point
├── preload.js
└── .github/
    └── workflows/
        └── build.yml       ← GitHub Actions (4 platforme)
```

---

## 🔧 Tehničke napomene

### localStorage ključevi

| Ključ                | Sadržaj                      |
| -------------------- | ---------------------------- |
| `ex_tabs`            | Session restore (tabovi)     |
| `ex_bm`              | Bookmarkovi                  |
| `ex_hist`            | Povijest                     |
| `ex_dl`              | Downloadi                    |
| `ex_recent`          | Nedavno posjećeni sajtovi    |
| `ex_settings`        | Sve postavke                 |
| `ex_ai_test_history` | AI test history (zadnjih 30) |
| `ex_perms`           | Per-site dozvole             |

### API ključevi — dual storage

Svi API ključevi se spremaju u **oba formata** radi kompatibilnosti:

- `geminiApiKey` + `gemini_api_key`
- `openaiApiKey` + `openai_api_key`
- `anthropicApiKey` + `anthropic_api_key`

### Electron IPC kanali (važni)

| Kanal                    | Opis                                                    |
| ------------------------ | ------------------------------------------------------- |
| `ai:summarizePage`       | Summarizacija — čita `geminiApiKey \|\| gemini_api_key` |
| `download-update`        | Push event za live progress                             |
| `shell:showItemInFolder` | Otvori folder u file manageru                           |
| `shell:openPath`         | Otvori fajl u asociranoj aplikaciji                     |
| `db:upsertDownload`      | Spremi/ažuriraj download u SQLite                       |
