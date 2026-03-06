#!/bin/bash

################################################################################
# EtherX Browser - Monitor Chromium Download
# Realtime praćenje download procesa i veličine fajlova
################################################################################

CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser"
LOG_FILE="/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/logs/phase1_03_chromium_download.log"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           EtherX Browser - Chromium Download Monitor         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Function to check if gclient is running
check_gclient_running() {
    ps aux | grep -E "(gclient|fetch)" | grep -v grep > /dev/null
    return $?
}

# Function to get directory size
get_dir_size() {
    if [[ -d "$CHROMIUM_DIR" ]]; then
        du -sh "$CHROMIUM_DIR" 2>/dev/null | cut -f1
    else
        echo "N/A"
    fi
}

# Function to get active git processes
get_git_processes() {
    ps aux | grep -E "git.*clone|git.*fetch|git.*index-pack" | grep -v grep | wc -l
}

# Function to get last log lines
get_last_log_lines() {
    if [[ -f "$LOG_FILE" ]]; then
        tail -n 5 "$LOG_FILE" | grep -E "(Still working|WARNING|SUCCESS|ERROR|INFO)" | tail -n 3
    fi
}

# Main monitoring loop
while true; do
    clear
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           EtherX Browser - Chromium Download Monitor         ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Current time
    echo -e "${CYAN}Time:${NC} $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    
    # Check if gclient is running
    if check_gclient_running; then
        echo -e "${GREEN}Status:${NC} ✓ Download ACTIVE"
        echo -e "${YELLOW}Git processes:${NC} $(get_git_processes) active"
    else
        echo -e "${RED}Status:${NC} ✗ Download STOPPED or COMPLETED"
    fi
    
    # Directory size
    echo -e "${BLUE}Directory size:${NC} $(get_dir_size)"
    
    # Disk usage
    echo -e "${CYAN}Disk free:${NC} $(df -h /var/www/vhosts/kriptoentuzijasti.io | awk 'NR==2 {print $4}')"
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo -e "${YELLOW}Last activity:${NC}"
    get_last_log_lines
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "Press Ctrl+C to exit | Updating every 5 seconds..."
    
    sleep 5
done
