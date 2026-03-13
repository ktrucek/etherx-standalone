# 🌍 EtherX i18n Sustav - Potpuno Višejezični Preglednik

## 📁 Kreirani Fajlovi

```
src/main/
├── i18n.js             (postojeći - osnovni prijevodi za 13 jezika)
├── i18n-extended.js    (NOVO - prošireni prijevodi za menu i settings)
└── i18n-loader.js      (NOVO - dinamički loader i language switcher)

INTEGRATION_GUIDE_i18n.html     (primjer za browser.html menu bar)
INTEGRATION_GUIDE_settings.html (primjer za settings.html)
```

## 🎯 Podržani Jezici (6 jezika)

| Jezik | Kod | Zastava |
|-------|-----|---------|
| Hrvatski | `hr` | 🇭🇷 |
| Engleski | `en` | 🇬🇧 |
| Njemački | `de` | 🇩🇪 |
| Talijanski | `it` | 🇮🇹 |
| Francuski | `fr` | 🇫🇷 |
| Španjolski | `es` | 🇪🇸 |

## 📋 Prevedena Područja

### Menu Bar (Glavni Meni)
✅ **Datoteka (File)**: Nova kartica, Novi privatni prozor, Otvori lokaciju, Zatvori karticu, Ispis  
✅ **Uredi (Edit)**: Poništi, Ponovi, Izreži, Kopiraj, Zalijepi, Obriši, Odaberi sve, Auto ispuna  
✅ **Prikaz (View)**: Alatna traka, Traka favorita, Statusna traka, Stop, Reload, Zoom, Fullscreen  
✅ **Povijest (History)**: Prikaži povijest, Natrag, Naprijed, Obriši povijest  
✅ **Oznake (Bookmarks)**: Početna stranica, Prikaži oznake, Uredi oznake, Dodaj oznaku  
✅ **Razvoj (Develop)**: JavaScript konzola, Izvorni kod, Devtools, Mrežni inspektor  
✅ **Prozor (Window)**: Minimiziraj, Prethodna kartica, Sljedeća kartica, Prikvači, Dupliciraj, Preuzimanja  
✅ **Pomoć (Help)**: O EtherX pregledniku, Tipkovnički prečaci  

### Settings Page (Postavke)
✅ **Općenito**: Pokretanje, Početna stranica, Nova kartica  
✅ **Kartice**: Traka kartica, Gumb zatvaranja, Auto sakrij  
✅ **Auto Ispuna**: Obrasci, Adrese, Platne kartice  
✅ **Lozinke**: Spremanje lozinki, Automatsko ispunjavanje  
✅ **Pretraga**: Zadana tražilica, Upravljanje tražilicama  
✅ **Sigurnost**: Safe browsing, HTTPS-only mode  
✅ **Privatnost**: Do Not Track, Kolačići treće strane, Brisanje podataka  
✅ **Web-stranice**: Dopuštenja, Notifikacije, Lokacija  
✅ **Profili**: Korisničke profile, Import/Export  
✅ **Proširenja**: Upravljanje ekstenzijama  
✅ **Napredno**: Napredne postavke, Developer options  
✅ **Programer**: Debugging, Console logs  
✅ **Zastavice**: Eksperimentalne značajke  
✅ **Izgled**: Teme, Fontovi, Boje  
✅ **Jezik**: Izbor jezika interfacea  
✅ **Pohrana**: Cache, Cookies, LocalStorage  

## 🚀 Kako Integrirati u Postojeće Fajlove

### 1️⃣ Ažuriraj `browser.html`

Dodaj u `<head>` sekciju:

```html
<!-- Load i18n scripts -->
<script src="../main/i18n.js"></script>
<script src="../main/i18n-extended.js"></script>
<script src="../main/i18n-loader.js"></script>

<!-- Initialize i18n -->
<script>
  document.addEventListener('DOMContentLoaded', () => {
    window.i18n.initI18n();
    
    // Add language selector to title bar
    const titleBar = document.querySelector('.title-bar');
    if (titleBar) {
      window.i18n.createLanguageSelector(titleBar);
    }
  });
</script>
```

Dodaj `data-i18n` atribute na menu stavke:

```html
<!-- Primjer za File menu -->
<div class="menu-item" data-menu="file">
  <span data-i18n="menuFile">Datoteka</span>
  <div class="dropdown">
    <div class="di" id="mi-new-tab">
      <span data-i18n="menuFileNewTab">Nova kartica</span>
    </div>
    <!-- ... ostale stavke -->
  </div>
</div>
```

