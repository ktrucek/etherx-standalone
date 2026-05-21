# EtherX Browser — Standalone Build

Ovo je čisti standalone build EtherX browsera **bez n8n proxy-ja**.

<!-- GitHub token se NE sprema u fajlove — upiši ga u Settings → Developer -->

## 📥 Download & Installation

**Download:** https://etherx.io/browser.html

**Platforms:**

- 🍎 macOS (arm64 DMG, x64 ZIP)
- 🪟 Windows (EXE installer)
- 🐧 Linux (AppImage)

**⚠️ macOS Users:** If you see **"EtherX Browser is damaged"** message, see [macOS Installation Guide](INSTALL_MACOS.md) for quick fix.

---

## Što je uključeno

✅ Sve browser funkcije (kartice, bookmarks, povijest, itd.)  
✅ Ad Blocker  
✅ AI sažetak stranica (Gemini API)  
✅ Password manager (Bitwarden integracija)  
✅ QR sinkronizacija  
✅ Privatno pregledavanje  
✅ Developer Tools  
✅ Postavke (14 novih sekcija):

- Povijest
- Kolačići
- Dozvole (notifikacije, lokacija, kamera, mikrofon)
- Preuzimanja
- Pretraživač
- Prečaci
- Cache
- Sigurnost
- DNS over HTTPS
- Developer opcije
- Nadogradnje
- Backup/Restore
- **AI Agent postavke** (Gemini + OpenAI API ključevi)

✅ Vizualni live preview u Appearance postavkama  
✅ Performance optimizacije (in-memory cache, debounced save)  
✅ i18n podrška (HR/EN)

## Što je izostavljeno

❌ n8n.kriptoentuzijasti.io proxy linkovi  
❌ Hardkodirani URL-ovi prema kriptoentuzijasti.io servisima

## Deployment

### Web verzija (hostanje na bilo kojem serveru):

1. Kopiraj `src/index.html` na server
2. Kopiraj `assets/` folder
3. Otvori u browseru

### Electron verzija:

1. `npm install`
2. `npm start` — pokreće Electron app
3. `npm run build` — kreira distributable pakete

### Siguran deploy bez .env commita

`.env.local` je ignoriran i ne treba ići na GitHub.

Preporučeni način za deploy tajne:

1. Spremi tajne izvan repozitorija u `~/.config/etherx/deploy.env`
2. Pokreni deploy skriptu normalno: `./deploy.sh`

Korisne opcije:

- `./deploy.sh --save-secrets` sprema trenutno exportane tajne u `~/.config/etherx/deploy.env`
- `./deploy.sh --write-env-local` generira lokalni `.env.local` iz učitanih tajni

Deploy skripta automatski nikad ne stage-a `.env*` datoteke.

## API ključevi

Za AI funkcije, korisnici trebaju dodati vlastite API ključeve u **Postavke → AI Agent**:

- Google Gemini API Key (za sažetak stranica)
- OpenAI API Key (opcionalno, za ChatGPT integraciju)

## License

© 2024–2026 kriptoentuzijasti.io. Proprietary software.
