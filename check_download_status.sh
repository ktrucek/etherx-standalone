#!/bin/bash

################################################################################
# EtherX Browser - Download Status Checker
# Proverava da li je download završen, u toku, ili stao
################################################################################

CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"
LOG_FILE="/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/logs/phase1_03_chromium_download.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║              EtherX Browser - Download Status Checker             ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# 1. Check if gclient is running
echo -e "${BLUE}1. Checking active processes...${NC}"
if ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; then
    echo -e "${GREEN}   ✓ gclient sync is RUNNING${NC}"
    GCLIENT_RUNNING=true
else
    echo -e "${RED}   ✗ gclient sync is NOT running${NC}"
    GCLIENT_RUNNING=false
fi

if ps aux | grep -E "python.*gclient" | grep -v grep > /dev/null; then
    echo -e "${GREEN}   ✓ Python gclient process found${NC}"
fi

GIT_PROCS=$(ps aux | grep -E "git.*(clone|fetch|index-pack)" | grep -v grep | wc -l)
if [[ $GIT_PROCS -gt 0 ]]; then
    echo -e "${GREEN}   ✓ $GIT_PROCS Git operations active${NC}"
else
    echo -e "${YELLOW}   ○ No active git operations${NC}"
fi

# 2. Check repository count
echo ""
echo -e "${BLUE}2. Checking repository count...${NC}"
if [[ -d "$CHROMIUM_DIR" ]]; then
    cd "$CHROMIUM_DIR"
    REPO_COUNT=$(find . -name ".git" -type d 2>/dev/null | wc -l)
    echo -e "${CYAN}   Found: $REPO_COUNT repositories${NC}"
    
    if [[ $REPO_COUNT -ge 227 ]]; then
        echo -e "${GREEN}   ✓ Expected number of repos reached (227+)${NC}"
        REPOS_COMPLETE=true
    elif [[ $REPO_COUNT -ge 200 ]]; then
        echo -e "${YELLOW}   ⚠ Almost done ($REPO_COUNT/227)${NC}"
        REPOS_COMPLETE=false
    elif [[ $REPO_COUNT -ge 144 ]]; then
        echo -e "${YELLOW}   ⏳ In progress ($REPO_COUNT/227 = 63%)${NC}"
        REPOS_COMPLETE=false
    else
        echo -e "${RED}   ✗ Too few repos ($REPO_COUNT/227 = $(echo "scale=1; $REPO_COUNT*100/227" | bc)%)${NC}"
        REPOS_COMPLETE=false
    fi
else
    echo -e "${RED}   ✗ Chromium directory not found!${NC}"
    exit 1
fi

# 3. Check log file for completion or errors
echo ""
echo -e "${BLUE}3. Analyzing log file...${NC}"
if [[ -f "$LOG_FILE" ]]; then
    # Check last lines of log
    LAST_LINES=$(tail -n 20 "$LOG_FILE")
    
    if echo "$LAST_LINES" | grep -q "Hook '.* took"; then
        echo -e "${GREEN}   ✓ Hooks are running (final stage)${NC}"
        IN_FINAL_STAGE=true
    elif echo "$LAST_LINES" | grep -q "Synced"; then
        echo -e "${GREEN}   ✓ Sync appears complete${NC}"
        IN_FINAL_STAGE=true
    elif echo "$LAST_LINES" | grep -q "Downloading package archive"; then
        PKG_INFO=$(echo "$LAST_LINES" | grep "Downloading package archive" | tail -1)
        echo -e "${YELLOW}   ⏳ $PKG_INFO${NC}"
        IN_FINAL_STAGE=false
    elif echo "$LAST_LINES" | grep -q "Still working on"; then
        WORKING_ON=$(echo "$LAST_LINES" | grep "Still working on" | tail -1 | sed 's/.*Still working on://')
        echo -e "${YELLOW}   ⏳ Still working on:$WORKING_ON${NC}"
        IN_FINAL_STAGE=false
    elif echo "$LAST_LINES" | grep -q "ERROR"; then
        echo -e "${RED}   ✗ Errors detected in log${NC}"
        echo "$LAST_LINES" | grep "ERROR" | tail -3
        IN_FINAL_STAGE=false
    else
        echo -e "${CYAN}   ○ No clear status in recent log entries${NC}"
        IN_FINAL_STAGE=false
    fi
    
    # Check log modification time
    LOG_MOD_TIME=$(stat -c %Y "$LOG_FILE" 2>/dev/null)
    CURRENT_TIME=$(date +%s)
    TIME_DIFF=$((CURRENT_TIME - LOG_MOD_TIME))
    
    if [[ $TIME_DIFF -lt 60 ]]; then
        echo -e "${GREEN}   ✓ Log updated recently (${TIME_DIFF}s ago)${NC}"
        LOG_RECENT=true
    elif [[ $TIME_DIFF -lt 300 ]]; then
        echo -e "${YELLOW}   ⚠ Log last updated $((TIME_DIFF/60)) minutes ago${NC}"
        LOG_RECENT=false
    else
        echo -e "${RED}   ✗ Log hasn't been updated in $((TIME_DIFF/60)) minutes${NC}"
        LOG_RECENT=false
    fi
