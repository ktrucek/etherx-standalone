#!/bin/bash

################################################################################
# EtherX Browser - Repository Download Tracker
# Jednostavan tracker koji broji repozitorijume i procenjuje progress
################################################################################

CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Typical Chromium repository counts based on documentation
EXPECTED_MAIN_REPOS=227  # From official Chromium DEPS analysis
EXPECTED_TOTAL_WITH_SUBMODULES=300  # Including all submodules

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║              EtherX Browser - Repository Download Tracker         ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

if [[ ! -d "$CHROMIUM_DIR" ]]; then
    echo -e "${RED}❌ Chromium directory not found!${NC}"
    exit 1
fi

cd "$CHROMIUM_DIR"

while true; do
    clear
    echo "╔════════════════════════════════════════════════════════════════════╗"
    echo "║              EtherX Browser - Repository Download Tracker         ║"
    echo "╚════════════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Current stats
    CURRENT_TIME=$(date '+%Y-%m-%d %H:%M:%S')
    CURRENT_REPOS=$(find . -name ".git" -type d 2>/dev/null | wc -l)
    CURRENT_SIZE=$(du -sh . 2>/dev/null | cut -f1)
    TEMP_DIRS=$(find . -name "_gclient_*" -type d 2>/dev/null | wc -l)
    
    echo -e "${CYAN}⏰ Time:${NC} $CURRENT_TIME"
    echo ""
    
    # Progress against expected counts
    PROGRESS_MAIN=$(echo "scale=1; $CURRENT_REPOS * 100 / $EXPECTED_MAIN_REPOS" | bc -l 2>/dev/null || echo "0")
    PROGRESS_TOTAL=$(echo "scale=1; $CURRENT_REPOS * 100 / $EXPECTED_TOTAL_WITH_SUBMODULES" | bc -l 2>/dev/null || echo "0")
    
    echo -e "${GREEN}📊 Repository Progress:${NC}"
    echo -e "${CYAN}  Downloaded:${NC} $CURRENT_REPOS repositories"
    echo -e "${CYAN}  vs Expected Main Repos:${NC} $CURRENT_REPOS/$EXPECTED_MAIN_REPOS (${PROGRESS_MAIN}%)"
    echo -e "${CYAN}  vs Total with Submodules:${NC} $CURRENT_REPOS/$EXPECTED_TOTAL_WITH_SUBMODULES (${PROGRESS_TOTAL}%)"
    
    # Progress bars
    echo ""
    echo -e "${PURPLE}Main Repos Progress:${NC}"
    BAR_WIDTH=50
    FILLED_MAIN=$(echo "scale=0; $PROGRESS_MAIN * $BAR_WIDTH / 100" | bc -l 2>/dev/null || echo "0")
    FILLED_MAIN=${FILLED_MAIN%.*}  # Remove decimal part
    printf "["
    for ((i=0; i<FILLED_MAIN && i<BAR_WIDTH; i++)); do printf "█"; done
    for ((i=FILLED_MAIN; i<BAR_WIDTH; i++)); do printf "░"; done
    printf "] %.1f%%\n" "$PROGRESS_MAIN"
    
    echo -e "${PURPLE}Total Estimated Progress:${NC}"
    FILLED_TOTAL=$(echo "scale=0; $PROGRESS_TOTAL * $BAR_WIDTH / 100" | bc -l 2>/dev/null || echo "0")
    FILLED_TOTAL=${FILLED_TOTAL%.*}  # Remove decimal part
    printf "["
    for ((i=0; i<FILLED_TOTAL && i<BAR_WIDTH; i++)); do printf "█"; done
    for ((i=FILLED_TOTAL; i<BAR_WIDTH; i++)); do printf "░"; done
    printf "] %.1f%%\n" "$PROGRESS_TOTAL"
    
    echo ""
    echo -e "${BLUE}💾 Download Info:${NC}"
    echo -e "${CYAN}  Current size:${NC} $CURRENT_SIZE"
    echo -e "${CYAN}  Active downloads:${NC} $TEMP_DIRS"
    
    # Process status
    echo ""
    if ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; then
        echo -e "${GREEN}🔄 Status: DOWNLOADING${NC}"
        
        # Recent activity check
        RECENT_REPOS=$(find . -name ".git" -type d -newerct "2 minutes ago" 2>/dev/null | wc -l)
        if [[ $RECENT_REPOS -gt 0 ]]; then
            echo -e "${GREEN}  ✓ Active: $RECENT_REPOS repos added in last 2 minutes${NC}"
        else
            echo -e "${YELLOW}  ⏳ Working on: Large repository or dependency resolution${NC}"
        fi
        
        # Show what might be downloading
        if [[ $TEMP_DIRS -gt 0 ]]; then
            echo -e "${CYAN}  📥 Temporary download folders: $TEMP_DIRS${NC}"
        fi
        
    else
        echo -e "${RED}⛔ Status: STOPPED${NC}"
        
        # Check if download might be complete
        if [[ $CURRENT_REPOS -ge $EXPECTED_MAIN_REPOS ]]; then
            echo -e "${GREEN}🎉 DOWNLOAD APPEARS COMPLETE! 🎉${NC}"
            echo -e "${GREEN}✅ Downloaded $CURRENT_REPOS repositories${NC}"
            echo -e "${CYAN}📁 Final size: $CURRENT_SIZE${NC}"
            echo ""
            echo -e "${YELLOW}🔥 Ready to proceed to Phase 1.4 - Chromium Build!${NC}"
            echo -e "${CYAN}👉 Run: ./scripts/phase1/04_chromium_build.sh${NC}"
            break
        else
            echo -e "${YELLOW}⚠️ Download seems incomplete (${CURRENT_REPOS}/${EXPECTED_MAIN_REPOS})${NC}"
            echo -e "${CYAN}💡 Try restarting: ./scripts/phase1/03_chromium_download.sh${NC}"
        fi
    fi
    
    # Large repos info
    echo ""
    echo -e "${BLUE}📂 Largest components:${NC}"
    du -sh src/third_party/* 2>/dev/null | sort -hr | head -3 | while read size dir; do
        echo -e "${CYAN}  $size${NC} - $(basename "$dir")"
    done 2>/dev/null || echo -e "${YELLOW}  (calculating...)${NC}"
    
    echo ""
    echo "════════════════════════════════════════════════════════════════════"
    echo "Press Ctrl+C to exit | Updating every 10 seconds"
    
    sleep 10
done
