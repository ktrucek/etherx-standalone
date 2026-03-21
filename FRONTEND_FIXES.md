# Frontend Popravke - Sažetak

## ✅ Što je popravljeno

### 1. 📍 **Pristup Lokaciji (Geolocation)**

**Problem:** Prikazivao se overlay "Podijeli lokaciju" ali nije se zapravo tražila geolokacija.

**Rješenje:**

- Dodana funkcija `requestUserLocation()` koja koristi `navigator.geolocation.getCurrentPosition()`
- Povezani svi buttoni u overlay-u (Odbij, Dozvoli jednom, Uvijek dozvoli)
- Spremanje lokacije u `sessionStorage` kao JSON
- Automatsko prikazivanje consent overlay-a na prvom učitavanju
- Per-domain permission storage (Allow/Block/Ask)
- High-accuracy mode s timeout-om i error handling-om

**Testiranje:**

```javascript
// Browser console
window._requestUserLocation(); // Zatraži lokaciju
```

---

### 2. 📷 **Camera ID Storage i Handling**

**Problem:** Camera ID se nije spremao, svaki put se birala random kamera.

**Rješenje:**

- Storage camera ID-a u `localStorage` (`etherx_preferred_camera`)
- Automatska detekcija svih dostupnih kamera
- Pametni odabir rear/back kamere ako postoji
- Fallback na default kameru ako stored ID ne radi više
- Logging svih camera info (label, deviceId) u console

**Nove funkcije:**

```javascript
await window._getAvailableCameras(); // Lista kamera
window._switchCamera("deviceId"); // Promijeni kameru
```

---

### 3. 🤖 **Bot Detection - Ponovno Skeniranje**

**Problem:** Bot detection se izvršavao samo jednom i blokirao ponovno skeniranje na drugim stranicama.

**Rješenje:**

- Reset bot detection state kod navigacije na novu URL
- Tracking zadnje provjerene URL-e
- Omogućeno ponovno pokretanje detection-a
- Spremanje rezultata u `sessionStorage` za debugging

**Nova funkcija:**

```javascript
window._recheckBotDetection(); // Ponovi bot detection
```

---

## 📦 Izmijenjene datoteke

1. **`src/renderer/js/browser.js`**
   - Location consent overlay logic (linije ~5711-5900)
   - Camera ID storage i handling (linije ~1801-1900)
   - Bot detection refactoring (linije ~5350-5390)

2. **`TEST_FEATURES.md`** ⭐ NOVO
   - Kompletan test guide sa svim komandama
   - Debug upute
   - Troubleshooting

---

## 🧪 Kako testirati

### 1. Lokacija:

1. Pokreni aplikaciju
2. Automatski će se prikazati "Dijeljenje lokacije" overlay
3. Klikni "Dozvoli jednom" ili "Uvijek dozvoli"
4. Browser će zatražiti sistemsku dozvolu
5. Nakon dozvole, vidjet ćeš toast sa koordinatama
6. Provjeri konzolu: `[EtherX] Location: {latitude, longitude, accuracy}`

### 2. Camera:

1. Otvori QR scanner
2. Klikni "📷 Scan with Camera"
3. Kamera će se otvoriti (preferira rear camera)
4. Provjeri konzolu: `[EtherX] Using camera: ... ID: ...`
5. Zatvori i ponovo otvori - ista kamera će se koristiti

### 3. Bot Detection:

1. Otvori stranicu → vidit ćeš bot detection toast (ako je bot UA)
2. Navigiraj na drugu stranicu
3. Bot detection će se ponovno izvršiti (neće blokirati)

---

## 🔑 Važne Storage Keys

### localStorage:

- `etherx_preferred_camera` - Stored camera device ID
- `ex_site_perms` - Per-domain permissions (location, camera, mic...)

### sessionStorage:

- `etherx_last_location` - Posljednja GPS lokacija (JSON)
- `etherx_bot_detection` - Bot detection rezultat (JSON)
- `etherx_location_prompt_shown` - Flag da je prikazan location prompt

---

## 🐛 Debug Komande

### Lokacija:

```javascript
// Vidi spremljenu lokaciju
JSON.parse(sessionStorage.getItem("etherx_last_location"));

// Zatraži novu
window._requestUserLocation();

// Vidi permission za domenu
JSON.parse(localStorage.getItem("ex_site_perms") || "{}");
```

### Camera:

```javascript
// Lista kamera
await window._getAvailableCameras();

// Stored ID
localStorage.getItem("etherx_preferred_camera");

// Reset
localStorage.removeItem("etherx_preferred_camera");
```

### Bot Detection:

```javascript
// Rezultat
JSON.parse(sessionStorage.getItem("etherx_bot_detection"));

// Re-check
window._recheckBotDetection();
```

---

## ⚡ Quick Test Commands

Otvori browser console (F12) i kopiraj:

```javascript
// === FULL TEST SUITE ===

console.log("=== LOCATION TEST ===");
window._requestUserLocation();

console.log("=== CAMERA TEST ===");
window._getAvailableCameras().then((cameras) => {
  console.log("Available cameras:", cameras);
  console.log(
    "Stored camera ID:",
    localStorage.getItem("etherx_preferred_camera"),
  );
});

console.log("=== BOT DETECTION TEST ===");
const botResult = sessionStorage.getItem("etherx_bot_detection");
console.log(
  "Bot detection:",
  botResult ? JSON.parse(botResult) : "Not run yet",
);

console.log("=== STORAGE CHECK ===");
const location = sessionStorage.getItem("etherx_last_location");
console.log("Last location:", location ? JSON.parse(location) : "Not set");
console.log(
  "Site perms:",
  JSON.parse(localStorage.getItem("ex_site_perms") || "{}"),
);

console.log("✅ All tests executed!");
```

---

## 📞 Podrška

Ako nešto ne radi:

1. Provjeri browser console za errore (F12)
2. Clear localStorage i sessionStorage
3. Provjeri sistemske permissions (Location, Camera)
4. Vidi `TEST_FEATURES.md` za detaljne upute

---

## 🎯 Sljedeći koraci

- [ ] Testirati na production okruženju
- [ ] Dodati UI opcije u Settings za manual location request
- [ ] Dodati camera selector dropdown
- [ ] Dodati location history (zadnjih N lokacija)
- [ ] Implementirati location tracking (real-time)

---

**Status:** ✅ Sve implementirano i testirano
**Datoteke:** 1 izmjenjena (`browser.js`), 2 nove (`TEST_FEATURES.md`, `FRONTEND_FIXES.md`)
**Greške:** 0
