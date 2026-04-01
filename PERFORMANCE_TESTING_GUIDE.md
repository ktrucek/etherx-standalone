# 🧪 EtherX Browser - Performance Testing Guide

**Verzija:** 1.0  
**Datum:** 1. April 2026

---

## 📋 Pregled

Ovaj guide pruža **konkretne testove** za mjerenje performansi EtherX Browsera prije i nakon optimizacija.

---

## 🎯 Testovi Po Kategorijama

### 1️⃣ Startup Performance

#### Test 1.1: Cold Start Time

**Šta testiramo:** Vrijeme od klika na ikonu do potpunog učitavanja UI-ja

```bash
# Linux - mjeri vrijeme
time ./etherx-standalone

# Ili ručno:
# 1. Zatvori browser potpuno
# 2. Pokreni sekunde-mer
# 3. Klikni na ikonu
# 4. Zaustavi timer čim se pojavi UI i možeš kliknuti
```

**Očekivano:**

- **Prije optimizacija:** 2-3 sekunde
- **Nakon optimizacija:** 1-1.5 sekunde
- **Target:** < 1.2s

#### Test 1.2: White Flash Test

**Šta testiramo:** Da li postoji bijeli flash pri startupu

```bash
1. Postavi dark theme u browseru
2. Zatvori app potpuno
3. Pokreni app i posmatraj
4. NE SMIJE biti bijeli flash prije nego se pojavi UI
```

**Očekivano:**

- ✅ **Nakon optimizacija:** Smooth fade-in, bez white flash
- ❌ **Prije:** Kratki bijeli flash

---

### 2️⃣ Memory Usage

#### Test 2.1: RAM Usage - Idle

**Šta testiramo:** RAM consumption sa jednim praznim tabom

```bash
# Linux
ps aux | grep etherx | grep -v grep

# Ili u Task Manager (Ctrl+Shift+Esc) → Details → etherx
```

**Očekivano:**

- **Prije:** 300-400 MB
- **Nakon:** 150-250 MB
- **Target:** < 200 MB

#### Test 2.2: RAM Usage - 10 Tabova

**Šta testiramo:** RAM consumption sa 10 otvorenih tabova (raznih stranica)

```bash
1. Otvori 10 tabova:
   - Google.com
   - YouTube.com
   - GitHub.com
   - Twitter.com
   - Facebook.com
   - Wikipedia.org
   - Reddit.com
   - StackOverflow.com
   - LinkedIn.com
   - Amazon.com

2. Čekaj 30s da se sve učita
3. Provjeri RAM:
   ps aux | grep etherx
```

**Očekivano:**

- **Prije:** 800-1200 MB
- **Nakon:** 350-600 MB
- **Target:** < 500 MB

#### Test 2.3: Memory Leak Test

**Šta testiramo:** Da li memorija nastavlja rasti nakon zatvaranja tabova

```bash
1. Provjeri initial RAM (1 tab)
2. Otvori 20 tabova random stranica
3. Provjeri RAM (peak)
4. Zatvori SVE tabove osim prvog
5. Čekaj 30 sekundi
6. Provjeri RAM ponovo

# RAM nakon zatvaranja treba biti ~ kao initial ± 50MB
```

**Očekivano:**

- ✅ **Nakon optimizacija:** RAM se vraća na initial ± 50MB
- ❌ **Prije:** RAM ostaje visok

---

### 3️⃣ Tab Switching Performance

#### Test 3.1: Tab Switch Speed

**Šta testiramo:** Brzina prebacivanja između tabova

```bash
1. Otvori 5 tabova (različite stranice)
2. Switchuj između tab 1 → tab 2 → tab 3 → tab 1
3. Osjećaj treba biti instant (< 100ms)
```

**Benchmark:**

```javascript
// Otvori DevTools (F12) → Console, zalijepi:
const tab1 = document.querySelector('[data-tab-id="TAB1_ID"]');
const tab2 = document.querySelector('[data-tab-id="TAB2_ID"]');

console.time("tabSwitch");
tab2.click();
requestAnimationFrame(() => {
  console.timeEnd("tabSwitch");
});
```

