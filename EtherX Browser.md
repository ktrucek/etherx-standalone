# EtherX Browser - Kompletni vodič za upravljanje i deployment

## 📋 Pregled projekta

EtherX Browser je moderna, privacy-fokusirana web aplikacija koja omogućava korisnicima preuzimanje najnovije verzije EtherX Browser-a za različite platforme. Sistem uključuje naprednu funkcionalnost za upravljanje verzijama, download tracking, i automatizovani deployment proces.

## 🌐 Live URLs

- **Glavna stranica**: https://etherx.io/browser.html
- **Admin panel**: https://etherx.io/download_stats.php
- **API endpoint**: https://etherx.io/api/update_version.php
- **Download tracking**: https://etherx.io/track_download.php

## 🏗️ Arhitektura sistema

### Frontend komponente
- **browser.html** - Glavna showcase stranica sa animacijama i interaktivnim elementima
- **CSS animacije** - Floating particles, smooth scroll, hover effects
- **JavaScript funkcionalnosti** - Download tracking, FAQ accordion, lightbox galerija

### Backend komponente
- **PHP tracking sistem** - Logiranje download statistika u JSON format
- **Version management** - Automatsko ažuriranje linkova i verzija
- **REST API** - Remote deployment i upravljanje

### Database/Storage
- **JSON fajlovi** - Konfiguracija, logovi, statistike
- **File-based storage** - Backup sistem, version history

## 📁 Struktura fajlova

```
etherx.io/
├── public_html/
│   ├── browser.html                    # Glavna showcase stranica
│   ├── browser_config.json             # Konfiguracija verzija i linkova
│   ├── download_stats.php              # Admin panel sa statistics
│   ├── track_download.php              # API za tracking downloada
│   ├── update_version.sh               # Lokalna skripta za ažuriranje
│   ├── version_updates.log             # Log svih version promjena
│   ├── api/
│   │   └── update_version.php          # REST API za remote updates
│   └── browser_podaci/                 # Media fajlovi i logovi
│       ├── logo_novi.png               # EtherX logo
│       ├── screenshots/                # Browser screenshots
│       ├── videos/                     # Demo videos
│       ├── download_summary.json       # Agregirana statistika
│       └── downloads_[date].json       # Dnevni download logovi
├── deploy_browser_update.sh            # Script za remote deployment
├── test_api.sh                         # API test skripta
├── VERSION_MANAGEMENT.md               # Dokumentacija za version management
└── ETHERX_BROWSER_COMPLETE_GUIDE.md    # Ovaj fajl
```

## 🎨 Design i UI/UX funkcionalnosti

### Vizualni elementi
- **Gradient pozadina** - `linear-gradient(135deg, #1a1d3f 0%, #2d3561 50%, #3f4785 100%)`
- **Glassmorphism efekti** - `backdrop-filter: blur(10px)`
- **Floating particles** - 30 animiranih čestica koje se kreću kroz stranicu
- **Scroll progress bar** - Pokazuje progres čitanja stranice
- **Responsive design** - Mobile-first approach sa CSS Grid i Flexbox

### Interaktivni elementi
- **Animirani naslov** - Letter-by-letter animation za "EtherX Browser"
- **Lightbox galerija** - Click-to-expand screenshot pregled
- **FAQ accordion** - Smooth expand/collapse animacije
- **Hover effects** - Transform i box-shadow animacije
- **Social media buttons** - Custom styled sa brand colours

### Animacije i efekti
```css
/* Primjer particle animacije */
@keyframes float {
    0%, 100% {
        transform: translateY(0) translateX(0);
        opacity: 0;
    }
    10% { opacity: 1; }
    90% { opacity: 1; }
    100% {
        transform: translateY(-100vh) translateX(50px);
        opacity: 0;
    }
}

/* Smooth scroll implementacija */
html {
    scroll-behavior: smooth;
}
```

## 📊 Download tracking sistem

### Funkcionalnosti
- **Real-time tracking** - Svaki download se logira trenutno
- **Platform analytics** - Statistike po OS (Linux, Windows, macOS)
- **Geographic tracking** - Lokacija korisnika (IP-based)
- **Daily aggregation** - Dnevni summary fajlovi
- **Admin dashboard** - Vizuelni prikaz statistika

### API endpoints

