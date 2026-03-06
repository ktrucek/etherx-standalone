#!/bin/bash

################################################################################
# EtherX Browser - Quick Status Check
# Brza provera statusa development environmenta
################################################################################

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           EtherX Browser - Status Check                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check depot_tools
echo -n "depot_tools: "
if command -v gclient &> /dev/null; then
    echo -e "${GREEN}✓ Installed${NC} ($(gclient --version 2>&1 | head -n1))"
else
    echo -e "${RED}✗ Not found${NC}"
    echo "  → Run: ./scripts/phase1/02_environment_setup.sh"
fi

# Check Chromium source
echo -n "Chromium source: "
CHROMIUM_DOWNLOAD_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser"
if [[ -d "$CHROMIUM_DOWNLOAD_DIR/chromium/src" ]]; then
    SIZE=$(du -sh "$CHROMIUM_DOWNLOAD_DIR" 2>/dev/null | cut -f1 || echo "N/A")
    BRANCH=$(cd "$CHROMIUM_DOWNLOAD_DIR/chromium/src" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
    # Check if download is still in progress
    if ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; then
        echo -e "${YELLOW}⏳ Downloading${NC} ($SIZE, branch: $BRANCH)"
        echo "  → Download in progress..."
    else
        echo -e "${GREEN}✓ Downloaded${NC} ($SIZE, branch: $BRANCH)"
    fi
elif [[ -d "$HOME/chromium/src" ]]; then
    SIZE=$(du -sh "$HOME/chromium" 2>/dev/null | cut -f1)
    BRANCH=$(cd "$HOME/chromium/src" && git rev-parse --abbrev-ref HEAD 2>/dev/null)
    echo -e "${GREEN}✓ Downloaded${NC} ($SIZE, branch: $BRANCH)"
else
    echo -e "${RED}✗ Not found${NC}"
    echo "  → Run: ./scripts/phase1/03_chromium_download.sh"
fi

# Check Chromium build
echo -n "Chromium build: "
CHROMIUM_BUILD_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium/src/out/Default"
if [[ -f "$CHROMIUM_BUILD_DIR/content_shell" ]]; then
    SIZE=$(du -sh "$CHROMIUM_BUILD_DIR" 2>/dev/null | cut -f1)
    BINARY_SIZE=$(du -h "$CHROMIUM_BUILD_DIR/content_shell" 2>/dev/null | cut -f1)
    echo -e "${GREEN}✓ Built${NC} (Output: $SIZE, Binary: $BINARY_SIZE)"
elif [[ -d "$CHROMIUM_BUILD_DIR" ]]; then
    # Build directory exists - check if build is in progress
    if ps aux | grep ninja | grep -v grep > /dev/null; then
        OBJ_COUNT=$(find "$CHROMIUM_BUILD_DIR" -name "*.o" 2>/dev/null | wc -l)
        BUILD_SIZE=$(du -sh "$CHROMIUM_BUILD_DIR" 2>/dev/null | cut -f1)
        echo -e "${YELLOW}⏳ Building${NC} ($OBJ_COUNT objects, $BUILD_SIZE)"
        echo "  → Build in progress..."
    else
        echo -e "${YELLOW}○ Incomplete${NC}"
        echo "  → Run: ./scripts/phase1/04_chromium_build.sh"
    fi
elif [[ -f "$HOME/chromium/src/out/Default/content_shell" ]]; then
    SIZE=$(du -sh "$HOME/chromium/src/out/Default" 2>/dev/null | cut -f1)
    BINARY_SIZE=$(du -h "$HOME/chromium/src/out/Default/content_shell" 2>/dev/null | cut -f1)
    echo -e "${GREEN}✓ Built${NC} (Output: $SIZE, Binary: $BINARY_SIZE)"
else
    echo -e "${RED}✗ Not built${NC}"
    echo "  → Run: ./scripts/phase1/04_chromium_build.sh"
fi

# Check system resources
echo ""
echo "System Resources:"
echo "  CPU Cores: $(nproc 2>/dev/null || sysctl -n hw.ncpu)"
echo "  RAM: $(free -h 2>/dev/null | awk '/^Mem:/{print $2}' || sysctl -n hw.memsize | awk '{print int($1/1024/1024/1024)"GB"}')"
echo "  Disk Free: $(df -h "$HOME" | awk 'NR==2 {print $4}')"

# Check phases
echo ""
echo "Phases Completed:"
for i in {1..6}; do
    if [[ -f ".phase${i}_complete" ]]; then
        echo -e "  Phase $i: ${GREEN}✓ Complete${NC}"
    else
        echo -e "  Phase $i: ${YELLOW}○ TODO${NC}"
    fi
done

echo ""
echo "Quick Commands:"
echo "  ./etherx_build.sh              - Master build script"
echo "  ./run_content_shell.sh         - Run Chromium content_shell"
echo ""
echo "Download Monitoring:"
echo "  ./quick_size_check.sh          - Check download size"
echo "  ./analyze_download_progress.sh - Analyze repos downloaded"
echo "  ./repo_download_tracker.sh     - Track repositories progress"
echo "  ./size_monitor.sh              - Monitor size in real-time"
echo "  ./advanced_size_monitor.sh     - Advanced size monitor with progress"
echo "  ./wait_for_completion.sh       - Wait for download completion"
echo ""
echo "Logs & Debug:"
echo "  less logs/*.log                - View logs"
echo "  ./etherx_build.sh → Option 20  - Detailed status"

echo ""
