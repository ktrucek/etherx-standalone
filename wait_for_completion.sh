#!/bin/bash

# Simple completion detector
echo "🔍 Waiting for Chromium download to complete..."
echo "⏰ Started monitoring at: $(date)"

while ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; do
    SIZE=$(du -sh /var/www/vhosts/kriptoentuzijasti.io/etherx_browser 2>/dev/null | cut -f1)
    echo "📊 $(date '+%H:%M:%S') - Still downloading... Size: $SIZE"
    sleep 30
done

echo ""
echo "🎉 DOWNLOAD COMPLETED! 🎉"
echo "⏰ Finished at: $(date)"
echo "📁 Final size: $(du -sh /var/www/vhosts/kriptoentuzijasti.io/etherx_browser 2>/dev/null | cut -f1)"
echo ""
echo "🔥 Ready for Phase 1.4 - Chromium Build!"
echo "👉 Run: ./scripts/phase1/04_chromium_build.sh"

# Beep to notify completion
for i in {1..3}; do
    echo -e "\a"
    sleep 0.5
done