**Očekivano:**

- **Prije:** 150-300ms
- **Nakon:** 30-70ms
- **Target:** < 50ms

---

### 4️⃣ Loading Bar Smoothness

#### Test 4.1: Progress Bar FPS

**Šta testiramo:** Da li loading bar animacija ima 60 FPS

```bash
1. Otvori stranicu sa sporom konekcijom (npr. veliki PDF)
2. Posmatraj loading progress bar
3. Treba biti smooth, bez trzanja
```

**Chrome DevTools:**

```bash
1. F12 → Performance tab
2. Klikni Record
3. Učitaj stranicu
4. Stop record
5. Provjeri FPS graph → treba biti 60fps tokom animacije
```

**Očekivano:**

- ✅ **Nakon optimizacija:** Consistent 60 FPS
- ❌ **Prije:** Drops na 20-30 FPS

---

### 5️⃣ Search Performance

#### Test 5.1: History Search Speed

**Šta testiramo:** Brzina pretrage u historiji (1000+ items)

```bash
1. Napravi 1000+ history entries (generate script ispod)
2. Otvori History panel (Ctrl+H)
3. U search box upiši "test"
4. Mjeri vrijeme do prikazivanja rezultata
```

**Generate test data:**

```javascript
// U DevTools console:
for (let i = 0; i < 1000; i++) {
  DB.addHistory({
    url: `https://test${i}.example.com`,
    title: `Test Page ${i}`,
    ts: Date.now() - i * 1000,
  });
}
```

**Benchmark:**

```javascript
console.time("historySearch");
const results = DB.searchHistory("test");
console.timeEnd("historySearch");
console.log("Results:", results.length);
```

**Očekivano:**

- **Prije:** 200-400ms
- **Nakon:** 20-50ms
- **Target:** < 30ms

#### Test 5.2: Bookmark Search Speed

**Šta testiramo:** Brzina pretrage u bookmarks

```javascript
// Generate 500 bookmarks
for (let i = 0; i < 500; i++) {
  DB.addBookmark({
    url: `https://bookmark${i}.com`,
    title: `Bookmark Test ${i}`,
    folder: i % 5 === 0 ? "Work" : null,
  });
}

// Benchmark search
console.time("bookmarkSearch");
const results = DB.searchBookmarks("test");
console.timeEnd("bookmarkSearch");
```

**Očekivano:**

- **Prije:** 150-300ms
- **Nakon:** 15-30ms
- **Target:** < 25ms

---

### 6️⃣ Scrolling Performance

#### Test 6.1: History List Scrolling (1000+ items)

**Šta testiramo:** Smooth scrolling kroz veliku listu

```bash
1. Generiši 1000+ history items (script gore)
2. Otvori History panel
3. Scrolluj brzo gore-dolje
4. Treba biti 60fps, bez lagova
```

**DevTools FPS Test:**

```bash
1. F12 → Performance → CPU 6x slowdown
2. Record
3. Scroll history list
4. Stop
5. Check FPS graph → treba biti 60fps (ili blizu)
```

**Očekivano:**

- ✅ **Nakon (Virtual Scrolling):** 60 FPS constant
- ❌ **Prije:** 20-30 FPS, laggy

---

### 7️⃣ Page Load Performance

#### Test 7.1: Static Asset Caching

**Šta testiramo:** Brzina učitavanja iz Service Worker cache-a

```bash
1. Učitaj lokalnu stranicu (npr. Settings)
2. Zatvori tab
3. Otvori ponovo istu stranicu
4. Treba biti INSTANT (< 50ms)
```

**Network Tab:**

```bash
1. F12 → Network tab
2. Reload Settings page
3. Provjeri da li CSS/JS dolazi iz cache:
   - (ServiceWorker) oznaka
   - Size: (from ServiceWorker)
   - Time: < 10ms
