#!/bin/bash

################################################################################
# EtherX Browser - Download Progress Analyzer
# Analizira koliko je repository-ja preuzeto od ukupnog broja
################################################################################

CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"
MAIN_DEPS_FILE="$CHROMIUM_DIR/src/DEPS"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║              EtherX Browser - Download Progress Analyzer          ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

if [[ ! -d "$CHROMIUM_DIR" ]]; then
    echo -e "${RED}❌ Chromium directory not found: $CHROMIUM_DIR${NC}"
    exit 1
fi

cd "$CHROMIUM_DIR"

echo -e "${CYAN}📁 Analyzing directory:${NC} $CHROMIUM_DIR"
echo -e "${CYAN}⏰ Time:${NC} $(date)"
echo ""

# Count git repositories (successful clones)
echo -e "${BLUE}🔍 Counting Git repositories...${NC}"
GIT_REPOS=$(find . -name ".git" -type d 2>/dev/null | wc -l)
echo -e "${GREEN}✓ Found Git repositories:${NC} $GIT_REPOS"

# Count git directories being worked on
GIT_TEMP_DIRS=$(find . -name "_gclient_*" -type d 2>/dev/null | wc -l)
echo -e "${YELLOW}⏳ Temporary download directories:${NC} $GIT_TEMP_DIRS"

# Analyze DEPS file for total expected repositories
if [[ -f "$MAIN_DEPS_FILE" ]]; then
    echo ""
    echo -e "${BLUE}📋 Analyzing DEPS file...${NC}"
    
    # Count dependencies in DEPS file
    DEPS_COUNT=$(grep -c "^[ ]*['\"].*['\"][ ]*:" "$MAIN_DEPS_FILE" 2>/dev/null || echo "0")
    echo -e "${CYAN}📦 Dependencies in main DEPS:${NC} $DEPS_COUNT"
    
    # Look for git URLs
    GIT_URLS=$(grep -c "\.git" "$MAIN_DEPS_FILE" 2>/dev/null || echo "0")
    echo -e "${CYAN}🔗 Git URLs in DEPS:${NC} $GIT_URLS"
    
else
    echo -e "${YELLOW}⚠️ Main DEPS file not found${NC}"
fi

# Check if gclient is still running
echo ""
echo -e "${BLUE}🔄 Process Status:${NC}"
if ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; then
    GCLIENT_PROCESSES=$(ps aux | grep -E "gclient.*sync" | grep -v grep | wc -l)
    echo -e "${GREEN}✓ gclient sync active:${NC} $GCLIENT_PROCESSES process(es)"
    
    GIT_PROCESSES=$(ps aux | grep -E "git.*(clone|fetch)" | grep -v grep | wc -l)
    echo -e "${GREEN}✓ Git operations active:${NC} $GIT_PROCESSES process(es)"
else
    echo -e "${RED}✗ gclient sync not running${NC}"
fi

# Estimate progress
echo ""
echo -e "${BLUE}📊 Progress Estimation:${NC}"

# Rough estimate based on typical Chromium repo count (around 200-300 repos)
ESTIMATED_TOTAL=250
PROGRESS_PERCENT=$(echo "scale=1; $GIT_REPOS * 100 / $ESTIMATED_TOTAL" | bc -l 2>/dev/null || echo "N/A")

echo -e "${CYAN}📈 Estimated progress:${NC} $GIT_REPOS/$ESTIMATED_TOTAL repos (~$PROGRESS_PERCENT%)"

# Directory size analysis
echo ""
echo -e "${BLUE}💾 Size Analysis:${NC}"
TOTAL_SIZE=$(du -sh . 2>/dev/null | cut -f1)
echo -e "${CYAN}📁 Current size:${NC} $TOTAL_SIZE"

# Look at largest subdirectories
echo ""
echo -e "${BLUE}📂 Largest subdirectories:${NC}"
du -sh src/third_party/* 2>/dev/null | sort -hr | head -5 | while read size dir; do
    echo -e "${CYAN}  $size${NC} - $(basename "$dir")"
done

# Check recent activity
echo ""
echo -e "${BLUE}🕐 Recent Activity:${NC}"
RECENT_DIRS=$(find . -type d -name ".git" -newerct "5 minutes ago" 2>/dev/null | wc -l)
echo -e "${CYAN}📥 Repos updated in last 5 min:${NC} $RECENT_DIRS"

# Show some of the repositories being downloaded
echo ""
echo -e "${BLUE}🔄 Currently downloading:${NC}"
find . -name "_gclient_*" -type d 2>/dev/null | head -3 | while read temp_dir; do
    basename_dir=$(basename "$temp_dir" | sed 's/_gclient_.*//g')
    parent_dir=$(dirname "$temp_dir")
    echo -e "${YELLOW}  →${NC} $basename_dir (in $parent_dir)"
done

echo ""
echo "════════════════════════════════════════════════════════════════════"
