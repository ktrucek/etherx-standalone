#!/bin/bash

################################################################################
# Prebacivanje EtherX Browser projekta na korisnika 'kriptoen'
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

PROJECT_DIR="/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser"

clear

cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║         Prebacivanje Projekta na Korisnika 'kriptoen'        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF

echo ""

# Provjera da li je root
if [[ $EUID -ne 0 ]]; then
   log_error "Ova skripta mora da se pokrene kao root!"
   log_info "Pokrenite: sudo bash switch_to_kriptoen.sh"
   exit 1
fi

# Provjera da li korisnik kriptoen postoji
if ! id "kriptoen" &>/dev/null; then
    log_error "Korisnik 'kriptoen' ne postoji na sistemu!"
    log_info "Kreirajte ga prvo sa: useradd -m -s /bin/bash kriptoen"
    exit 1
fi

log_success "Korisnik 'kriptoen' pronađen"
echo ""

################################################################################
# KORAK 1: Čišćenje root instalacija
################################################################################
log_info "KORAK 1: Čišćenje root instalacija"
echo ""

# Provjera i brisanje /root/depot_tools
if [[ -d "/root/depot_tools" ]]; then
    log_warning "Brišem /root/depot_tools..."
    rm -rf /root/depot_tools
    log_success "Obrisano: /root/depot_tools"
else
    log_info "Nema /root/depot_tools (već čisto)"
fi

# Čišćenje .bashrc
if grep -q "depot_tools" /.bashrc 2>/dev/null; then
    log_warning "Uklanjam depot_tools iz /.bashrc..."
    sed -i '/depot_tools/d' /.bashrc
    log_success "Očišćeno: /.bashrc"
else
    log_info "Nema depot_tools u /.bashrc (već čisto)"
fi

echo ""

################################################################################
# KORAK 2: Prebacivanje ownership projekta
################################################################################
log_info "KORAK 2: Prebacivanje ownership projekta na 'kriptoen'"
echo ""

# Dohvati primarnu grupu korisnika kriptoen
KRIPTOEN_GROUP=$(id -gn kriptoen)
log_info "Korisnik: kriptoen, Grupa: $KRIPTOEN_GROUP"

log_info "Mijenjam vlasnika: $PROJECT_DIR"
chown -R kriptoen:$KRIPTOEN_GROUP "$PROJECT_DIR"
log_success "Ownership promijenjen na kriptoen:$KRIPTOEN_GROUP"

echo ""

################################################################################
# KORAK 3: Kreiranje helper skripte za kriptoen korisnika
################################################################################
log_info "KORAK 3: Kreiranje helper skripte"
echo ""

cat > "$PROJECT_DIR/continue_as_kriptoen.sh" << 'INNEREOF'
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
echo "     - Instalirati depot_tools u /home/kriptoen/depot_tools"
echo "     - Preuzeti Chromium source (~30GB)"
echo "     - Napraviti build Chromium-a"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}Brzi pregled:${NC}"
echo ""
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
INNEREOF

chmod +x "$PROJECT_DIR/continue_as_kriptoen.sh"
chown kriptoen:$KRIPTOEN_GROUP "$PROJECT_DIR/continue_as_kriptoen.sh"

log_success "Kreirana skripta: continue_as_kriptoen.sh"

echo ""

################################################################################
# KORAK 4: Provjera disk prostora
################################################################################
log_info "KORAK 4: Provjera disk prostora"
echo ""

AVAILABLE=$(df -BG . | awk 'NR==2 {print $4}' | sed 's/G//')
log_info "Dostupan prostor: ${AVAILABLE}GB"

if [[ $AVAILABLE -lt 50 ]]; then
    log_warning "UPOZORENJE: Preporučuje se minimum 50GB slobodnog prostora"
    log_warning "Trenutno dostupno: ${AVAILABLE}GB"
else
    log_success "Dovoljno prostora za razvoj (potrebno ~50GB)"
fi

echo ""

################################################################################
# ZAVRŠETAK
################################################################################

log_success "═══════════════════════════════════════════════════════════════"
log_success "              PREBACIVANJE USPJEŠNO ZAVRŠENO!"
log_success "═══════════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}✓${NC} depot_tools iz /root/ - Obrisano"
echo -e "${GREEN}✓${NC} /.bashrc - Očišćeno"
echo -e "${GREEN}✓${NC} Projekt ownership - kriptoen:kriptoen"
echo -e "${GREEN}✓${NC} Helper skripta - Kreirana"
echo ""
log_info "Sada se prebacite na korisnika 'kriptoen' i nastavite:"
echo ""
echo -e "  ${YELLOW}su - kriptoen${NC}"
echo -e "  ${YELLOW}cd '$PROJECT_DIR'${NC}"
echo -e "  ${YELLOW}./continue_as_kriptoen.sh${NC}"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
