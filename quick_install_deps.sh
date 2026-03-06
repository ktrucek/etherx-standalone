#!/bin/bash

################################################################################
# Brza Instalacija Build Dependencies (Bez Sudo Promptova)
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

if [[ $EUID -ne 0 ]]; then
   echo "Mora se pokrenuti kao root!"
   exit 1
fi

log_info "Instalacija build dependencies..."

# Essential
apt-get update -qq
apt-get install -y \
    git \
    python3 \
    python3-pip \
    curl \
    wget \
    build-essential \
    ninja-build \
    pkg-config \
    lsb-release \
    libglib2.0-dev \
    libgtk-3-dev \
    libx11-dev \
    libxext-dev \
    libxfixes-dev \
    libxi-dev \
    libxrandr-dev \
    libxrender-dev \
    libxss-dev \
    libxtst-dev \
    libcups2-dev \
    libdbus-1-dev \
    libdrm-dev \
    libgbm-dev \
    libnss3-dev \
    libpci-dev \
    libpulse-dev \
    libudev-dev \
    libcap-dev \
    libkrb5-dev \
    libpam0g-dev \
    libspeechd-dev \
    bison \
    cdbs \
    flex \
    gperf \
    xvfb \
    wdiff \
    xz-utils \
    zip \
    > /dev/null 2>&1

log_success "Build dependencies instalirani!"
log_info "Sada možeš nastaviti kao kriptoen korisnik"
