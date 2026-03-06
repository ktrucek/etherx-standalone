#!/bin/bash

# Simple file size monitor
CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser"

echo "📊 Praćenje veličine Chromium direktorijuma"
echo "📁 Lokacija: $CHROMIUM_DIR"
echo "⏰ Startovano: $(date)"
echo ""

while true; do
    if [[ -d "$CHROMIUM_DIR" ]]; then
        SIZE=$(du -sh "$CHROMIUM_DIR" 2>/dev/null | cut -f1)
        DISK_FREE=$(df -h /var/www/vhosts/kriptoentuzijasti.io | awk 'NR==2 {print $4}')
        echo "$(date '+%H:%M:%S') - Veličina: $SIZE | Slobodan prostor: $DISK_FREE"
    else
        echo "$(date '+%H:%M:%S') - Direktorijum ne postoji!"
    fi
    sleep 10
done