**Vidi: `INTEGRATION_GUIDE_i18n.html` za kompletan primjer!**

### 2️⃣ Ažuriraj `settings.html`

Dodaj jezični selektor kontejner:

```html
<!-- Language Selector Container -->
<div id="langSelectorContainer" style="position:fixed;top:10px;right:10px;z-index:9999"></div>
```

Dodaj `data-i18n` atribute na sidebar navigaciju:

```html
<nav class="sidebar">
  <div class="nav-item" data-section="general">
    <span data-i18n="settingsGeneral">Općenito</span>
  </div>
  <div class="nav-item" data-section="tabs">
    <span data-i18n="settingsTabs">Kartice</span>
  </div>
  <!-- ... ostale sekcije -->
</nav>
```

Dodaj `data-i18n` na sve postavke:

```html
<div class="setting-row">
  <label data-i18n="settingsGeneralHomepage">Početna stranica:</label>
  <input type="url" data-i18n-placeholder="settingsGeneralHomepagePlace" placeholder="https://etherx.io">
</div>
```

**Vidi: `INTEGRATION_GUIDE_settings.html` za kompletan primjer!**

## 🧰 API Referenca

### `window.i18n` Globalni Objekt

```javascript
// Inicijaliziraj i18n sustav (poziva se automatski pri DOMContentLoaded)
window.i18n.initI18n();

// Dobavi prijevod za ključ
const translation = window.i18n.t('menuFile'); // "Datoteka" (hr) ili "File" (en)

// Promijeni jezik
window.i18n.setLanguage('en'); // Prebaci na engleski

// Dobavi trenutni jezik
const currentLang = window.i18n.getCurrentLanguage(); // "hr"

// Dobavi sve dostupne jezike
const langs = window.i18n.getAvailableLanguages();
// [
//   { code: 'hr', name: 'Hrvatski', flag: '🇭🇷' },
//   { code: 'en', name: 'English', flag: '🇬🇧' },
//   ...
// ]

// Kreiraj language selector dropdown
window.i18n.createLanguageSelector(containerElement);

// Manuelno prevedi stranicu (koristi se automatski pri promjeni jezika)
window.i18n.translatePage();

// Event listener za promjenu jezika
window.addEventListener('languageChanged', (e) => {
  console.log('Jezik promijenjen na:', e.detail.lang);
});
```

## 🎨 HTML Atributi za Prijevod

### `data-i18n` - Prijevod tekstualnog sadržaja

```html
<span data-i18n="menuFile">Datoteka</span>
```

### `data-i18n-placeholder` - Prijevod placeholder atributa

```html
<input type="text" data-i18n-placeholder="searchPlaceholder" placeholder="Pretraži...">
```

### `data-i18n-title` - Prijevod title atributa (tooltip)

```html
<button data-i18n-title="closeTooltip" title="Zatvori karticu">✕</button>
```

## 🔧 Struktura Ključeva Prijevoda

### Menu Bar Ključevi

```
menuFile, menuFileNewTab, menuFileNewPrivate, menuFileOpenLocation, ...
menuEdit, menuEditUndo, menuEditRedo, menuEditCut, ...
menuView, menuViewAlwaysToolbar, menuViewShowFavBar, ...
menuHistory, menuHistoryShow, menuHistoryBack, ...
menuBookmarks, menuBMStartPage, menuBMShow, ...
menuDevelop, menuDevConsole, menuDevPageSource, ...
menuWindow, menuWinMinimise, menuWinPrevTab, ...
menuHelp, menuHelpAbout, menuHelpShortcuts
```

### Settings Ključevi

```
settingsGeneral, settingsGeneralDesc, settingsGeneralStartup, ...
settingsTabs, settingsTabsDesc, settingsTabsShowBar, ...
settingsAutoFill, settingsAutoFillDesc, settingsAutoFillEnable, ...
settingsPasswords, settingsPasswordsDesc, settingsPasswordsSave, ...
settingsSearch, settingsSearchDesc, settingsSearchEngine, ...
settingsSecurity, settingsSecurityDesc, settingsSecuritySafe, ...
settingsPrivacy, settingsPrivacyDesc, settingsPrivacyDNT, ...
```