#### POST /track_download.php
```json
{
    "platform": "linux-appimage",
    "timestamp": "2026-03-10T15:30:00Z",
    "userAgent": "Mozilla/5.0...",
    "referrer": "https://google.com",
    "ip": "192.168.1.1"
}
```

**Response:**
```json
{
    "success": true,
    "message": "Download tracked successfully"
}
```

### Statistike koje se prikupljaju
- **Ukupan broj downloada**
- **Downloads po platformi** (Linux AppImage, .deb, Windows .exe/.zip, macOS Intel/ARM)
- **Downloads po zemlji** (GeoIP lookup)
- **Dnevni trend** (zadnjih 7 dana)
- **Top referrers** (odakle korisnici dolaze)

## 🚀 Version management sistem

### 1. Web Admin Panel

**URL**: `https://etherx.io/download_stats.php`

**Funkcionalnosti**:
- Pregled trenutne verzije
- One-click ažuriranje na novu verziju
- Download statistike i analytics
- Version history log
- Real-time refresh opcija

**Kako koristiti**:
1. Otiđi na admin panel
2. Unesi novu verziju (format: `x.y.z`)
3. Klikni "Update Version"
4. Sistem automatski ažurira sve fajlove

### 2. REST API za remote deployment

**Endpoint**: `https://etherx.io/api/update_version.php`

**Autentifikacija**: API key (`etherx_update_key_2026`)

**Request format**:
```bash
curl -X POST https://etherx.io/api/update_version.php \
  -H "Content-Type: application/json" \
  -d '{
    "version": "2.4.36",
    "api_key": "etherx_update_key_2026"
  }'
```

**Success response**:
```json
{
    "success": true,
    "message": "Successfully updated from v2.4.35 to v2.4.36",
    "old_version": "2.4.35",
    "new_version": "2.4.36",
    "updated_at": "2026-03-10 15:30:00",
    "files_updated": {
        "config": "/path/to/browser_config.json",
        "html": "/path/to/browser.html"
    }
}
```

### 3. Deployment skripte

#### Local deployment (`update_version.sh`)
```bash
cd /home/ktrucek/web/etherx.io/public_html/
./update_version.sh 2.4.36
```

#### Remote deployment (`deploy_browser_update.sh`)
```bash
# Sa build servera
./deploy_browser_update.sh 2.4.36

# Specificirati server URL
./deploy_browser_update.sh 2.4.36 https://etherx.io
```

## 🔧 Setup i instalacija

### 1. Početni setup

```bash
# Kloniraj ili kopiraj fajlove na server
cd /home/ktrucek/web/etherx.io/public_html/

# Postavi dozvole
chmod 664 browser.html
chmod 664 browser_config.json
chmod 755 update_version.sh

# Kreiraj potrebne direktorijume
mkdir -p browser_podaci
mkdir -p api

# Postavi dozvole za web server
chown -R www-data:www-data browser_podaci/
chmod 755 browser_podaci/
```

### 2. Konfiguracija web servera (Nginx)

```nginx
server {
    listen 80;
    server_name etherx.io;
    root /home/ktrucek/web/etherx.io/public_html;
    index index.html index.php;

    # PHP podrška
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.1-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # Static fajlovi sa cachingom
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API endpoints
    location /api/ {
        try_files $uri $uri/ =404;
    }

    # JSON fajlovi
    location ~* \.json$ {
        add_header Content-Type application/json;
    }
}
```

### 3. PHP konfiguracija

**Potrebne PHP ekstenzije**:
- `json` - Za JSON manipulation
- `curl` - Za HTTP requests
- `gd` ili `imagick` - Za image processing (optional)

**php.ini postavke**:
```ini
file_uploads = On
upload_max_filesize = 10M
post_max_size = 10M
max_execution_time = 30
memory_limit = 128M
```

## 🔐 Sigurnost

### 1. API Key management

**Promijeni default API key**:

U `/public_html/api/update_version.php`:
```php
$validApiKey = 'your_secure_random_key_here';
```

U deployment skripta:
```bash
API_KEY="your_secure_random_key_here"
```

### 2. Sigurnosne mjere

- **HTTPS only** - Svi API pozivi preko HTTPS-a
- **Input validation** - Provjera formata verzije
- **IP logging** - Sve promjene se logiraju sa IP adresom
- **File permissions** - Restricted write access
- **Backup sistem** - Automatski backup prije promjena

### 3. Firewall i access control

