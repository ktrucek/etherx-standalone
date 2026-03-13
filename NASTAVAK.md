# EtherX — Stanje projekta i koraci za nastavak

> Zadnje ažuriranje: 10. ožujka 2026. — Pripremljeno prije restarta računala.

---

## 📋 Što je napravljeno u ovoj sesiji (još NIJE deployano)

### 1. Maknut proxy.php i n8n.kriptoentuzijasti.io

- `src/index.html` — sve reference na `proxy.php` zamijenjene direktnim URL-om
- `src/renderer/browser.html` — isto
- `src/renderer/js/browser.js` — isto
- Download link `n8n.kriptoentuzijasti.io/download.html` → `ktrucek.github.io/etherx-standalone/src/index.html`
- Commitano: `"refactor: remove proxy.php and n8n.kriptoentuzijasti.io references"`

### 2. Maknut Mirror-to-Gitea iz GitHub Actions

- `.github/workflows/build.yml` — obrisan `mirror-to-gitea` job
- **NIJE commitano još**

### 3. Maknut Gitea push iz deploy.sh

- `deploy.sh` — uklonjen `GITEA_REMOTE_URL`, `git push origin`, Gitea iz summarya
- **NIJE commitano još**

### 4. Dodana EtherX.io integracija u deploy.sh

- `deploy.sh` — dodan automatski poziv `https://etherx.io/update_version_api.php` nakon GitHub push-a
- `test_etherx_api.sh` — nova skripta za testiranje API poziva
- **NIJE commitano još**

### 5. Riješeni browser problemi

- Split screen, New Window, Tab detach, Private mode, DNS-over-HTTPS persistence
- Third-party cookies support, dock menu ispravci
- **NIJE commitano još**

---

## ⚠️ Što treba napraviti nakon restarta

### Korak 1 — Provjeri git status

```bash
cd "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/standalone-browser"
git status
git diff --stat
```

### Korak 2 — Commitaj preostale promjene

```bash
source .env.local
git add .github/workflows/build.yml deploy.sh test_etherx_api.sh
git add src/index.html src/main/main.js
git commit -m "feat: integrate EtherX.io auto-update + fix browser issues

- deploy.sh: auto-update etherx.io/browser.html after GitHub push
- test_etherx_api.sh: API testing script
- Fix split screen to only split current tab
- Fix new window/dock menu to start empty (fresh-window flag)
- Fix private window colors (hue-rotate)
- Fix DNS-over-HTTPS persistence (data-setting attributes)
- Enable third-party cookies support
- Remove Gitea mirror job + Gitea push from deploy"
```

### Korak 3 — Deploy (pušta novi build)

```bash
bash deploy.sh
```

Ovo će:

1. Auto-increment verziju (2.4.35 → 2.4.36)
2. Commitati i tagirati
3. Pushati na GitHub (`github` remote s `GITHUB_TOKEN_DEPLOY`)
4. Triggerati GitHub Actions build (Linux + Windows + macOS)
5. **NOVO**: Automatski ažurirati EtherX.io download stranicu

### Korak 4 — Provjeri build

👉 https://github.com/ktrucek/etherx-standalone/actions

### Korak 5 — Provjeri GitHub Pages (mobitel/web)

👉 https://ktrucek.github.io/etherx-standalone/src/index.html

---

## 🗺️ Arhitektura (trenutno stanje)

```
deploy.sh
    │
    ├── git push → github (main + tag)
    │       │
    │       └── GitHub Actions (.github/workflows/build.yml)
    │               ├── build-linux   (ubuntu-latest)
    │               ├── build-windows (windows-latest)
    │               ├── build-macos-x64 (macos-latest)
    │               ├── build-macos-arm64 (macos-latest)
    │               └── release → GitHub Release (javni download linkovi)
    │
    └── (Gitea push UKLONJEN)
```

---

## 🔑 Tokeni (.env.local — NIKAD ne commitati)

```bash
export GITHUB_TOKEN="github_pat_11BQQP3PI0..."      # read-only, stari
export GITEA_TOKEN="bbeee3b2b0a867f2a37e..."         # Gitea token
export GITHUB_TOKEN_DEPLOY="ghp_qkDjJrRSA..."       # deploy token (ima workflow scope)
runner_gitea="WeOaY8O_jD_FohMm..."                   # act_runner token
```