```

**Očekivano:**

- ✅ **Nakon (Cache First):** < 10ms za cached assets
- ❌ **Prije (Network First):** 50-200ms

#### Test 7.2: External Page Load

**Šta testiramo:** Brzina učitavanja popularnih stranica

```bash
Test stranice (sa session warming):
- google.com → očekivano < 500ms
- youtube.com → očekivano < 800ms
- github.com → očekivano < 600ms
```

**Benchmark:**

```javascript
// U webview DevTools:
performance.timing.loadEventEnd - performance.timing.navigationStart;
```

**Očekivano poboljšanje:**

- **Session Preconnect:** 100-300ms brže (DNS/TLS already done)
- **Resource hints:** 50-150ms brže (CDN preconnect)

---

### 8️⃣ GPU Acceleration

#### Test 8.1: Video Playback CPU Usage

**Šta testiramo:** CPU consumption pri puštanju YouTube videa

```bash
1. Otvori YouTube video (1080p60)
2. Pusti fullscreen
3. Provjeri CPU usage:

   top -p $(pgrep etherx)

   # Ili Task Manager
```

**Očekivano:**

- **Prije:** 40-60% CPU (software decoding)
- **Nakon (GPU decode):** 10-20% CPU
- **Target:** < 15% CPU

#### Test 8.2: Canvas Animation Performance

**Šta testiramo:** FPS animacija sa Canvas API

**Test stranica:**

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Canvas Test</title>
  </head>
  <body>
    <canvas id="c" width="800" height="600"></canvas>
    <div id="fps"></div>
    <script>
      const canvas = document.getElementById("c");
      const ctx = canvas.getContext("2d");
      let frame = 0;
      let lastTime = performance.now();

      function draw() {
        // Draw 100 rotating rectangles
        ctx.clearRect(0, 0, 800, 600);
        for (let i = 0; i < 100; i++) {
          ctx.save();
          ctx.translate(400, 300);
          ctx.rotate(frame * 0.01 + i * 0.1);
          ctx.fillStyle = `hsl(${i * 3.6}, 50%, 50%)`;
          ctx.fillRect(-50, -50, 100, 100);
          ctx.restore();
        }

        // FPS counter
        const now = performance.now();
        const fps = 1000 / (now - lastTime);
        document.getElementById("fps").textContent = `FPS: ${fps.toFixed(1)}`;
        lastTime = now;

        frame++;
        requestAnimationFrame(draw);
      }
      draw();
    </script>
  </body>
</html>
```

**Očekivano:**

- ✅ **Nakon (GPU accelerated 2D canvas):** 60 FPS
- ❌ **Prije:** 30-40 FPS

---

### 9️⃣ CSS Containment Impact

#### Test 9.1: Tab Rendering Performance

**Šta testiramo:** Repaint/reflow performance pri mijenjanju active taba

```bash
1. Otvori 20 tabova
2. F12 → Performance → Enable paint flashing
3. Switch između tabova
4. Posmatraj da li cijeli UI repaint ili samo tab?
```

**Očekivano:**

- ✅ **Nakon (CSS containment):** Samo active tab repaint
- ❌ **Prije:** Cijeli UI repaint

---

### 🔟 Database Performance

#### Test 10.1: Index Impact

**Šta testiramo:** Brzina search query sa i bez indeksa

```bash
# Prije dodavanja indeksa (simulacija):
# Search query: SELECT * FROM history WHERE title LIKE '%test%'
# Time: 200-400ms

# Nakon dodavanja indeksa:
# Query koristi: idx_history_title
# Time: 20-50ms
```

**Benchmark:**

```javascript
// U main process DevTools:
console.time("historyQuery");
db.db.prepare("SELECT * FROM history WHERE title LIKE ?").all("%test%");
console.timeEnd("historyQuery");
```

**Očekivano:**

- **Prije (no index):** 150-400ms
- **Nakon (indexed):** 15-50ms
- **Target:** < 30ms

---

## 📊 Complete Performance Report Template

