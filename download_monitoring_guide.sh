#!/bin/bash

################################################################################
# EtherX Browser - Download Monitoring Guide
# Vodič za sve dostupne monitoring opcije
################################################################################

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║              EtherX Browser - Download Monitoring Guide            ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

echo -e "${BLUE}📊 Dostupni načini praćenja Chromium download-a:${NC}"
echo ""

echo -e "${GREEN}1. 🚀 PREPORUČENO - Repository Progress Tracker${NC}"
echo -e "${CYAN}   ./repo_download_tracker.sh${NC}"
echo -e "   ✓ Prati broj repozitorijuma (144/227 = 63.4%)"
echo -e "   ✓ Progress bar sa realnim procenti"
echo -e "   ✓ Automatski detektuje završetak"
echo -e "   ✓ Ažuriranje svako 10 sekundi"
echo ""

echo -e "${GREEN}2. 📋 Brza Provera - Status Overview${NC}"
echo -e "${CYAN}   ./status.sh${NC}"
echo -e "   ✓ Brz pregled celog projekta"
echo -e "   ✓ Pokazuje download status u real-time"
echo -e "   ✓ System resources"
echo ""

echo -e "${GREEN}3. 💾 Praćenje Veličine${NC}"
echo -e "${CYAN}   ./quick_size_check.sh${NC}          - Trenutna veličina"
echo -e "${CYAN}   ./size_monitor.sh${NC}              - Live size svako 10s"
echo -e "${CYAN}   ./advanced_size_monitor.sh${NC}     - Sa progress bar-om"
echo ""

echo -e "${GREEN}4. 🔍 Detaljne Analize${NC}"
echo -e "${CYAN}   ./analyze_download_progress.sh${NC} - Detaljno repo counting"
echo -e "${CYAN}   tail -f logs/phase1_03_chromium_download.log${NC} - Live log"
echo ""

echo -e "${GREEN}5. ⏰ Automatski Notifikator${NC}"
echo -e "${CYAN}   ./wait_for_completion.sh${NC}       - Čeka završetak i kuca 3x"
echo ""

echo "════════════════════════════════════════════════════════════════════"
echo ""

# Current status summary
echo -e "${YELLOW}📊 TRENUTNO STANJE:${NC}"

if [[ -d "/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium" ]]; then
    cd "/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"
    
    CURRENT_REPOS=$(find . -name ".git" -type d 2>/dev/null | wc -l)
    CURRENT_SIZE=$(du -sh . 2>/dev/null | cut -f1)
    PROGRESS=$(echo "scale=1; $CURRENT_REPOS * 100 / 227" | bc -l 2>/dev/null || echo "0")
    
    echo -e "${CYAN}📁 Veličina:${NC} $CURRENT_SIZE"
    echo -e "${CYAN}📊 Repozitorijumi:${NC} $CURRENT_REPOS/227 (${PROGRESS}%)"
    
    if ps aux | grep -E "gclient.*sync" | grep -v grep > /dev/null; then
        echo -e "${GREEN}🔄 Status:${NC} DOWNLOADING"
    else
        if [[ $CURRENT_REPOS -ge 227 ]]; then
            echo -e "${GREEN}✅ Status: COMPLETED!${NC}"
        else
            echo -e "${RED}⛔ Status: STOPPED${NC}"
        fi
    fi
else
    echo -e "${RED}❌ Chromium direktorijum ne postoji${NC}"
fi

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo -e "${YELLOW}💡 PREPORUČENA UPOTREBA:${NC}"
echo ""
echo -e "1. ${CYAN}./repo_download_tracker.sh${NC} - za kontinuirano praćenje"
echo -e "2. ${CYAN}./status.sh${NC} - za brze provere"
echo -e "3. ${CYAN}./wait_for_completion.sh${NC} - u background-u za notifikaciju"
echo ""
echo -e "${GREEN}🎯 Kad download završi, pokreni Phase 1.4:${NC}"
echo -e "${CYAN}   ./scripts/phase1/04_chromium_build.sh${NC}"
echo ""