**`GITHUB_TOKEN_DEPLOY`** = jedini token koji deploy.sh koristi.

---

## 📦 Trenutne verzije

| Stvar                      | Verzija/Hash                      |
| -------------------------- | --------------------------------- |
| Zadnja deployirana verzija | v2.4.35                           |
| GitHub release             | v2.4.35 (8 asseta)                |
| Git HEAD (lokalno)         | lokalne promjene još nije pushano |

---

## 🌐 Važni linkovi

| Stvar                         | URL                                                        |
| ----------------------------- | ---------------------------------------------------------- |
| GitHub repo                   | https://github.com/ktrucek/etherx-standalone               |
| GitHub Actions                | https://github.com/ktrucek/etherx-standalone/actions       |
| GitHub Releases               | https://github.com/ktrucek/etherx-standalone/releases      |
| GitHub Pages (web/mobitel)    | https://ktrucek.github.io/etherx-standalone/src/index.html |
| **EtherX.io download**        | https://etherx.io/browser.html                             |
| **EtherX.io stats**           | https://etherx.io/download_stats.php                       |
| Gitea repo (mirror, samo kod) | https://git.kasp.top/ktrucek/etherx-standalone             |

---

## 📱 Instalacija na mobitel (PWA)

1. Otvori Safari na iPhoneu
2. Idi na: `https://ktrucek.github.io/etherx-standalone/src/index.html`
3. Tapni **Share** (kvadrat sa strelicom) → **Add to Home Screen**
4. Pojavljuje se kao app s EtherX ikonom

---

## 🔄 Update provjera (kako radi)

- **Electron app**: IPC → `main.js` → GitHub API (bez tokena, javno)
- **Web/mobitel**: direktni `fetch` → GitHub API
- Endpoint: `https://api.github.com/repos/ktrucek/etherx-standalone/releases/latest`
- Repo je **javni** → radi bez autentikacije

---

## 🖥️ act_runner (Gitea runner — sada nekorišten za ovaj projekt)

Runner i dalje radi na serveru ali više nije potreban za `etherx-standalone`:

```bash
systemctl status gitea-runner   # provjera
```

Buildovi za `etherx-standalone` idu isključivo kroz **GitHub Actions**.

---

## 📝 Pending zadaci (nije hitno)

- [ ] Testirati PWA install na stvarnom iPhoneu/Androidu
- [ ] Provjeriti radi li `checkForUpdates` na mobilnom webu
- [ ] i18n strings još nisu wired u UI (dodani u i18n.js ali HTML još hardkodiran)
- [ ] GitHub Pages — provjeri da `sw.js` se ispravno cachira (scope `/etherx-standalone/`)

## 🐛 Browser problemi za riješiti

### ✅ Riješeni problemi:

- [x] **Split Screen**: Splitao je sve tabove → RIJEŠENO: sada splita samo trenutni tab
- [x] **New Window**: Otvarao Safari → RIJEŠENO: koristi hash flagove za prazne prozore
- [x] **Tab detach**: Otvara kao popup drugog browsera → RIJEŠENO: koristi `move-tab` hash flag
- [x] **New window dock**: Desni klik → New Window otvarao sa svim tabovima → RIJEŠENO: dock menu koristi `fresh-window` flag
- [x] **DNS over HTTPS**: DOH se resetirao → RIJEŠENO: dodani `data-setting` atributi za persistence
- [x] **Private window**: Trebale različite boje → RIJEŠENO: dodano `hue-rotate(240deg)` u dock menu
- [x] **Third-party cookies**: Aktiviran support u session setup
- [x] **EtherX.io integration**: deploy.sh automatski ažurira download stranicu

### 🔄 Ostali problemi za testiranje:

- [ ] **Tab switching reload**: Trebamo testirati da li se i dalje događa (možda je već riješeno)
- [ ] **Audio interruption**: Povezano s gornjim problemom - testirati glazbu
- [ ] **Auto-update**: Provjeriti radi li automatski update u Settings (vjerojatno radi)

---

## 🛑 NE zaboravi

1. `.env.local` — NIKAD ne commitati (u `.gitignore`)
2. `deploy.sh` — NIKAD ne commitati (u `.gitignore`)
3. `GITEA_TOKEN` u GitHub Secrets — ostaje jer može biti koristan
4. Gitea runner ostaje aktivan (koristi ga `etherx-browser-2` projekt)
