#!/bin/bash

# Wait for gclient to finish and report completion

echo "⏰ Waiting for gclient sync to complete..."
echo "Started: $(date)"
echo ""

while ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; do
    REPOS=$(find /var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium -name ".git" -type d 2>/dev/null | wc -l)
    SIZE=$(du -sh /var/www/vhosts/kriptoentuzijasti.io/etherx_browser 2>/dev/null | cut -f1)
    echo "$(date '+%H:%M:%S') - Repos: $REPOS, Size: $SIZE"
    sleep 15
done

echo ""
echo "✅ gclient sync has finished!"
echo "Completed: $(date)"
echo ""

# Final stats
FINAL_REPOS=$(find /var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium -name ".git" -type d 2>/dev/null | wc -l)
FINAL_SIZE=$(du -sh /var/www/vhosts/kriptoentuzijasti.io/etherx_browser 2>/dev/null | cut -f1)

echo "📊 Final Statistics:"
echo "   Repositories: $FINAL_REPOS"
echo "   Total Size: $FINAL_SIZE"
echo ""

# Check if complete
if [[ $FINAL_REPOS -ge 227 ]]; then
    echo "🎉 DOWNLOAD COMPLETE!"
    echo "✅ All repositories downloaded ($FINAL_REPOS/227)"
    echo ""
    echo "🚀 Ready for Phase 1.4 - Chromium Build"
    echo "   Run: cd /var/www/vhosts/kriptoentuzijasti.io/AI\ projekt/browser"
    echo "        ./scripts/phase1/04_chromium_build.sh"
elif [[ $FINAL_REPOS -ge 144 ]]; then
    echo "⚠️  Download may be incomplete"
    echo "   Current: $FINAL_REPOS/227 repositories ($(echo "scale=1; $FINAL_REPOS*100/227" | bc)%)"
    echo ""
    echo "💡 This might be sufficient for building. Try Phase 1.4 anyway."
    echo "   Or re-run: gclient sync --with_branch_heads --with_tags"
else
    echo "❌ Download appears incomplete"
    echo "   Only $FINAL_REPOS/227 repositories"
fi

echo ""
