# EtherX Browser - Struktura Foldera

## 📁 Organizacija Projekta

Projekt je organizovan u **2 glavna foldera** na serveru:

```
/var/www/vhosts/kriptoentuzijasti.io/
│
├── AI projekt/browser/              ← 📝 PROJEKT (Development files)
│   ├── CONFIG.sh                    ← ⚙️ GLAVNA KONFIGURACIJA
│   ├── etherx_build.sh              ← 🚀 Build sistem
│   ├── scripts/                     ← Skripte za build
│   ├── docs/                        ← Dokumentacija
│   └── research/                    ← Research materijali
│
└── etherx_browser/                  ← 🔨 BUILD (Chromium files ~45GB)
    ├── depot_tools/                 ← Google build alati
    └── chromium/                    ← Chromium source + build
        └── src/                     ← Glavni source
            └── out/Default/         ← Kompajlirani fajlovi
```

---

## 🎯 Zašto Odvojena Struktura?

### 📝 **AI projekt/browser/** (Mali, čist, verzija kontrola)
- Skripte, dokumentacija, konfiguracija
- ~50MB
- Git repository
- Lako se backup-uje i dijeli

### 🔨 **etherx_browser/** (Veliki, privremeni build)
- Chromium source code (~30GB)
- Kompajlirani binaries (~15GB)
- Privremeni build fajlovi
- NE ide u Git
- Može se obrisati i ponovo build-ovati

---

## ⚙️ Konfiguracija

Sve putanje se definišu u **`CONFIG.sh`**:

```bash
SERVER_ROOT="/var/www/vhosts/kriptoentuzijasti.io"
CHROMIUM_ROOT="$SERVER_ROOT/etherx_browser/chromium"
DEPOT_TOOLS_ROOT="$SERVER_ROOT/etherx_browser/depot_tools"
PROJECT_ROOT="$SERVER_ROOT/AI projekt/browser"
```

---

## 🚀 Kako Koristiti

### 1. Pogledaj trenutnu konfiguraciju:
```bash
cd "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser"
source CONFIG.sh && show_config
```

### 2. Pokreni build:
```bash
./etherx_build.sh
```

### 3. Skripte automatski koriste putanje iz `CONFIG.sh`

---

## 🔄 Promjena Lokacija

Ako želiš promijeniti gdje ide Chromium, edituj **`CONFIG.sh`**:

```bash
# Trenutna struktura:
CHROMIUM_ROOT="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"

# Alternativa - home folder:
# CHROMIUM_ROOT="$HOME/chromium"

# Alternativa - opt folder:
# CHROMIUM_ROOT="/opt/chromium"
```

Sve skripte automatski prate ovu konfiguraciju!

---

## 💾 Disk Prostor

| Folder | Veličina | Opis |
|--------|----------|------|
| `AI projekt/browser/` | ~50MB | Projekt fajlovi |
| `etherx_browser/depot_tools/` | ~500MB | Build alati |
| `etherx_browser/chromium/` | ~30GB | Source code |
| `etherx_browser/chromium/src/out/` | ~15GB | Kompajlirani fajlovi |
| **UKUPNO** | **~45GB** | |

---

## 🧹 Čišćenje

### Obriši samo build output (oslobodi ~15GB):
```bash
rm -rf /var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium/src/out
```

### Obriši sve osim projekta (oslobodi ~45GB):
```bash
rm -rf /var/www/vhosts/kriptoentuzijasti.io/etherx_browser
```

### Projekt ostaje siguran u:
```bash
/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/
```

---

## 🔐 Sigurnost

**etherx_browser/** folder:
- Ownership: `kriptoen:psacln`
- NE treba biti dostupan preko web servera
- Dodaj u `.htaccess` ili Apache config ako treba

**Preporuka**: Provjeri da Apache/Nginx NE služi `etherx_browser/` folder!

---

## 📚 Dokumentacija

- **CONFIG.sh** - Konfiguracija putanja
- **README.md** - Glavni README
- **QUICKSTART.md** - Brzi start
- **TODO.md** - Development plan
- **Ovaj fajl** - Struktura foldera

---

## ❓ FAQ

**Q: Mogu li mijenjati lokaciju Chromium-a?**  
A: Da! Edituj `CONFIG.sh` i promijeni `CHROMIUM_ROOT`

**Q: Šta ako nema mjesta na `/var/www/`?**  
A: Možeš staviti u `$HOME` ili bilo gdje - samo promijeni `CONFIG.sh`

**Q: Trebam li backup-ovati etherx_browser folder?**  
A: Ne! Taj folder se može ponovo kreirati sa skriptama. Backup-uj samo `AI projekt/browser/`

**Q: Kako da dodam u Git?**  
A: 
```bash
cd "/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser"
# Dodaj .gitignore:
echo "/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/" >> .gitignore
git init
git add .
git commit -m "Initial commit"
```

---

**Pitanja?** Pogledaj `README.md` ili pokreni `./status.sh`
