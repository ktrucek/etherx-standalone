# EtherX Browser - Build System

Dobrodošli u automatizovani build sistem za EtherX Browser!

## 🚀 Brzi Start

### 1. Prvo pokretanje

```bash
# Učinite master skriptu izvršnom
chmod +x etherx_build.sh

# Pokrenite master skriptu
./etherx_build.sh
```

### 2. Izaberite fazu

Master skripta će vam prikazati interaktivni meni gde možete:
- Pokrenuti pojedinačne faze
- Pregledati status projekta
- Pogledati logove
- Očistiti build

## 📁 Struktura Projekta

```
etherx-browser/
├── etherx_build.sh              # Master build skripta (POKRENITE OVO!)
├── TODO.md                      # Detaljna TODO lista
├── README_BUILD.md              # Ovaj fajl
│
├── scripts/                     # Build skripte po fazama
│   ├── phase1/                 # Faza 1: Research & Setup
│   │   ├── 01_chromium_architecture_research.sh
│   │   ├── 02_environment_setup.sh
│   │   ├── 03_chromium_download.sh
│   │   └── 04_chromium_build.sh
│   ├── phase2/                 # Faza 2: MVP Browser
│   ├── phase3/                 # Faza 3: Advanced Features
│   ├── phase4/                 # Faza 4: UI/UX
│   ├── phase5/                 # Faza 5: Testing
│   └── phase6/                 # Faza 6: Deployment
│
├── src/                        # Izvorni kod EtherX browsera
│   ├── browser/               # Browser process
│   ├── renderer/              # Renderer process
│   ├── common/                # Zajednički kod
│   ├── ui/                    # UI komponente
│   └── web3/                  # Web3 integracija
│
├── research/                   # Research materijali
│   └── chromium-architecture/ # Chromium dokumentacija
│
├── resources/                  # Resursi (ikone, UI)
├── logs/                      # Build logovi
└── docs/                      # Dokumentacija
```

## 📋 Faze Razvoja

### Faza 1: Research & Environment Setup
**Trajanje:** 1-2 dana  
**Disk:** ~100GB  
**Koraci:**
1. **1.1 - Research** (~1-2 sata): Download dokumentacije i kreiraj study guide
2. **1.2 - Setup** (~30 min): Instalacija development tools-a
3. **1.3 - Download** (~1-3 sata): Download Chromium source (~30GB)
4. **1.4 - Build** (~2-6 sati): Build Chromium content_shell

**Skripta:**
```bash
./etherx_build.sh
# Izaberite opciju 1
```

### Faza 2: Core Browser (MVP)
**Trajanje:** 1-2 nedelje  
**Koraci:**
1. Application Shell - Osnovni prozor aplikacije
2. Embed WebView - Integracija Chromium-a
3. Navigation Bar - Adresna traka i navigacija
4. Tab Management - Upravljanje tabovima
5. Web Rendering - Prikazivanje web stranica

**Skripta:**
```bash
./etherx_build.sh
# Izaberite opciju 2
```

### Faza 3: Advanced Features
**Trajanje:** 2-4 nedelje  
- Bookmarks & History
- Downloads Manager
- Settings/Preferences
- Web3 & Wallet Integration
- Security Features

### Faza 4: UI/UX Polish
**Trajanje:** 1-2 nedelje  
- Design sistema
- Theming
- Responsive design

### Faza 5: Testing & Optimization
**Trajanje:** 1-2 nedelje  
- Unit testovi
- Integration testovi
- Performance optimization

### Faza 6: Deployment
**Trajanje:** 1 nedelja  
- Packaging za OS-ove
- Update mehanizam
- Dokumentacija

## 🛠️ Pojedinačne Skripte

Možete pokrenuti i pojedinačne skripte direktno:

```bash
# Faza 1.1 - Research
./scripts/phase1/01_chromium_architecture_research.sh

# Faza 1.2 - Environment Setup
./scripts/phase1/02_environment_setup.sh

# Faza 1.3 - Download Chromium
./scripts/phase1/03_chromium_download.sh

# Faza 1.4 - Build Chromium
./scripts/phase1/04_chromium_build.sh
```

## 📊 Sistemski Zahtevi

### Minimum:
- **OS:** Linux (Ubuntu 20.04+) ili macOS
- **CPU:** 4 cores
- **RAM:** 8GB
- **Disk:** 100GB free space
- **Internet:** Brza konekcija za download

### Preporučeno:
- **CPU:** 8+ cores
- **RAM:** 16-32GB
- **Disk:** 200GB+ SSD
- **Internet:** 100+ Mbps

## 📝 Logovi

Sve skripte kreiraju detaljne logove:

```bash
# Logovi se čuvaju u:
logs/
├── phase1_01_research.log
├── phase1_02_environment_setup.log
├── phase1_03_chromium_download.log
└── phase1_04_chromium_build.log

# Pogledajte log:
less logs/phase1_04_chromium_build.log

# Ili kroz master skriptu:
./etherx_build.sh
# Opcija 21 - View Logs
```

## 🔧 Troubleshooting

### Problem: Skripta nije izvršna
```bash
chmod +x etherx_build.sh
chmod +x scripts/phase1/*.sh
```

### Problem: depot_tools not found
```bash
# Dodajte u PATH:
export PATH="$PATH:$HOME/depot_tools"
# Ili restartujte terminal
```

### Problem: Out of memory tokom build-a
```bash
# Zatvorite druge aplikacije
# Ili smanjite broj paralelnih jobs:
cd ~/chromium/src
ninja -C out/Default content_shell -j 4
```

### Problem: Out of disk space
```bash
# Očistite build output:
rm -rf ~/chromium/src/out/

# Ili koristite master skriptu:
./etherx_build.sh
# Opcija 22 - Clean Build
```

## 📚 Dodatni Resursi

### Generirani Dokumenti
Svaka skripta generiše summary dokumente:
- `ENVIRONMENT.md` - Info o dev environmentu
- `CHROMIUM_REPO_INFO.md` - Info o Chromium repou
- `CHROMIUM_BUILD_SUMMARY.md` - Build rezultati
- `research/chromium-architecture/ARCHITECTURE_STUDY_GUIDE.md` - Study guide

### Study Materijali
- `research/chromium-architecture/ARCHITECTURE_STUDY_GUIDE.md` - Kompletni study guide (10 nedelja)
- `research/chromium-architecture/CHROMIUM_CHEATSHEET.md` - Brzi referentni vodič
- `research/chromium-architecture/RESEARCH_CHECKLIST.md` - Checklist za praćenje napretka

### Official Chromium Docs
- https://chromium.googlesource.com/chromium/src/+/main/docs/
- https://www.chromium.org/developers/design-documents/

## 🎯 Korisne Komande

### Check Status
```bash
./etherx_build.sh
# Opcija 20 - View Project Status
```

### Run Content Shell
```bash
# Nakon što build-ujete Chromium:
./run_content_shell.sh
```

### Update Chromium
```bash
cd ~/chromium/src
git fetch --tags
git checkout tags/<new-version>
gclient sync
autoninja -C out/Default content_shell
```

### Build EtherX Browser (kada spremno)
```bash
cd ~/chromium/src
gn gen out/EtherX --args='import("//etherx/args.gn")'
autoninja -C out/EtherX etherx_browser
```

## ⏱️ Vremenske Procene

| Faza | Minimum | Prosek | Maksimum |
|------|---------|--------|----------|
| 1.1 Research | 1h | 2h | 1 nedelja (detaljno) |
| 1.2 Setup | 15min | 30min | 1h |
| 1.3 Download | 1h | 2h | 4h |
| 1.4 Build | 2h | 4h | 8h |
| **Total Phase 1** | **4h** | **8h** | **2 dana** |
| Phase 2 MVP | 3 dana | 1 nedelja | 2 nedelje |
| Phase 3 Advanced | 1 nedelja | 2 nedelje | 1 mesec |
| Phase 4 UI/UX | 3 dana | 1 nedelja | 2 nedelje |
| Phase 5 Testing | 3 dana | 1 nedelja | 2 nedelje |
| Phase 6 Deploy | 2 dana | 1 nedelja | 2 nedelje |
| **TOTAL** | **3 nedelje** | **2 meseca** | **4 meseca** |

## 🎨 Customizacija

### Build Configuration
Editujte `~/chromium/src/out/Default/args.gn`:
```gn
is_debug = false
is_component_build = true
enable_nacl = false
target_cpu = "x64"
```

### EtherX Specific
Kada budete spremni za Phase 2, kreiraćete:
- `src/etherx/` - EtherX-specific kod
- `etherx/args.gn` - Build config za EtherX

## 🆘 Podrška

### Ako nešto ne radi:
1. Proverite logove: `./etherx_build.sh` → Option 21
2. Proverite status: `./etherx_build.sh` → Option 20
3. Pogledajte TODO.md za detaljne instrukcije
4. Konsultujte Chromium dokumentaciju

### Za Phase-specific pomoć:
Svaka skripta generiše detaljan summary sa troubleshooting sekcijom.

## 📄 Licenca

TBD

---

## 🚀 Započnite Sada!

```bash
# 1. Učinite izvršnim
chmod +x etherx_build.sh

# 2. Pokrenite
./etherx_build.sh

# 3. Izaberite opciju 1 (Phase 1)

# 4. Sledite instrukcije
```

**Srećno sa razvojem EtherX Browsera!** 🎉
