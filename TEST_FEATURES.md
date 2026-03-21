# Test Nove Funkcionalnosti

## 📍 Geolocation (Pristup Lokaciji)

### Što je popravljeno:

- ✅ Dodana prava implementacija `navigator.geolocation.getCurrentPosition()`
- ✅ Automatsko prikazivanje location consent overlay-a na startu
- ✅ Spremanje lokacije u `sessionStorage` nakon dozvole
- ✅ Per-domain permission handling (Allow/Block/Ask)
- ✅ High-accuracy mode s timeout-om od 10s

### Kako testirati:

1. Otvori browser
2. Vidjet ćeš overlay "Dijeljenje lokacije"
3. Klikni "Dozvoli jednom" ili "Uvijek dozvoli"
4. Browser će zatražiti sistemsku dozvolu za lokaciju
5. Nakon dozvole, lokacija će biti prikazana u toast notifikaciji
6. Provjerite konzolu za detalje: `console.log('[EtherX] Location:', ...)`

### Ručno testiranje:

```javascript
// U developer tools konzoli:
window._requestUserLocation(); // Zatraži lokaciju
window._showLocationConsent("test.com"); // Prikaži consent overlay
```

### Spremljeni podaci:

- **sessionStorage**: `etherx_last_location` - JSON objekt s lat, lng, accuracy, timestamp
- **localStorage**: per-domain site permissions

---

## 📷 Camera ID Storage

### Što je popravljeno:

- ✅ Automatsko detekciju dostupnih kamera
- ✅ Spremanje preferirane kamere u `localStorage`
- ✅ Automatski odabir rear/back kamere ako postoji
- ✅ Fallback na default kameru ako stored ID ne radi
- ✅ Logging camera info (label, deviceId)

### Kako testirati:

1. Otvori Settings → QR Sync (ili gdje god je camera scanner)
2. Klikni "📷 Scan with Camera"
3. Kamera će se otvoriti (preferira rear camera)
4. Provjerite konzolu: `[EtherX] Using camera: ... ID: ...`
5. Na sljedećem otvaranju, ista kamera će se koristiti

### Ručno testiranje:

```javascript
// U developer tools konzoli:
await window._getAvailableCameras(); // Lista svih kamera
window._switchCamera("deviceId..."); // Promijeni kameru
```

### Spremljeni podaci:

- **localStorage**: `etherx_preferred_camera` - deviceId string

---

## 🤖 Bot Detection Fix

### Što je popravljeno:

- ✅ Reset bot detection state kod navigacije na novu stranicu
- ✅ Omogućeno ponovno skeniranje na različitim stranicama
- ✅ Spremanje detection rezultata u `sessionStorage`
- ✅ Exposed funkcija za manual re-check

### Kako testirati:

1. Otvori jednu stranicu
2. Bot detection će se izvršiti automatski
3. Navigiraj na drugu stranicu
4. Bot detection će se ponovno izvršiti (ne blokira)

### Ručno testiranje:

```javascript
// U developer tools konzoli:
window._recheckBotDetection(); // Ponovi bot detection
JSON.parse(sessionStorage.getItem("etherx_bot_detection")); // Provjeri rezultat
```

---

## 🧪 Debug Komande

Kopiraj ove komande u browser developer tools (F12):

### Check Location:

```javascript
// Provjeri spremljenu lokaciju
JSON.parse(sessionStorage.getItem("etherx_last_location"));

// Zatraži novu lokaciju
window._requestUserLocation();

// Provjeri permissions za domenu
const perms = JSON.parse(localStorage.getItem("ex_site_perms") || "{}");
console.log(perms);
```

### Check Camera:

```javascript
// Lista dostupnih kamera
await window._getAvailableCameras();

// Provjeri stored camera ID
localStorage.getItem("etherx_preferred_camera");

// Reset camera preference
localStorage.removeItem("etherx_preferred_camera");
```

### Check Bot Detection:

```javascript
// Vidi bot detection rezultat
JSON.parse(sessionStorage.getItem("etherx_bot_detection"));

// Force re-check
window._recheckBotDetection();
```

---

## 🔧 Dodatne funkcije

### Event Listeners:

- `tabSwitch` event - trigerira location permission check
- Navigation events - resetira bot detection state

### Storage Keys:

- `etherx_last_location` (sessionStorage) - GPS koordinate
- `etherx_preferred_camera` (localStorage) - Camera device ID
- `etherx_bot_detection` (sessionStorage) - Bot detection rezultat
- `etherx_location_prompt_shown` (sessionStorage) - Flag za prikazani prompt
- `ex_site_perms` (localStorage) - Per-domain permissions

---

## ⚠️ Troubleshooting

### Lokacija ne radi:

1. Provjeri je li HTTPS (location API zahtijeva secure context)
2. Provjeri sistemske permissions (Settings → Privacy → Location)
3. Provjerite browser console za errore
4. Clear sessionStorage i pokušaj ponovo

### Kamera ne radi:

1. Dozvoli camera permissions u browser settings
2. Provjeri je li kamera već u upotrebi (zatvori druge aplikacije)
3. Clear localStorage key: `etherx_preferred_camera`
4. Pokušaj ponovo

### Bot detection stalno pokazuje upozorenje:

1. Normalno je na prvom učitavanju stranice
2. Ako se pokazuje na svakoj navigaciji, provjerite se je li `window.navigateTo` pravilno wrapped
3. Resetiraj sa: `window._recheckBotDetection()`

---

## 📝 Notes

- Location API zahtijeva HTTPS ili localhost
- Camera API zahtijeva user gesture (button click)
- Bot detection koristi AI backend (etherx.ai.detectBotUA)
- Sve funkcije su backward compatible
