#!/bin/bash

################################################################################
# EtherX Browser - Detailed Download Tracker
# Detaljno praćenje download progress-a sa procenjom preostanlog vremena
################################################################################

CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"
DEPS_FILE="$CHROMIUM_DIR/src/DEPS"
PROGRESS_FILE="/tmp/chromium_progress.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Function to get timestamp
timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

# Function to log progress
log_progress() {
    echo "$(timestamp) | Git repos: $1 | Size: $2" >> "$PROGRESS_FILE"
}

# Function to calculate ETA
calculate_eta() {
    local current_repos=$1
    local total_repos=$2
    
    if [[ -f "$PROGRESS_FILE" && $current_repos -gt 0 ]]; then
        local lines=$(wc -l < "$PROGRESS_FILE")
        if [[ $lines -gt 1 ]]; then
            local first_entry=$(head -n 1 "$PROGRESS_FILE")
            local last_entry=$(tail -n 1 "$PROGRESS_FILE")
            
            local first_time=$(echo "$first_entry" | cut -d'|' -f1 | xargs)
            local last_time=$(echo "$last_entry" | cut -d'|' -f1 | xargs)
            local first_repos=$(echo "$first_entry" | cut -d'|' -f2 | sed 's/[^0-9]//g')
            local last_repos=$(echo "$last_entry" | cut -d'|' -f2 | sed 's/[^0-9]//g')
            
            if [[ $last_repos -gt $first_repos ]]; then
                local time_diff=$(( $(date -d "$last_time" +%s) - $(date -d "$first_time" +%s) ))
                local repos_diff=$(( last_repos - first_repos ))
                local repos_remaining=$(( total_repos - current_repos ))
                
                if [[ $repos_diff -gt 0 && $time_diff -gt 0 ]]; then
                    local repos_per_second=$(echo "scale=4; $repos_diff / $time_diff" | bc -l)
                    local eta_seconds=$(echo "scale=0; $repos_remaining / $repos_per_second" | bc -l)
                    
                    local eta_hours=$(( eta_seconds / 3600 ))
                    local eta_minutes=$(( (eta_seconds % 3600) / 60 ))
                    
                    echo "${eta_hours}h ${eta_minutes}m"
                    return
                fi
            fi
        fi
    fi
    echo "Calculating..."
}

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║              EtherX Browser - Detailed Download Tracker           ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

cd "$CHROMIUM_DIR" 2>/dev/null || {
    echo -e "${RED}❌ Cannot access Chromium directory${NC}"
    exit 1
}

# Parse DEPS file more accurately
echo -e "${BLUE}🔍 Parsing DEPS file for exact repository count...${NC}"
if [[ -f "$DEPS_FILE" ]]; then
    # Extract git repository URLs from DEPS
    TOTAL_GIT_REPOS=$(python3 -c "
import re
try:
    with open('$DEPS_FILE', 'r') as f:
        content = f.read()
    
    # Find all git URLs
    git_patterns = [
        r'https://[^\"\']*\.git[^\"\']*',
        r'https://chromium\.googlesource\.com/[^\"\']*',
        r'https://github\.com/[^\"\']*\.git'
    ]
    
    git_repos = set()
    for pattern in git_patterns:
        matches = re.findall(pattern, content)
        git_repos.update(matches)
    
    print(len(git_repos))
except:
    print('227')  # fallback
    ")
else
    TOTAL_GIT_REPOS=227  # fallback estimate
fi

echo -e "${CYAN}📊 Expected total Git repositories:${NC} $TOTAL_GIT_REPOS"

while true; do
    clear
    echo "╔════════════════════════════════════════════════════════════════════╗"
    echo "║              EtherX Browser - Detailed Download Tracker           ║"
    echo "╚════════════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Current status
    CURRENT_TIME=$(timestamp)
    CURRENT_REPOS=$(find . -name ".git" -type d 2>/dev/null | wc -l)
    CURRENT_SIZE=$(du -sh . 2>/dev/null | cut -f1)
    TEMP_DIRS=$(find . -name "_gclient_*" -type d 2>/dev/null | wc -l)
    
    # Log current progress
    log_progress "$CURRENT_REPOS" "$CURRENT_SIZE"
    
    echo -e "${CYAN}⏰ Time:${NC} $CURRENT_TIME"
    echo -e "${CYAN}📁 Directory:${NC} $CHROMIUM_DIR"
    echo ""
    
    # Progress calculation
    PROGRESS_PERCENT=$(echo "scale=1; $CURRENT_REPOS * 100 / $TOTAL_GIT_REPOS" | bc -l 2>/dev/null || echo "0")
    REMAINING_REPOS=$(( TOTAL_GIT_REPOS - CURRENT_REPOS ))
    
    echo -e "${GREEN}✅ Downloaded repositories:${NC} $CURRENT_REPOS / $TOTAL_GIT_REPOS"
    echo -e "${YELLOW}⏳ Remaining repositories:${NC} $REMAINING_REPOS"
    echo -e "${BLUE}📈 Progress:${NC} $PROGRESS_PERCENT%"
    
    # Progress bar
    BAR_WIDTH=50
    FILLED=$(echo "scale=0; $PROGRESS_PERCENT * $BAR_WIDTH / 100" | bc -l 2>/dev/null || echo "0")
    printf "${PURPLE}Progress: ${NC}["
    for ((i=0; i<FILLED; i++)); do printf "█"; done
    for ((i=FILLED; i<BAR_WIDTH; i++)); do printf "░"; done
    printf "] %.1f%%\n" "$PROGRESS_PERCENT"
    
    echo ""
    echo -e "${CYAN}💾 Current size:${NC} $CURRENT_SIZE"
    echo -e "${CYAN}🔄 Active temp downloads:${NC} $TEMP_DIRS"
    
    # ETA calculation
    ETA=$(calculate_eta "$CURRENT_REPOS" "$TOTAL_GIT_REPOS")
    echo -e "${CYAN}⏱️  Estimated time remaining:${NC} $ETA"
    
    # Process status
    echo ""
    if ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; then
        GCLIENT_PROCS=$(ps aux | grep -E "gclient.*sync" | grep -v grep | wc -l)
        GIT_PROCS=$(ps aux | grep -E "git.*(clone|fetch)" | grep -v grep | wc -l)
        echo -e "${GREEN}🔄 Status: ACTIVE${NC} (gclient: $GCLIENT_PROCS, git: $GIT_PROCS)"
        
        # Show what's currently downloading
        if [[ $TEMP_DIRS -gt 0 ]]; then
            echo -e "${YELLOW}📥 Currently downloading:${NC}"
            find . -name "_gclient_*" -type d 2>/dev/null | head -3 | while read temp_dir; do
                repo_name=$(basename "$temp_dir" | sed 's/_gclient_.*//g')
                echo -e "  ${YELLOW}→${NC} $repo_name"
            done
        fi
    else
        echo -e "${RED}⛔ Status: STOPPED or COMPLETED${NC}"
        
        if [[ $CURRENT_REPOS -ge $TOTAL_GIT_REPOS ]]; then
            echo -e "${GREEN}🎉 DOWNLOAD COMPLETED! 🎉${NC}"
            echo -e "${GREEN}✅ All repositories downloaded successfully!${NC}"
            exit 0
        fi
    fi
    
    echo ""
    echo "════════════════════════════════════════════════════════════════════"
    echo "Press Ctrl+C to exit | Updating every 10 seconds"
    
    sleep 10
done