else
    echo -e "${RED}   ✗ Log file not found${NC}"
    LOG_RECENT=false
    IN_FINAL_STAGE=false
fi

# 4. Check for temp download directories
echo ""
echo -e "${BLUE}4. Checking temporary download directories...${NC}"
if [[ -d "$CHROMIUM_DIR" ]]; then
    TEMP_DIRS=$(find "$CHROMIUM_DIR" -name "_gclient_*" -type d 2>/dev/null | wc -l)
    if [[ $TEMP_DIRS -gt 0 ]]; then
        echo -e "${YELLOW}   ⏳ $TEMP_DIRS temporary download directories${NC}"
        find "$CHROMIUM_DIR" -name "_gclient_*" -type d 2>/dev/null | head -3 | while read dir; do
            echo -e "${CYAN}      → $(basename "$dir" | sed 's/_gclient_.*//')${NC}"
        done
    else
        echo -e "${GREEN}   ✓ No temporary directories (good sign)${NC}"
    fi
fi

# 5. Final determination
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}📊 FINAL STATUS:${NC}"
echo ""

if [[ $GCLIENT_RUNNING == true ]]; then
    echo -e "${GREEN}✅ DOWNLOAD IS ACTIVE${NC}"
    echo -e "${CYAN}   The download process is running normally.${NC}"
    echo -e "${CYAN}   Current progress: $REPO_COUNT/227 repositories ($(echo "scale=1; $REPO_COUNT*100/227" | bc)%)${NC}"
    echo ""
    echo -e "${YELLOW}💡 What to do:${NC}"
    echo -e "   • Wait for it to complete"
    echo -e "   • Monitor with: ${CYAN}./repo_download_tracker.sh${NC}"
    echo -e "   • Or check size: ${CYAN}./quick_size_check.sh${NC}"
    
elif [[ $REPOS_COMPLETE == true ]] && [[ $LOG_RECENT == true ]]; then
    echo -e "${GREEN}🎉 DOWNLOAD IS COMPLETE!${NC}"
    echo -e "${CYAN}   All repositories have been downloaded.${NC}"
    echo -e "${CYAN}   Total size: $(du -sh "$CHROMIUM_DIR" 2>/dev/null | cut -f1)${NC}"
    echo ""
    echo -e "${YELLOW}🚀 Next step:${NC}"
    echo -e "   ${GREEN}./scripts/phase1/04_chromium_build.sh${NC}"
    
elif [[ $GCLIENT_RUNNING == false ]] && [[ $REPOS_COMPLETE == false ]]; then
    echo -e "${RED}⚠️ DOWNLOAD HAS STOPPED (INCOMPLETE)${NC}"
    echo -e "${CYAN}   Progress: $REPO_COUNT/227 repositories ($(echo "scale=1; $REPO_COUNT*100/227" | bc)%)${NC}"
    echo ""
    echo -e "${YELLOW}💡 What to do:${NC}"
    echo -e "   1. ${CYAN}Restart the download:${NC}"
    echo -e "      cd /var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"
    echo -e "      gclient sync --with_branch_heads --with_tags"
    echo ""
    echo -e "   2. ${CYAN}Or run the script again:${NC}"
    echo -e "      ./scripts/phase1/03_chromium_download.sh"
    echo ""
    echo -e "   3. ${CYAN}Check the log for errors:${NC}"
    echo -e "      tail -100 logs/phase1_03_chromium_download.log | less"
    
else
    echo -e "${YELLOW}⚠️ STATUS UNCLEAR${NC}"
    echo -e "${CYAN}   gclient running: $GCLIENT_RUNNING${NC}"
    echo -e "${CYAN}   repos complete: $REPOS_COMPLETE${NC}"
    echo -e "${CYAN}   log recent: $LOG_RECENT${NC}"
    echo ""
    echo -e "${YELLOW}💡 Recommended action:${NC}"
    echo -e "   Run: ${CYAN}./repo_download_tracker.sh${NC} to monitor in real-time"
fi

echo ""
echo "════════════════════════════════════════════════════════════════════"
