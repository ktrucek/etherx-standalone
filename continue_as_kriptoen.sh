#!/bin/bash

################################################################################
# Nastavak razvoja kao korisnik 'kriptoen'
################################################################################

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

clear

cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║               ███████╗████████╗██╗  ██╗███████╗██████╗       ║
║               ██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗      ║
║               █████╗     ██║   ███████║█████╗  ██████╔╝      ║
║               ██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗      ║
║               ███████╗   ██║   ██║  ██║███████╗██║  ██║      ║
║               ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝      ║
║                                                               ║
║                  Dobrodošli natrag, kriptoen!                 ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF

echo ""
echo -e "${GREEN}✓${NC} Projekt je sada pod vašim nalogom!"
echo ""
echo -e "${BLUE}Sljedeći koraci:${NC}"
echo ""
echo "  1. Pokrenite glavnu build skriptu:"
echo -e "     ${YELLOW}./etherx_build.sh${NC}"
echo ""
echo "  2. Odaberite opciju 1 (Run Phase 1)"
echo ""
echo "  3. Sistem će:"
echo "     - Instalirati depot_tools u /var/www/vhosts/kriptoentuzijasti.io/etherx_browser/depot_tools"
echo "     - Preuzeti Chromium source (~30GB) u /var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium"
echo "     - Napraviti build Chromium-a"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}Struktura:${NC}"
echo ""
echo "  📁 /var/www/vhosts/kriptoentuzijasti.io/"
echo "     ├── AI projekt/browser/        (Projekt: skripte, dokumentacija)"
echo "     └── etherx_browser/            (Chromium build: ~45GB)"
echo "         ├── depot_tools/           (Build alati)"
echo "         └── chromium/              (Source code)"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}Brzi pregled:${NC}"
echo ""
echo "  • Konfiguracija: CONFIG.sh"
echo "  • Dokumentacija: README.md, QUICKSTART.md, TODO.md"
echo "  • Status: ./status.sh"
echo "  • Build sistem: ./etherx_build.sh"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Pokreni build sistem
read -p "Želite li pokrenuti build sistem sada? (y/n): " choice
if [[ "$choice" == "y" ]]; then
    ./etherx_build.sh
fi
