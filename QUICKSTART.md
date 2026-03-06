# EtherX Browser - Quick Start Guide

## 🎯 Šta je EtherX Browser?

EtherX je Chromium-based web browser sa ugrađenim Web3 funkcionalnostima, decentralizovanom verifikacijom sadržaja i integrisanim crypto wallet-om.

## 🚀 Instant Start (3 komande)

```bash
# 1. Učinite skriptu izvršnom
chmod +x etherx_build.sh

# 2. Pokrenite build sistem
./etherx_build.sh

# 3. Sledite meni (izaberite opciju 1 za Phase 1)
```

## 📦 Šta Ćete Dobiti?

Nakon završetka svih faza:
- ✅ Potpuno funkcionalan Chromium-based browser
- ✅ Integrisan crypto wallet
- ✅ Web3 dApp podrška
- ✅ Decentralizovana verifikacija sadržaja
- ✅ Ad/tracker blocking
- ✅ Custom protokol (etherx://)

## ⏱️ Timeline

### Faza 1 - Research & Setup (1 dan)
```bash
./etherx_build.sh → Option 1

Trajanje:
- Research: 1-2h
- Setup: 30min
- Download: 1-3h (30GB)
- Build: 2-6h

Rezultat: Radni Chromium development environment
```

### Faza 2 - MVP Browser (1-2 nedelje)
```bash
./etherx_build.sh → Option 2

Features:
- Osnovni browser window
- Address bar & navigation
- Tab management
- Web rendering

Rezultat: Funkcionalan basic browser
```

### Faza 3 - Advanced Features (2-4 nedelje)
```bash
./etherx_build.sh → Option 3

Features:
- Bookmarks & History
- Downloads manager
- Settings
- Web3 wallet integration
- Security features

Rezultat: Feature-complete browser
```

### Faza 4-6 - Polish & Deploy (2-3 nedelje)
```bash
./etherx_build.sh → Options 4, 5, 6

- UI/UX polish
- Testing & optimization
- Cross-platform packaging

Rezultat: Production-ready browser
```

## 💻 Sistemski Zahtevi

### ❌ Minimum (Ne Preporučuje Se)
- CPU: 4 cores
- RAM: 8GB
- Disk: 100GB
- Build time: 6-8h

### ✅ Preporučeno
- CPU: 8+ cores
- RAM: 16-32GB
- Disk: 200GB SSD
- Build time: 2-4h

### 🚀 Idealno
- CPU: 16+ cores (Ryzen 9, i9)
- RAM: 32-64GB
- Disk: 500GB NVMe SSD
- Build time: 1-2h

## 📁 Šta Se Kreira?

```
~/chromium/                    # Chromium source & build (~100GB)
├── src/                      # Source kod
└── out/Default/              # Build output

/var/www/.../browser/         # Vaš projekat
├── etherx_build.sh          # Master skripta
├── scripts/                  # Build skripte
├── src/                      # EtherX kod
├── research/                 # Study materijali
├── logs/                     # Build logovi
└── docs/                     # Dokumentacija
```

## 🔥 Šta Svaka Skripta Radi?

### Phase 1.1 - Research (1-2h)
```bash
./scripts/phase1/01_chromium_architecture_research.sh
```
✅ Download Chromium dokumentacije  
✅ Kreira study guide (10-week plan)  
✅ Kreira cheat sheet za brzu referencu  
✅ Clone-uje example projekte (Electron, CEF)  
✅ Kreira research checklist  

**Output:** `research/chromium-architecture/` sa svim materijalima

### Phase 1.2 - Environment Setup (30min)
```bash
./scripts/phase1/02_environment_setup.sh
```
✅ Provera sistemskih zahteva  
✅ Instalacija build tools (Git, Python, GCC, Ninja)  
✅ Instalacija depot_tools  
✅ Git konfiguracija  
✅ VS Code setup  
✅ Kreiranje project strukture  

**Output:** Kompletan dev environment

### Phase 1.3 - Download Chromium (1-3h, 30GB)
```bash
./scripts/phase1/03_chromium_download.sh
```
✅ Fetch Chromium source kod (~30GB)  
✅ Checkout stable verzije  
✅ Sync dependencies  
✅ Instalacija build dependencies  

**Output:** `~/chromium/src` sa celim source kodom

### Phase 1.4 - Build Chromium (2-6h)
```bash
./scripts/phase1/04_chromium_build.sh
```
✅ Konfigurisanje build-a (GN)  
✅ Kompajliranje content_shell  
✅ Testiranje build-a  
✅ Kreiranje run skripta  

**Output:** `~/chromium/src/out/Default/content_shell` - funkcionalan browser!

## 🎮 Interaktivna Master Skripta

```bash
./etherx_build.sh
```

**Meni Opcije:**

```
1) Run Phase 1: Research & Setup
2) Run Phase 2: Build MVP
3) Run Phase 3: Advanced Features
4) Run Phase 4: UI/UX
5) Run Phase 5: Testing
6) Run Phase 6: Deployment

10) Run ALL Phases (Automated)
11) Run Specific Script

20) View Project Status      ← Proveri napredak
21) View Logs               ← Pogledaj logove
22) Clean Build             ← Oslobodi disk space

0) Exit
```

## 📊 Praćenje Napretka

### View Status
```bash
./etherx_build.sh → Option 20
```

Shows:
- ✅/❌ Status svake faze
- System info
- Installed tools
- Directory sizes

### View Logs
```bash
./etherx_build.sh → Option 21
```

Svi build logovi sa timestamps-ima.

## 🛠️ Troubleshooting

### Problem: "depot_tools not found"
```bash
export PATH="$PATH:$HOME/depot_tools"
# Ili restartuj terminal
```

### Problem: "Out of memory" tokom build-a
```bash
# Zatvori druge aplikacije
# Smanji broj jobs:
ninja -C out/Default content_shell -j 4
```

### Problem: "Out of disk space"
```bash
# Očisti build:
./etherx_build.sh → Option 22 → Option 1
# Ili ručno:
rm -rf ~/chromium/src/out/
```

### Problem: "Permission denied"
```bash
chmod +x etherx_build.sh
chmod +x scripts/phase1/*.sh
```

## 📚 Study Materijali

Nakon `Phase 1.1`, dobijate:

### 1. Architecture Study Guide (10-week plan)
```bash
cat research/chromium-architecture/ARCHITECTURE_STUDY_GUIDE.md
```
Kompletni plan za učenje Chromium arhitekture.

### 2. Quick Reference Cheat Sheet
```bash
cat research/chromium-architecture/CHROMIUM_CHEATSHEET.md
```
Brzi vodič za development.

### 3. Research Checklist
```bash
cat research/chromium-architecture/RESEARCH_CHECKLIST.md
```
Čekiraj šta si naučio.

## 🎯 Praktični Primeri

### Nakon Phase 1 - Pokreni Content Shell
```bash
./run_content_shell.sh
# Ili:
cd ~/chromium/src
out/Default/content_shell --no-sandbox https://google.com
```

### Debug Mode
```bash
cd ~/chromium/src
gdb out/Default/content_shell
(gdb) run --no-sandbox
```

### Enable DevTools
```bash
content_shell --remote-debugging-port=9222
# Onda otvori: chrome://inspect u drugom browseru
```

## 📈 Napredak po Danima

**Dan 1:** Phase 1 (Setup & Build)
- ✅ Development environment
- ✅ Chromium source downloaded
- ✅ Chromium built
- ✅ Content shell radi

**Nedelja 1-2:** Phase 2 (MVP)
- ✅ Basic browser window
- ✅ Navigation bar
- ✅ Tab management
- ✅ Funkcionalno web browsing

**Nedelja 3-4:** Phase 3 (Features)
- ✅ Bookmarks
- ✅ History
- ✅ Settings
- ✅ Web3 wallet

**Nedelja 5-6:** Phase 4-6 (Polish & Ship)
- ✅ UI/UX refinement
- ✅ Testing
- ✅ Packaging
- ✅ **LAUNCH!** 🚀

## 🎁 Bonus Skripte

### Quick Status Check
```bash
# Brza provera:
ls -lh ~/chromium/src/out/Default/content_shell && echo "✅ Build OK"
```

### Rebuild Script
```bash
# Brzi rebuild:
cd ~/chromium/src
autoninja -C out/Default content_shell
```

### Clean & Rebuild
```bash
# Full rebuild:
rm -rf ~/chromium/src/out
gn gen out/Default
autoninja -C out/Default content_shell
```

## 🔗 Korisni Linkovi

- **Chromium Docs:** https://chromium.googlesource.com/chromium/src/+/main/docs/
- **CEF:** https://bitbucket.org/chromiumembedded/cef
- **Electron:** https://www.electronjs.org/
- **V8 Docs:** https://v8.dev/docs

## ⚡ Pro Tips

1. **Use SSD**: Build je 3-4x brži na SSD-u
2. **More RAM**: 32GB+ = ne mora da swap-uje
3. **More Cores**: Svaki core ubrzava build
4. **Component Build**: `is_component_build=true` za brže incremental builds
5. **Use ccache**: Cache kompilaciju za još brže rebuild-ove

## 🎊 Završna Poruka

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║           Spremni ste za razvoj EtherX Browsera!              ║
║                                                               ║
║   1. chmod +x etherx_build.sh                                 ║
║   2. ./etherx_build.sh                                        ║
║   3. Izaberite Option 1                                       ║
║                                                               ║
║            ~ 1 DAN KASNIJE IMAĆETE CHROMIUM ~                ║
║           ~ 2 MESECA KASNIJE IMAĆETE ETHERX ~                ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

**Krenite odmah:**
```bash
./etherx_build.sh
```

Good luck! 🚀🎉
