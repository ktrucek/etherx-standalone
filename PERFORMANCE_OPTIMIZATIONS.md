# 🚀 EtherX Browser - Performance Optimizations

## 📋 Sadržaj

1. [Service Worker Optimizacije](#1-service-worker-optimizacije)
2. [DOM Optimizacije](#2-dom-optimizacije)
3. [Lazy Loading & Code Splitting](#3-lazy-loading--code-splitting)
4. [Virtual Scrolling](#4-virtual-scrolling)
5. [Web Workers](#5-web-workers)
6. [Resource Hints](#6-resource-hints)
7. [Memory Management](#7-memory-management)
8. [Database Optimizacije](#8-database-optimizacije)
9. [Event Handling](#9-event-handling)
10. [Rendering Optimizacije](#10-rendering-optimizacije)

---

## 1. Service Worker Optimizacije

### ⚡ Cache First Strategy za statičke resurse

**Trenutno stanje:** Network First (uvijek traži mrežu pa fallback na cache)
**Problem:** Sporo učitavanje čak i kada je cache dostupan

**Optimizacija:**

```javascript
// sw.js - optimizirano
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (!url.protocol.startsWith("http") || event.request.method !== "GET") {
    return;
  }

  // Liste za različite strategije
  const cacheFirst = [
    "/etherx-standalone/assets/",
    "/etherx-standalone/src/logo",
    ".css",
    ".js",
    ".woff",
    ".woff2",
    ".ttf",
    ".png",
    ".jpg",
    ".svg",
  ];

  const networkFirst = ["/api/", "/auth/", "/socket"];

  const reqUrl = event.request.url;
  const useCache = cacheFirst.some((pattern) => reqUrl.includes(pattern));
  const useNetwork = networkFirst.some((pattern) => reqUrl.includes(pattern));

  // CACHE FIRST - za statičke resurse (brže!)
  if (useCache) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached; // Odmah vrati iz cache-a
        // Ako nema u cache-u, dohvati s mreže i keširaj
        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        });
      }),
    );
    return;
  }

  // NETWORK FIRST - za dynamic content
  if (useNetwork) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Default: Network First
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
```

**Benefit:** 🔥 **3-5x brže učitavanje** statičkih resursa

---

## 2. DOM Optimizacije

### ⚡ DocumentFragment za batch updates

**Trenutno stanje:** Svaki element se dodaje pojedinačno (`appendChild`)
**Problem:** Svaki `appendChild` izaziva reflow/repaint

**Optimizacija:**

```javascript
// Primjer: renderiranje liste povijesti
function renderHistory(items) {
  const container = document.getElementById("historyList");
  const fragment = document.createDocumentFragment(); // ✅ Batch update

  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <img src="${item.favicon}" onerror="this.src='data:image/svg+xml,...'">
      <span>${item.title}</span>
      <time>${formatTime(item.timestamp)}</time>
    `;
    fragment.appendChild(div); // Dodaj u fragment, ne u DOM
  });

  container.innerHTML = ""; // Jednom obriši
  container.appendChild(fragment); // Jednom dodaj sve
}
```

**Benefit:** 🔥 **2-3x brže** renderiranje velikih listi

### ⚡ `insertAdjacentHTML` umjesto `innerHTML`

```javascript
// ❌ Sporo - reparse cijelog DOM-a
container.innerHTML += "<div>New item</div>";

// ✅ Brzo - samo append
container.insertAdjacentHTML("beforeend", "<div>New item</div>");
```

---

## 3. Lazy Loading & Code Splitting

### ⚡ Dynamic imports za module

**Optimizacija:**

```javascript
// src/index.html - lazy load AI module

// ❌ Trenutno - učitava se odmah
// if (window.etherx?.ai) { ... }

// ✅ Optimizirano - učitaj samo kad treba
let aiModule = null;

async function loadAI() {
  if (!aiModule) {
    aiModule = await import("./main/ai.js");
  }
  return aiModule;
}

// Korištenje
document.getElementById("btnAiSummary").addEventListener("click", async () => {
  const ai = await loadAI(); // Učitaj tek sad
  const summary = await ai.summarizePage(url);
  displaySummary(summary);
});
```

### ⚡ Intersection Observer za lazy loading slika

```javascript
// Lazy load favicons u history/bookmarks
const imageObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src; // Učitaj sliku
        imageObserver.unobserve(img); // Stop observing
      }
    });
  },
  { rootMargin: "50px" },
); // Preload 50px prije

// Korištenje
document.querySelectorAll("img[data-src]").forEach((img) => {
  imageObserver.observe(img);
});
```

**HTML:**

```html
<img data-src="favicon.png" src="data:image/svg+xml,..." alt="Loading" />
```

---

## 4. Virtual Scrolling

### ⚡ Renderiranje samo vidljivih elemenata

**Problem:** 10,000 history items = 10,000 DOM elemenata = SPORO

**Optimizacija:**

```javascript
class VirtualScroller {
  constructor(container, items, rowHeight = 40) {
    this.container = container;
    this.items = items;
    this.rowHeight = rowHeight;
    this.visibleCount = Math.ceil(container.clientHeight / rowHeight) + 2; // +buffer
    this.startIndex = 0;

    this.container.style.position = "relative";
    this.container.style.overflow = "auto";
    this.container.style.height = `${container.clientHeight}px`;

    // Phantom div za scroll visinu
    this.phantom = document.createElement("div");
    this.phantom.style.height = `${items.length * rowHeight}px`;
    this.phantom.style.position = "absolute";
    this.phantom.style.width = "1px";
    this.container.appendChild(this.phantom);

    this.content = document.createElement("div");
    this.content.style.position = "absolute";
    this.content.style.top = "0";
    this.content.style.left = "0";
    this.content.style.right = "0";
    this.container.appendChild(this.content);

    this.container.addEventListener("scroll", () => this.render());
    this.render();
  }

  render() {
    const scrollTop = this.container.scrollTop;
    this.startIndex = Math.floor(scrollTop / this.rowHeight);
    const endIndex = Math.min(
      this.startIndex + this.visibleCount,
      this.items.length,
    );

    const visibleItems = this.items.slice(this.startIndex, endIndex);

    this.content.style.transform = `translateY(${this.startIndex * this.rowHeight}px)`;
    this.content.innerHTML = visibleItems
      .map(
        (item, i) => `
      <div class="history-item" style="height:${this.rowHeight}px">
        <img src="${item.favicon}">
        <span>${item.title}</span>
      </div>
    `,
      )
      .join("");
  }
}

// Korištenje
const scroller = new VirtualScroller(
  document.getElementById("historyList"),
  historyItems,
  40, // visina reda
);
```

**Benefit:** 🔥 **10-50x brže** za velike liste (1000+ items)

---

## 5. Web Workers

### ⚡ CPU-intenzivne operacije u background thread

**Optimizacija:**

```javascript
// worker.js - novi file
self.addEventListener("message", (e) => {
  const { action, data } = e.data;

  switch (action) {
    case "filter-history":
      const filtered = data.items.filter(
        (item) =>
          item.title.toLowerCase().includes(data.query.toLowerCase()) ||
          item.url.toLowerCase().includes(data.query.toLowerCase()),
      );
      self.postMessage({ action: "filter-result", data: filtered });
      break;

    case "parse-bookmarks":
      // Complex parsing logic
      const parsed = parseBookmarksHtml(data.html);
      self.postMessage({ action: "parse-result", data: parsed });
      break;
  }
});

// main thread
const worker = new Worker("worker.js");

worker.addEventListener("message", (e) => {
  const { action, data } = e.data;
  if (action === "filter-result") {
    renderHistory(data);
  }
});

// Korištenje
function filterHistory(query) {
  showLoading();
  worker.postMessage({
    action: "filter-history",
    data: { items: allHistory, query },
  });
}
```

**Benefit:** 🔥 UI thread ostaje responsive

---

## 6. Resource Hints

### ⚡ Preload, Prefetch, Preconnect

**Dodaj u `<head>` u src/index.html:**

```html
<!-- Preload kritične resurse -->
<link rel="preload" href="/assets/ethers.umd.min.js" as="script" />
<link rel="preload" href="/assets/filters/filters.txt" as="fetch" crossorigin />

<!-- Preconnect za vanjske domene -->
<link rel="preconnect" href="https://wallet.kriptoentuzijasti.io" />
<link rel="dns-prefetch" href="https://bobiai.kriptoentuzijasti.io" />

<!-- Prefetch za vjerojatne sljedeće stranice -->
<link rel="prefetch" href="/src/renderer/settings.html" />
```

---

## 7. Memory Management

### ⚡ Cleanup event listeners

```javascript
const listeners = new WeakMap();

function addManagedListener(element, event, handler) {
  element.addEventListener(event, handler);

  if (!listeners.has(element)) {
    listeners.set(element, []);
  }
  listeners.get(element).push({ event, handler });
}

function cleanupElement(element) {
  const elementListeners = listeners.get(element);
  if (elementListeners) {
    elementListeners.forEach(({ event, handler }) => {
      element.removeEventListener(event, handler);
    });
    listeners.delete(element);
  }
}

// Korištenje quando se briše tab
function closeTab(tabId) {
  const webview = document.getElementById(`webview-${tabId}`);
  cleanupElement(webview); // ✅ Očisti memory
  webview.remove();
}
```

### ⚡ WeakMap za cache umjesto Object

```javascript
// ❌ Memory leak - nikad se ne briše
const _summaryCache = {};

// ✅ Automatski garbage collection
const _summaryCache = new WeakMap();
const urlObjects = new Map(); // url string -> URL object

function cacheSummary(url, summary) {
  const urlObj = new URL(url);
  urlObjects.set(url, urlObj);
  _summaryCache.set(urlObj, summary);
}
```

---

## 8. Database Optimizacije

### ⚡ Batch inserts

```javascript
// ❌ Sporo - 1000 pojedinačnih inserta
history.forEach((item) => {
  db.prepare("INSERT INTO history ...").run(item);
});

// ✅ Brzo - transaction batch
const insertMany = db.transaction((items) => {
  const stmt = db.prepare("INSERT INTO history (url, title) VALUES (?, ?)");
  items.forEach((item) => stmt.run(item.url, item.title));
});

insertMany(historyItems); // Atomic batch
```

### ⚡ Indices za brže upite

```sql
-- Dodaj u database.js migration
CREATE INDEX IF NOT EXISTS idx_history_title ON history(title);
CREATE INDEX IF NOT EXISTS idx_bookmarks_title ON bookmarks(title);
CREATE INDEX IF NOT EXISTS idx_tabs_active ON tabs(is_active);
```

---

## 9. Event Handling Optimizacije

### ⚡ Request Animation Frame za smooth scroll

```javascript
// ❌ Trenutno - setTimeout
setTimeout(() => element.scrollIntoView(), 100);

// ✅ Optimizirano - requestAnimationFrame
requestAnimationFrame(() => {
  element.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
```

### ⚡ Debounce i Throttle gdje fali

```javascript
// Helper functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// Korištenje
window.addEventListener(
  "resize",
  throttle(() => {
    resizeWebviews();
  }, 100),
);

searchInput.addEventListener(
  "input",
  debounce((e) => {
    performSearch(e.target.value);
  }, 300),
);
```

---

## 10. Rendering Optimizacije

### ⚡ CSS containment

```css
/* Dodaj u browser.css */
.tab-item {
  contain: layout style paint; /* Izolira rendering */
}

.webview-container {
  contain: strict; /* Maksimalna izolacija */
  content-visibility: auto; /* Auto show/hide */
}

.history-item {
  contain: layout style;
  content-visibility: auto;
}
```

### ⚡ will-change za animacije

```css
.loading-bar {
  will-change: width, opacity;
}

.tab-item:hover {
  will-change: background-color;
}
```

---

## 📊 Očekivani rezultati

| Optimizacija               | Ubrzanje        | Prioritet |
| -------------------------- | --------------- | --------- |
| Service Worker Cache First | 3-5x            | 🔥 HIGH   |
| Virtual Scrolling          | 10-50x          | 🔥 HIGH   |
| DocumentFragment           | 2-3x            | 🟡 MEDIUM |
| Lazy Loading Modules       | 2x initial load | 🔥 HIGH   |
| Web Workers                | Smooth UI       | 🟡 MEDIUM |
| Database Batch             | 5-10x           | 🔥 HIGH   |
| Event Throttle/Debounce    | Smoother        | 🟡 MEDIUM |
| Resource Hints             | 1.5-2x          | 🟢 LOW    |
| Memory Cleanup             | Memory leak fix | 🔥 HIGH   |
| CSS Containment            | Repaint speedup | 🟢 LOW    |

---

## 🎯 Implementacijski redoslijed

1. **Service Worker** - najbrži ROI
2. **Virtual Scrolling** - za history/bookmarks
3. **Database batch inserts** - za brzo spremanje
4. **Lazy loading** - za AI i druge module
5. **DocumentFragment** - zamijeniti sve `innerHTML` loops
6. **Web Workers** - za search/filter
7. **Memory cleanup** - WeakMap i removeEventListener
8. **CSS optimizacije** - containment i will-change
9. **Resource hints** - preload/prefetch
10. **Event handling** - dodati throttle/debounce gdje fali

---

## 🔧 Testiranje performansi

```javascript
// Dodaj u DevTools konzolu
performance.mark("start");
// ... tvoj kod ...
performance.mark("end");
performance.measure("operation", "start", "end");
console.table(performance.getEntriesByType("measure"));
```

**Chrome DevTools Performance tab:**

- Inspect > Performance > Record
- Analiziraj Frame Rate (cilj: 60 FPS)
- Traži Long Tasks (> 50ms)

---

**Savjet:** Implementiraj optimizacije postepeno i testiraj svaku prije sljedeće! 🚀
