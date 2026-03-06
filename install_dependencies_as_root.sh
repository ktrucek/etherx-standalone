#!/bin/bash

################################################################################
# Instalacija Build Dependencies kao Root
# Ovu skriptu pokreće root prije nego što kriptoen korisnik startuje build
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Provjera root
if [[ $EUID -ne 0 ]]; then
   log_error "Ova skripta mora biti pokrenuta kao root!"
   exit 1
fi

clear

cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║         Instalacija Build Dependencies (kao Root)            ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF

echo ""
log_info "Instalacija build alata i dependencies za Chromium..."
echo ""

################################################################################
# Install Essential Build Tools
################################################################################

log_info "KORAK 1: Essential Build Tools"
echo ""

PACKAGES=(
    git
    python3
    python3-pip
    curl
    wget
    build-essential
    ninja-build
    pkg-config
    lsb-release
    sudo
)

log_info "Instalacija: ${PACKAGES[*]}"
apt-get update -qq
apt-get install -y "${PACKAGES[@]}"

log_success "Essential tools instalirani"
echo ""

################################################################################
# Install Chromium Build Dependencies
################################################################################

log_info "KORAK 2: Chromium Build Dependencies"
echo ""

CHROMIUM_DEPS=(
    libglib2.0-dev
    libgtk-3-dev
    libx11-dev
    libxext-dev
    libxfixes-dev
    libxi-dev
    libxrandr-dev
    libxrender-dev
    libxss-dev
    libxtst-dev
    libcups2-dev
    libdbus-1-dev
    libdrm-dev
    libgbm-dev
    libnss3-dev
    libpci-dev
    libpulse-dev
    libudev-dev
    libcap-dev
    libkrb5-dev
    libpam0g-dev
    libspeechd-dev
    bison
    cdbs
    flex
    gperf
    xvfb
    wdiff
    xz-utils
    zip
)

log_info "Instalacija Chromium dependencies..."
apt-get install -y "${CHROMIUM_DEPS[@]}"

log_success "Chromium dependencies instalirani"
echo ""

################################################################################
# Optional: VS Code (ako nije instaliran)
################################################################################

log_info "KORAK 3: VS Code (opciono)"
echo ""

if ! command -v code &> /dev/null; then
    log_info "VS Code nije instaliran. Instaliram..."
    
    wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
    install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg
    echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list
    rm -f packages.microsoft.gpg
    
    apt-get update -qq
    apt-get install -y code
    
    log_success "VS Code instaliran"
else
    log_success "VS Code već instaliran"
fi

echo ""

################################################################################
# Postavke za kriptoen korisnika
################################################################################

log_info "KORAK 4: Postavke za kriptoen korisnika"
echo ""

# Provjeri da li kriptoen ima sudo pristup (za build dependencies)
if ! groups kriptoen | grep -q sudo; then
    log_info "Dodajem kriptoen u sudo grupu..."
    usermod -aG sudo kriptoen
    log_success "kriptoen sada ima sudo pristup"
else
    log_success "kriptoen već ima sudo pristup"
fi

echo ""

################################################################################
# Završetak
################################################################################

log_success "═══════════════════════════════════════════════════════════════"
log_success "         BUILD DEPENDENCIES USPJEŠNO INSTALIRANI!"
log_success "═══════════════════════════════════════════════════════════════"
echo ""
log_info "Instalirano:"
echo "  ✓ Git, Python3, Build tools"
echo "  ✓ Chromium build dependencies"
echo "  ✓ VS Code (IDE)"
echo "  ✓ kriptoen ima sudo pristup"
echo ""
log_info "Sada se prebaci na korisnika kriptoen:"
echo ""
echo "  su - kriptoen"
echo "  cd '/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser'"
echo "  ./etherx_build.sh"
echo ""
log_success "═══════════════════════════════════════════════════════════════"
echo ""