```bash
# UFW firewall rules
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
```

## 🧪 Testing i debugging

### 1. API testing

```bash
# Test valid request
./test_api.sh 2.4.36

# Manual curl test
curl -X POST https://etherx.io/api/update_version.php \
  -H "Content-Type: application/json" \
  -d '{"version": "2.4.36", "api_key": "etherx_update_key_2026"}'
```

### 2. Local testing

```bash
# Test local script
./update_version.sh 2.4.36

# Check version in config
cat browser_config.json | jq '.version'

# Check HTML file
grep "Version" browser.html
```

### 3. Download tracking test

```javascript
// Browser console test
fetch('/track_download.php', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        platform: 'test-platform',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        referrer: document.referrer || 'direct'
    })
}).then(response => response.json())
  .then(data => console.log(data));
```

## 📈 Monitoring i analytics

### 1. Log fajlovi

**Version updates** (`version_updates.log`):
```
2026-03-10 15:30:00 - Updated from v2.4.35 to v2.4.36 via web admin
2026-03-10 16:00:00 - Updated from v2.4.36 to v2.4.37 via API (IP: 192.168.1.100)
```

**Download logs** (`browser_podaci/downloads_YYYY-MM-DD.json`):
```json
{"platform":"linux-appimage","timestamp":"2026-03-10T15:30:00Z","ip":"192.168.1.1","country":"Bosnia and Herzegovina"}
{"platform":"windows-exe","timestamp":"2026-03-10T15:31:00Z","ip":"192.168.1.2","country":"Croatia"}
```

### 2. Performance monitoring

```bash
# Disk usage
du -sh /home/ktrucek/web/etherx.io/public_html/browser_podaci/

# Log rotation
find browser_podaci/ -name "downloads_*.json" -mtime +30 -delete

# Web server stats
tail -f /var/log/nginx/access.log | grep browser.html
```

### 3. Analytics dashboard

Admin panel (`download_stats.php`) pokazuje:
- **Total downloads** sa trend grafom
- **Platform breakdown** sa percentage chart
- **Geographic distribution** - top 10 zemalja
- **Recent activity** - zadnjih 7 dana
- **Referrer tracking** - top traffic sources

## 🔄 CI/CD Integration

### 1. GitHub Actions

```yaml
name: Deploy EtherX Browser Update

on:
  release:
    types: [published]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Extract version
        id: version
        run: echo "VERSION=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT
        
      - name: Update website
        run: |
          curl -X POST https://etherx.io/api/update_version.php \
            -H "Content-Type: application/json" \
            -d '{
              "version": "${{ steps.version.outputs.VERSION }}",
              "api_key": "${{ secrets.ETHERX_API_KEY }}"
            }'
```

### 2. Jenkins pipeline

```groovy
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                // Build aplikacije
                sh 'make build'
            }
        }
        stage('Release') {
            steps {
                // GitHub release
                sh './create_github_release.sh ${BUILD_NUMBER}'
            }
        }
        stage('Deploy Website') {
            steps {
                sh './deploy_browser_update.sh ${BUILD_VERSION}'
            }
        }
    }
}
```

### 3. Manual deployment workflow

```bash
# 1. Build nova verzija
make build VERSION=2.4.36

# 2. Kreiraj GitHub release
gh release create v2.4.36 --title "EtherX Browser v2.4.36" --notes "Release notes..."

# 3. Upload artifacts
gh release upload v2.4.36 dist/*

# 4. Update website
./deploy_browser_update.sh 2.4.36

# 5. Verify deployment
curl -s https://etherx.io/browser.html | grep "Version 2.4.36"
```

## 🛠️ Maintenance i troubleshooting

### 1. Česti problemi

**Problem**: API vraća 500 error
```bash
# Provjeri dozvole
ls -la browser.html browser_config.json

# Provjeri PHP errors
tail -f /var/log/nginx/error.log
```

**Problem**: Verzija se ne ažurira na stranici
```bash
# Provjeri cache headers
curl -I https://etherx.io/browser.html

# Očisti OPcache
php -r "opcache_reset();"

# Force refresh sa cache busting
curl "https://etherx.io/browser.html?v=$(date +%s)"
```

**Problem**: Download tracking ne radi
```bash
# Provjeri dozvole na browser_podaci
ls -la browser_podaci/

# Test API direktno
curl -X POST https://etherx.io/track_download.php \
  -H "Content-Type: application/json" \
  -d '{"platform":"test","timestamp":"2026-03-10T15:30:00Z"}'
```

