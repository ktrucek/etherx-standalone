#!/bin/bash

# Quick size check
CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser"

echo "🔍 BRZA PROVERA VELIČINE"
echo "========================"
echo "📅 $(date)"
echo ""

if [[ -d "$CHROMIUM_DIR" ]]; then
    echo "📁 Chromium direktorijum:"
    du -sh "$CHROMIUM_DIR" 2>/dev/null
    echo ""
    
    echo "💾 Disk prostor:"
    df -h /var/www/vhosts/kriptoentuzijasti.io 2>/dev/null | head -2
    echo ""
    
    echo "🔄 Aktivni procesi:"
    ps aux | grep -E "(gclient|git)" | grep -v grep | wc -l | awk '{print $1 " git/gclient procesa"}'
    
else
    echo "❌ Direktorijum $CHROMIUM_DIR ne postoji!"
fi
