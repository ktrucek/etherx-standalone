#!/bin/bash

################################################################################
# EtherX Browser - Konfiguracija Lokacija
#
# Ovaj fajl definiše gdje će biti instalirani različiti komponenti
################################################################################

# OPCIJA 1: Custom Server Struktura (AKTIVNA)
# - Chromium build u /var/www/vhosts/kriptoentuzijasti.io/etherx_browser/
# - Projekt (skripte, docs) u /var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser/
SERVER_ROOT="/var/www/vhosts/kriptoentuzijasti.io"
CHROMIUM_ROOT="$SERVER_ROOT/etherx_browser/chromium"
DEPOT_TOOLS_ROOT="$SERVER_ROOT/etherx_browser/depot_tools"
PROJECT_ROOT="$SERVER_ROOT/AI projekt/browser"

# OPCIJA 2: Home folder (Google standard)
# Odkomentiraj ako želiš klasičan pristup:
# CHROMIUM_ROOT="$HOME/chromium"
# DEPOT_TOOLS_ROOT="$HOME/depot_tools"
# PROJECT_ROOT="/var/www/vhosts/kriptoentuzijasti.io/AI projekt/browser"

################################################################################
# Build Konfiguracija
################################################################################

# Broj CPU core-ova za build (auto-detect ili manuelno)
BUILD_THREADS=$(nproc 2>/dev/null || echo 4)

# Target za build
BUILD_TARGET="content_shell"  # Za početak
# BUILD_TARGET="chrome"       # Za puni Chromium

# Build tip
BUILD_TYPE="Release"          # Optimizovan
# BUILD_TYPE="Debug"          # Za development

################################################################################
# Disk Prostor Provjera
################################################################################

# Minimum potreban prostor (u GB)
MIN_DISK_SPACE_GB=50

# Check funkcija
check_disk_space() {
    local target_dir=$1
    local available=$(df -BG "$target_dir" | awk 'NR==2 {print $4}' | sed 's/G//')
    
    if [[ $available -lt $MIN_DISK_SPACE_GB ]]; then
        echo "⚠️  UPOZORENJE: Nedovoljno prostora!"
        echo "   Potrebno: ${MIN_DISK_SPACE_GB}GB"
        echo "   Dostupno: ${available}GB"
        echo "   Lokacija: $target_dir"
        return 1
    else
        echo "✓ Dovoljno prostora: ${available}GB dostupno"
        return 0
    fi
}

################################################################################
# Helper Funkcije
################################################################################

# Prikaži trenutnu konfiguraciju
show_config() {
    echo "═══════════════════════════════════════════════════════════════"
    echo "              ETHERX BROWSER - KONFIGURACIJA"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "📁 Lokacije:"
    echo "   Chromium Source:  $CHROMIUM_ROOT"
    echo "   Depot Tools:      $DEPOT_TOOLS_ROOT"
    echo "   EtherX Project:   $PROJECT_ROOT"
    echo ""
    echo "🔧 Build:"
    echo "   Threads:          $BUILD_THREADS"
    echo "   Target:           $BUILD_TARGET"
    echo "   Type:             $BUILD_TYPE"
    echo ""
    echo "💾 Disk Prostor:"
    check_disk_space "$(dirname "$CHROMIUM_ROOT")" || true
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
}

# Export svih varijabli
export CHROMIUM_ROOT
export PROJECT_ROOT
export DEPOT_TOOLS_ROOT
export BUILD_THREADS
export BUILD_TARGET
export BUILD_TYPE
