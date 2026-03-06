#!/bin/bash
# Quick Node.js Download Script
# Downloads Node.js directly from nodejs.org

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

CHROMIUM_SRC="/var/www/vhosts/kriptoentuzijasti.io/etherx_browser/chromium/src"
NODE_DIR="$CHROMIUM_SRC/third_party/node/linux/node-linux-x64"
NODE_BIN="$NODE_DIR/bin/node"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Quick Node.js Download${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if already installed
if [ -f "$NODE_BIN" ]; then
    NODE_VERSION=$("$NODE_BIN" --version)
    echo -e "${GREEN}✓ Node.js already installed: $NODE_VERSION${NC}"
    exit 0
fi

echo -e "${BLUE}Node.js nije instaliran, preuzimam...${NC}"

# Node.js version (LTS)
NODE_VERSION="20.11.0"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz"
TEMP_ARCHIVE="/tmp/node-linux-x64-temp.tar.gz"

echo ""
echo "URL: $NODE_URL"
echo "Destinacija: $NODE_DIR"
echo ""

# Download
echo -e "${BLUE}Preuzimam Node.js ${NODE_VERSION}...${NC}"
curl -L --progress-bar "$NODE_URL" -o "$TEMP_ARCHIVE"

# Extract
echo ""
echo -e "${BLUE}Ekstraktujem...${NC}"
mkdir -p "$NODE_DIR"
tar -xzf "$TEMP_ARCHIVE" -C "$NODE_DIR" --strip-components=1

# Cleanup
rm -f "$TEMP_ARCHIVE"

# Verify
if [ -f "$NODE_BIN" ]; then
    NODE_VERSION=$("$NODE_BIN" --version)
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✓ Node.js uspješno instaliran!${NC}"
    echo -e "${GREEN}  Verzija: $NODE_VERSION${NC}"
    echo -e "${GREEN}  Lokacija: $NODE_BIN${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}✗ Greška: Node.js instalacija nije uspjela${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