Vidi: `src/main/i18n-extended.js` za **sve ključeve** (300+ prijevoda po jeziku)!

## 🧪 Testiranje

1. Otvori `browser.html` u pregledniku
2. Klikni na language dropdown (trebao bi biti u title bar)
3. Odaberi drugi jezik (npr. English)
4. **Svi menu itemi trebali bi se ažurirati!**
5. Otvori Developer Tools (F12) i provjeri konzolu za debug poruke

```
[EtherX] i18n system initialized
[i18n] Language changed to: en
[i18n] Page translated to: en
```

## 📝 Dodavanje Novih Prijevoda

### Ažuriraj `src/main/i18n-extended.js`:

```javascript
const EXTENDED_STRINGS = {
  hr: {
    myNewKey: 'Moj novi tekst',
    // ...
  },
  en: {
    myNewKey: 'My new text',
    // ...
  },
  // ... ostali jezici
};
```

### Koristi u HTML-u:

```html
<span data-i18n="myNewKey">Moj novi tekst</span>
```

### Ili u JavaScriptu:

```javascript
const text = window.i18n.t('myNewKey');
```

## 🎁 Bonus Funkcionalnosti

### 🔔 Language Changed Event

```javascript
window.addEventListener('languageChanged', (e) => {
  const newLang = e.detail.lang;
  console.log(`Korisnik je promijenio jezik na: ${newLang}`);
  
  // Možete ovdje refreshati podatke, ažurirati UI, itd.
});
```

### 💾 LocalStorage Persistence

Izabrani jezik se automatski sprema u `localStorage` pod ključem `etherx-language`:

```javascript
// Jezik persista između sessiona
localStorage.setItem('etherx-language', 'hr');
```

### 🌐 Automatska Detekcija Jezika

Pri prvom pokretanju, sustav automatski detektira jezik preglednika:

```javascript
// Ako jezik nije postavljen, koristi browser language ili 'hr' kao default
const browserLang = navigator.language.slice(0, 2); // 'en', 'hr', 'de', ...
```

## 📦 Deployment

Kada integriraš sve u svoje production fajlove:

1. ✅ `src/main/i18n.js` - već postoji, ostavi ga
2. ✅ `src/main/i18n-extended.js` - kopiraj novi fajl
3. ✅ `src/main/i18n-loader.js` - kopiraj novi fajl
4. ✅ `src/renderer/browser.html` - dodaj `<script>` tagove i `data-i18n` atribute
5. ✅ `src/renderer/settings.html` - dodaj `<script>` tagove i `data-i18n` atribute

## 🐛 Debugging

### Problem: Prijevodi se ne prikazuju

**Rješenje:**
- Provjeri konzolu za greške
- Provjeri jeste li učitali sve 3 script fajla (i18n.js, i18n-extended.js, i18n-loader.js)
- Provjeri jesu li `data-i18n` atributi ispravno postavljeni

### Problem: Language selector se ne prikazuje

**Rješenje:**
- Provjeri postoji li kontejner element u DOM-u
- Provjeri pozivate li `createLanguageSelector()` **nakon** što je DOM spreman

### Problem: Jezik se ne mijenja

**Rješenje:**
- Otvori Developer Tools i provjeri localStorage: `localStorage.getItem('etherx-language')`
- Provjeri ima li browser pristup localStorage (možda ste u incognito mode)

## 📊 Statistika

| Metrika | Vrijednost |
|---------|-----------|
| Broj jezika | **6** (hr, en, de, it, fr, es) |
| Menu bar stavki | **~100** |
| Settings stavki | **~200** |
| Ukupno translation keyeva | **~300 po jeziku** |
| Ukupno prijevoda | **~1,800** |
| Size i18n-extended.js | **~3,600 linija** |
| Size i18n-loader.js | **~240 linija** |

## 🎉 Gotovo!

Sada imate potpuno funkcionalan višejezični EtherX preglednik s 6 jezika! 🚀

---

**Pitanja?** Pogledaj:
- `INTEGRATION_GUIDE_i18n.html` - Kompletan primjer za menu bar
- `INTEGRATION_GUIDE_settings.html` - Kompletan primjer za settings page
- `src/main/i18n-extended.js` - Svi prijevodi
- `src/main/i18n-loader.js` - API dokumentacija (komentari u kodu)

**Made with ❤️ for EtherX Browser**