### 2. Backup i recovery

**Kreiraj backup**:
```bash
# Backup svih važnih fajlova
tar -czf etherx-backup-$(date +%Y%m%d).tar.gz \
  browser.html \
  browser_config.json \
  download_stats.php \
  api/ \
  browser_podaci/

# Upload na remote storage
scp etherx-backup-*.tar.gz user@backup-server:/backups/
```

**Restore iz backupa**:
```bash
# Extract backup
tar -xzf etherx-backup-20260310.tar.gz

# Restore fajlove
cp -r * /home/ktrucek/web/etherx.io/public_html/

# Postavi dozvole
chown -R www-data:www-data browser_podaci/
chmod 755 browser_podaci/
```

### 3. Performance optimizacija

**Nginx caching**:
```nginx
location / {
    # Cache static content
    expires 1h;
    add_header Cache-Control "public, no-transform";
}

location /api/ {
    # No cache za API
    expires -1;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

**PHP optimizacija**:
```ini
; OPcache settings
opcache.enable=1
opcache.memory_consumption=128
opcache.interned_strings_buffer=8
opcache.max_accelerated_files=4000
opcache.revalidate_freq=2
```

## 📚 Dodatni resursi

### 1. Korisni komande

```bash
# Provjeri status stranice
curl -s -o /dev/null -w "%{http_code}" https://etherx.io/browser.html

# Count total downloads
find browser_podaci/ -name "downloads_*.json" -exec wc -l {} + | tail -1

# Real-time log monitoring
tail -f browser_podaci/downloads_$(date +%Y-%m-%d).json | jq .

# Check version consistency
echo "Config: $(cat browser_config.json | jq -r '.version')"
echo "HTML: $(grep -o 'Version [0-9.]*' browser.html)"
```

### 2. Monitoring skripte

**Health check skripta**:
```bash
#!/bin/bash
# health_check.sh

URL="https://etherx.io/browser.html"
EXPECTED_VERSION="2.4.35"

# Check HTTP status
STATUS=$(curl -s -o /dev/null -w "%{http_code}" $URL)
if [ "$STATUS" != "200" ]; then
    echo "ERROR: Website returned $STATUS"
    exit 1
fi

# Check version
CURRENT=$(curl -s $URL | grep -o 'Version [0-9.]*' | cut -d' ' -f2)
if [ "$CURRENT" != "$EXPECTED_VERSION" ]; then
    echo "WARNING: Version mismatch. Expected: $EXPECTED_VERSION, Found: $CURRENT"
fi

echo "OK: Website is healthy"
```

### 3. Database migracije (za buduće proširenje)

```sql
-- Ako u budućnosti prebacite na SQL database
CREATE TABLE downloads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    platform VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    country VARCHAR(100),
    user_agent TEXT,
    referrer VARCHAR(500)
);

CREATE TABLE versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(20),
    release_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100),
    update_method ENUM('web', 'api', 'script')
);
```

## 🎯 Budući development

### 1. Planirana proširenja

- **User accounts** - Registracija i login sistem
- **Download dashboard** - Personalizirani user dashboard
- **Beta releases** - Podrška za beta/alpha verzije
- **Auto-updater** - Automatic browser updates
- **Mobile app** - Android/iOS companion app

### 2. Tehnička poboljšanja

- **Database migration** - Sa JSON na PostgreSQL/MySQL
- **CDN integration** - CloudFlare ili AWS CloudFront
- **Microservices** - Razdvojiti API na microservice
- **Docker containerization** - Containerized deployment
- **Load balancing** - Multi-server setup

### 3. Analytics enhancements

- **Google Analytics** integration
- **Real-time dashboard** - WebSocket updates
- **A/B testing** - Landing page optimization
- **Conversion tracking** - Download-to-install rate
- **User behavior** - Heatmaps i session recordings

---

**Kontakt informacije**:
- **Website**: https://etherx.io
- **Admin panel**: https://etherx.io/download_stats.php  
- **Developer**: kriptoentuzijasti.com
- **Version**: 2.4.35
- **Last updated**: March 10, 2026

---

*Ovaj dokument se redovno ažurira. Za najnovije informacije, provjerite GitHub repository ili admin panel.*