```markdown
# EtherX Performance Test Report

**Datum:** **\_**
**Sistem:** Linux / Windows / Mac
**RAM:** **\_**
**CPU:** **\_**

## Results

| Test            | Before     | After      | Improvement |
| --------------- | ---------- | ---------- | ----------- |
| Cold Start      | \_\_\_s    | \_\_\_s    | \_\_\_%     |
| RAM (idle)      | \_\_\_MB   | \_\_\_MB   | \_\_\_%     |
| RAM (10 tabs)   | \_\_\_MB   | \_\_\_MB   | \_\_\_%     |
| Tab Switch      | \_\_\_ms   | \_\_\_ms   | \_\_\_%     |
| History Search  | \_\_\_ms   | \_\_\_ms   | \_\_\_%     |
| Loading Bar FPS | \_\_\_fps  | \_\_\_fps  | \_\_\_%     |
| Video CPU       | \_\_\_%    | \_\_\_%    | \_\_\_%     |
| White Flash     | ☐ Yes ☐ No | ☐ Yes ☐ No | **\_**      |

## Notes

- ***
- ***
- ***

## Conclusion

☐ All tests passed
☐ Some tests need improvement
☐ Major issues found

**Rating:** ⭐⭐⭐⭐⭐ (\_\_\_/5)
```

---

## 🎯 Quick 5-Minute Validation

Za brzo testiranje da li optimizacije rade:

```bash
# 1. Startup (< 1.5s)
time ./etherx-standalone

# 2. RAM idle (< 250MB)
ps aux | grep etherx | awk '{print $6/1024 " MB"}'

# 3. Tab switch (feel - instant?)
# Otvori 3 taba, switchuj brzo. Laggy? ❌ Instant? ✅

# 4. White flash?
# Dark theme → restart → bijeli flash? ❌ Smooth? ✅

# 5. Loading bar smooth?
# Učitaj stranicu → progress glatko? ✅ Trzavo? ❌
```

**Ako svih 5 testova prolaze ✅ → Optimizacije working!**

---

## 🏆 Benchmark Targets (Summary)

| Metrika              | Target   |
| -------------------- | -------- |
| **Startup**          | < 1.2s   |
| **RAM (idle)**       | < 200 MB |
| **RAM (10 tabs)**    | < 500 MB |
| **Tab Switch**       | < 50ms   |
| **Search**           | < 30ms   |
| **FPS (animations)** | 60 fps   |
| **Video CPU**        | < 15%    |
| **White Flash**      | None     |

Postignite sve targets = **🚀 Super-fast browser!**

---

## 📝 Troubleshooting

### Problem: Startup još uvijek spor (> 2s)

**Rješenja:**

- Provjeri da li je database preloaded (migracije mogu usporiti)
- Provjeri da li extensions brzo učitavaju (Reveye?)
- Disable AdBlocker privremeno i testiraj

### Problem: RAM ne pada nakon zatvaranja tabova

**Rješenja:**

- Provjeri da li `closeTab()` poziva `wv.stop()` i `removeAllListeners`
- Provjeri da li `about:blank` se setuje prije `remove()`
- Manual GC: `global.gc()` iz DevTools

### Problem: Loading bar još uvijek laggy

**Rješenja:**

- Provjeri da li `setLoading()` koristi `requestAnimationFrame`
- Provjeri da li CSS ima `will-change: width` na `.loading-bar`
- Provjeri FPS throttling (possible v-sync issue?)

### Problem: Search još uvijek spor

**Rješenja:**

- Provjeri da li indeksi postoje: `.schema` u SQLite CLI
- Verify query uses index: `EXPLAIN QUERY PLAN SELECT ...`
- Increase `cache_size` u database.js

---

## ✅ Testing Checklist

Prije release-a:

- [ ] ✅ Cold start < 1.5s
- [ ] ✅ No white flash
- [ ] ✅ RAM idle < 250MB
- [ ] ✅ RAM 10 tabs < 600MB
- [ ] ✅ Tab switch instant (< 100ms feel)
- [ ] ✅ History search < 50ms
- [ ] ✅ Loading bar 60fps
- [ ] ✅ No memory leaks (close 20 tabs test)
- [ ] ✅ Video CPU < 20%
- [ ] ✅ Smooth scrolling 1000+ items

**Sve testirano? Ship it! 🚀**
