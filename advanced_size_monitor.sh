#!/bin/bash

# Advanced size monitor with visual progress
CHROMIUM_DIR="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser"
TARGET_SIZE_GB=30  # Expected final size

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Function to convert size to GB for calculation
size_to_gb() {
    local size="$1"
    if [[ $size == *"G"* ]]; then
        echo "$size" | sed 's/G.*//'
    elif [[ $size == *"M"* ]]; then
        echo "$size" | sed 's/M.*//' | awk '{print $1/1024}'
    else
        echo "0"
    fi
}

# Function to create progress bar
progress_bar() {
    local current=$1
    local target=$2
    local width=50
    
    if (( $(echo "$target > 0" | bc -l) )); then
        local percentage=$(echo "scale=2; $current / $target * 100" | bc -l)
        local filled=$(echo "scale=0; $percentage * $width / 100" | bc -l)
        
        printf "["
        for ((i=0; i<filled; i++)); do printf "█"; done
        for ((i=filled; i<width; i++)); do printf "░"; done
        printf "] %.1f%%\n" "$percentage"
    else
        printf "[%50s] 0.0%%\n" ""
    fi
}

echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║              EtherX Browser - Size Monitor                      ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""

previous_size=""
start_time=$(date +%s)

while true; do
    clear
    echo "╔══════════════════════════════════════════════════════════════════╗"
    echo "║              EtherX Browser - Size Monitor                      ║"
    echo "╚══════════════════════════════════════════════════════════════════╝"
    echo ""
    
    current_time=$(date +%s)
    elapsed=$(( current_time - start_time ))
    hours=$(( elapsed / 3600 ))
    minutes=$(( (elapsed % 3600) / 60 ))
    seconds=$(( elapsed % 60 ))
    
    echo -e "${CYAN}Vreme monitoring-a:${NC} ${hours}h ${minutes}m ${seconds}s"
    echo -e "${CYAN}Trenutno vreme:${NC} $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    
    if [[ -d "$CHROMIUM_DIR" ]]; then
        current_size=$(du -sh "$CHROMIUM_DIR" 2>/dev/null | cut -f1)
        current_gb=$(size_to_gb "$current_size")
        
        echo -e "${BLUE}Direktorijum:${NC} $CHROMIUM_DIR"
        echo -e "${GREEN}Trenutna veličina:${NC} $current_size"
        
        # Progress bar
        echo -e "${YELLOW}Progres:${NC}"
        progress_bar "$current_gb" "$TARGET_SIZE_GB"
        
        # Size change detection
        if [[ -n "$previous_size" && "$current_size" != "$previous_size" ]]; then
            echo -e "${GREEN}✓ Promena detektovana!${NC} ($previous_size → $current_size)"
        elif [[ -n "$previous_size" ]]; then
            echo -e "${YELLOW}○ Bez promene${NC} (zadnja: $previous_size)"
        fi
        
        previous_size="$current_size"
        
        # Disk space
        disk_info=$(df -h /var/www/vhosts/kriptoentuzijasti.io 2>/dev/null | awk 'NR==2 {print $2, $3, $4, $5}')
        if [[ -n "$disk_info" ]]; then
            read total used available percent <<< "$disk_info"
            echo ""
            echo -e "${CYAN}Disk prostor:${NC}"
            echo "  Total: $total | Korišćeno: $used | Slobodno: $available | Popunjeno: $percent"
        fi
        
    else
        echo -e "${RED}✗ Direktorijum ne postoji!${NC}"
        echo "  Lokacija: $CHROMIUM_DIR"
    fi
    
    echo ""
    echo "════════════════════════════════════════════════════════════════════"
    echo "Pritisni Ctrl+C za izlaz | Ažurira se svakih 5 sekundi"
    
    sleep 5
done
