#!/bin/bash

################################################################################
# EtherX Browser - Phase 1.2: Development Environment Setup
#
# This script sets up the complete development environment for building
# Chromium-based EtherX Browser including all dependencies, tools, and
# configuration needed for large-scale C++ development.
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${MAGENTA}[STEP]${NC} $1"
}

log_check() {
    echo -e "${CYAN}[CHECK]${NC} $1"
}

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load configuration
source "$PROJECT_ROOT/CONFIG.sh"

LOG_FILE="$PROJECT_ROOT/logs/phase1_02_environment_setup.log"
DEPOT_TOOLS_DIR="$DEPOT_TOOLS_ROOT"
CHROMIUM_DIR="$HOME/chromium"

# Create logs directory
mkdir -p "$PROJECT_ROOT/logs"

# Initialize log file
exec > >(tee -a "$LOG_FILE")
exec 2>&1

log_info "============================================"
log_info "EtherX Browser - Development Environment Setup"
log_info "============================================"
log_info "Project root: $PROJECT_ROOT"
log_info "Started at: $(date)"
echo ""

################################################################################
# Function: Check system requirements
################################################################################
check_system_requirements() {
    log_step "Checking system requirements..."
    
    local all_checks_passed=true
    
    # Check OS
    log_check "Operating System"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        log_success "Linux detected"
        OS="linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        log_success "macOS detected"
        OS="mac"
    else
        log_error "Unsupported OS: $OSTYPE"
        all_checks_passed=false
    fi
    
    # Check architecture
    log_check "System Architecture"
    ARCH=$(uname -m)
    if [[ "$ARCH" == "x86_64" ]]; then
        log_success "64-bit system detected"
    else
        log_warning "Non-x86_64 architecture detected: $ARCH"
        log_warning "Chromium build may face issues"
    fi
    
    # Check disk space (need at least 100GB)
    log_check "Disk Space"
    available_space=$(df -BG "$HOME" | awk 'NR==2 {print $4}' | sed 's/G//')
    if [[ $available_space -ge 100 ]]; then
        log_success "Sufficient disk space: ${available_space}GB available"
    else
        log_error "Insufficient disk space: ${available_space}GB available (need 100GB+)"
        all_checks_passed=false
    fi
    
    # Check RAM
    log_check "RAM"
    if [[ "$OS" == "linux" ]]; then
        total_ram=$(free -g | awk '/^Mem:/{print $2}')
    elif [[ "$OS" == "mac" ]]; then
        total_ram=$(sysctl -n hw.memsize | awk '{print int($1/1024/1024/1024)}')
    fi
    
    if [[ $total_ram -ge 16 ]]; then
        log_success "RAM: ${total_ram}GB (sufficient)"
    elif [[ $total_ram -ge 8 ]]; then
        log_warning "RAM: ${total_ram}GB (minimum, build will be slow)"
    else
        log_error "RAM: ${total_ram}GB (insufficient, need 8GB minimum)"
        all_checks_passed=false
    fi
    
    # Check CPU cores
    log_check "CPU Cores"
    if [[ "$OS" == "linux" ]]; then
        cpu_cores=$(nproc)
    elif [[ "$OS" == "mac" ]]; then
        cpu_cores=$(sysctl -n hw.ncpu)
    fi
    log_success "CPU cores: $cpu_cores"
    
    if [[ $cpu_cores -lt 4 ]]; then
        log_warning "Less than 4 CPU cores detected. Build will be very slow."
    fi
    
    if [[ "$all_checks_passed" == false ]]; then
        log_error "System requirements check failed. Please fix issues before continuing."
        exit 1
    fi
    
    log_success "System requirements check passed"
    echo ""
}

################################################################################
# Function: Install core prerequisites
################################################################################
install_prerequisites() {
    log_step "Installing core prerequisites..."
    
    if [[ "$OS" == "linux" ]]; then
        install_prerequisites_linux
    elif [[ "$OS" == "mac" ]]; then
        install_prerequisites_mac
    fi
    
    log_success "Core prerequisites installed"
    echo ""
}

install_prerequisites_linux() {
    log_info "Installing prerequisites for Linux..."
    
    # Check if essential tools are already installed
    if command -v git &> /dev/null && command -v python3 &> /dev/null && command -v ninja &> /dev/null; then
        log_success "Essential build tools already installed, skipping apt install"
        return 0
    fi
    
    # Update package list
    log_info "Updating package list..."
    sudo apt update
    
    # Essential build tools
    log_info "Installing build essentials..."
    sudo apt install -y \
        build-essential \
        git \
        python3 \
        python3-pip \
        curl \
        wget \
        lsb-release \
        sudo \
        ninja-build \
        pkg-config
    
    # Additional development libraries
    log_info "Installing development libraries..."
    sudo apt install -y \
        libgtk-3-dev \
        libglib2.0-dev \
        libdbus-1-dev \
        libnss3-dev \
        libx11-dev \
        libxss-dev \
        libxtst-dev \
        libxkbcommon-dev \
        libgbm-dev \
        libpci-dev \
        libcups2-dev \
        libasound2-dev \
        libpulse-dev \
        libudev-dev \
        libdrm-dev
    
    # Additional tools
    log_info "Installing additional tools..."
    sudo apt install -y \
        bison \
        cdbs \
        curl \
        dpkg-dev \
        elfutils \
        devscripts \
        fakeroot \
        flex \
        git-core \
        gperf \
        libasound2-dev \
        libatspi2.0-dev \
        libbrlapi-dev \
        libbz2-dev \
        libcap-dev \
        libcups2-dev \
        libdrm-dev \
        libegl1-mesa-dev \
        libevdev-dev \
        libffi-dev \
        libgbm-dev \
        libgles2-mesa-dev \
        libglib2.0-dev \
        libglu1-mesa-dev \
        libgtk-3-dev \
        libkrb5-dev \
        libnspr4-dev \
        libnss3-dev \
        libpam0g-dev \
        libpci-dev \
        libpulse-dev \
        libsctp-dev \
        libspeechd-dev \
        libsqlite3-dev \
        libssl-dev \
        libsystemd-dev \
        libudev-dev \
        libva-dev \
        libwww-perl \
        libxshmfence-dev \
        libxslt1-dev \
        libxss-dev \
        libxt-dev \
        libxtst-dev \
        locales \
        openbox \
        p7zip \
        patch \
        perl \
        rpm \
        ruby \
        subversion \
        uuid-dev \
        wdiff \
        x11-utils \
        xcompmgr \
        xz-utils \
        zip
    
    log_success "Linux prerequisites installed"
}

install_prerequisites_mac() {
    log_info "Installing prerequisites for macOS..."
    
    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        log_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    else
        log_success "Homebrew already installed"
    fi
    
    # Update Homebrew
    log_info "Updating Homebrew..."
    brew update
    
    # Install packages
    log_info "Installing packages via Homebrew..."
    brew install \
        git \
        python3 \
        ninja \
        pkg-config
    
    # Install Xcode Command Line Tools
    if ! xcode-select -p &> /dev/null; then
        log_info "Installing Xcode Command Line Tools..."
        xcode-select --install
        log_warning "Please complete Xcode installation and re-run this script"
        exit 1
    else
        log_success "Xcode Command Line Tools already installed"
    fi
    
    log_success "macOS prerequisites installed"
}

################################################################################
# Function: Install depot_tools
################################################################################
install_depot_tools() {
    log_step "Installing depot_tools..."
    
    if [[ -d "$DEPOT_TOOLS_DIR" ]]; then
        log_info "depot_tools directory already exists"
        log_info "Updating depot_tools..."
        cd "$DEPOT_TOOLS_DIR"
        git pull
    else
        log_info "Cloning depot_tools..."
        git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git "$DEPOT_TOOLS_DIR"
    fi
    
    # Add to PATH
    log_info "Adding depot_tools to PATH..."
    
    # Determine shell config file
    if [[ -n "$ZSH_VERSION" ]]; then
        SHELL_CONFIG="$HOME/.zshrc"
    elif [[ -n "$BASH_VERSION" ]]; then
        SHELL_CONFIG="$HOME/.bashrc"
    else
        SHELL_CONFIG="$HOME/.profile"
    fi
    
    # Check if already in PATH
    if grep -q "depot_tools" "$SHELL_CONFIG"; then
        log_success "depot_tools already in PATH configuration"
    else
        echo "" >> "$SHELL_CONFIG"
        echo "# depot_tools for Chromium development" >> "$SHELL_CONFIG"
        echo "export PATH=\"\$PATH:$DEPOT_TOOLS_DIR\"" >> "$SHELL_CONFIG"
        log_success "Added depot_tools to $SHELL_CONFIG"
    fi
    
    # Add to current session
    export PATH="$PATH:$DEPOT_TOOLS_DIR"
    
    # Test depot_tools
    if command -v gclient &> /dev/null; then
        log_success "depot_tools installed successfully"
        gclient --version
    else
        log_error "depot_tools installation failed"
        exit 1
    fi
    
    echo ""
}

################################################################################
# Function: Configure Git
################################################################################
configure_git() {
    log_step "Configuring Git for Chromium development..."
    
    # Check if Git is already configured
    GIT_NAME=$(git config --global user.name || echo "")
    GIT_EMAIL=$(git config --global user.email || echo "")
    
    if [[ -z "$GIT_NAME" ]]; then
        log_info "Git user.name not configured - using default"
        DEFAULT_NAME="${USER:-EtherX Developer}"
        git config --global user.name "$DEFAULT_NAME"
        log_success "Set Git user.name: $DEFAULT_NAME"
    else
        log_success "Git user.name already configured: $GIT_NAME"
    fi
    
    if [[ -z "$GIT_EMAIL" ]]; then
        log_info "Git user.email not configured - using default"
        DEFAULT_EMAIL="${USER:-etherx}@localhost"
        git config --global user.email "$DEFAULT_EMAIL"
        log_success "Set Git user.email: $DEFAULT_EMAIL"
    else
        log_success "Git user.email already configured: $GIT_EMAIL"
    fi
    
    # Chromium-specific Git configuration
    log_info "Applying Chromium-specific Git settings..."
    git config --global core.autocrlf false
    git config --global core.filemode false
    git config --global branch.autosetuprebase always
    git config --global core.preloadindex true
    git config --global core.fscache true
    git config --global gc.auto 256
    
    log_success "Git configured for Chromium development"
    echo ""
}

################################################################################
# Function: Setup IDE (VS Code)
################################################################################
setup_ide() {
    log_step "Setting up IDE (VS Code) configuration..."
    
    # Check if VS Code is installed
    if command -v code &> /dev/null; then
        log_success "VS Code is installed"
        
        log_info "Installing recommended VS Code extensions..."
        
        # C/C++ extensions
        code --install-extension ms-vscode.cpptools || log_warning "Failed to install C/C++ extension"
        code --install-extension ms-vscode.cmake-tools || log_warning "Failed to install CMake extension"
        code --install-extension twxs.cmake || log_warning "Failed to install CMake language support"
        
        # Git extensions
        code --install-extension eamodio.gitlens || log_warning "Failed to install GitLens"
        
        # Other useful extensions
        code --install-extension ms-vscode.hexeditor || log_warning "Failed to install Hex Editor"
        code --install-extension ms-python.python || log_warning "Failed to install Python extension"
        
        log_success "VS Code extensions installed"
    else
        log_warning "VS Code not found. Please install VS Code manually."
        log_info "Download from: https://code.visualstudio.com/"
    fi
    
    # Create VS Code workspace settings
    VSCODE_DIR="$PROJECT_ROOT/.vscode"
    mkdir -p "$VSCODE_DIR"
    
    # Create settings.json
    cat > "$VSCODE_DIR/settings.json" << 'EOF'
{
    "C_Cpp.default.compilerPath": "/usr/bin/g++",
    "C_Cpp.default.cStandard": "c17",
    "C_Cpp.default.cppStandard": "c++17",
    "C_Cpp.default.intelliSenseMode": "linux-gcc-x64",
    "files.associations": {
        "*.gn": "python",
        "*.gni": "python"
    },
    "editor.formatOnSave": true,
    "editor.tabSize": 2,
    "files.trimTrailingWhitespace": true,
    "files.insertFinalNewline": true,
    "[cpp]": {
        "editor.defaultFormatter": "ms-vscode.cpptools"
    },
    "[c]": {
        "editor.defaultFormatter": "ms-vscode.cpptools"
    }
}
EOF
    
    log_success "VS Code settings created: $VSCODE_DIR/settings.json"
    
    # Create launch.json for debugging
    cat > "$VSCODE_DIR/launch.json" << 'EOF'
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug EtherX Browser",
            "type": "cppdbg",
            "request": "launch",
            "program": "${workspaceFolder}/out/Default/etherx",
            "args": ["--no-sandbox"],
            "stopAtEntry": false,
            "cwd": "${workspaceFolder}",
            "environment": [],
            "externalConsole": false,
            "MIMode": "gdb",
            "setupCommands": [
                {
                    "description": "Enable pretty-printing for gdb",
                    "text": "-enable-pretty-printing",
                    "ignoreFailures": true
                }
            ]
        },
        {
            "name": "Debug Content Shell",
            "type": "cppdbg",
            "request": "launch",
            "program": "${env:HOME}/chromium/src/out/Default/content_shell",
            "args": ["--no-sandbox"],
            "stopAtEntry": false,
            "cwd": "${env:HOME}/chromium/src",
            "environment": [],
            "externalConsole": false,
            "MIMode": "gdb"
        }
    ]
}
EOF
    
    log_success "VS Code launch configuration created: $VSCODE_DIR/launch.json"
    echo ""
}

################################################################################
# Function: Install debugging tools
################################################################################
install_debugging_tools() {
    log_step "Installing debugging tools..."
    
    if [[ "$OS" == "linux" ]]; then
        log_info "Installing GDB and related tools..."
        sudo apt install -y \
            gdb \
            lldb \
            valgrind \
            strace \
            ltrace
    elif [[ "$OS" == "mac" ]]; then
        log_info "Installing LLDB (included with Xcode)..."
        # LLDB comes with Xcode
    fi
    
    log_success "Debugging tools installed"
    echo ""
}

################################################################################
# Function: Create project structure
################################################################################
create_project_structure() {
    log_step "Creating EtherX Browser project structure..."
    
    cd "$PROJECT_ROOT"
    
    # Create directory structure
    mkdir -p {src/{browser,renderer,common,ui,web3},resources/{icons,ui,locales},build,docs,tests,tools}
    
    log_success "Project structure created"
    
    # Create README.md if it doesn't exist
    if [[ ! -f "$PROJECT_ROOT/README.md" ]]; then
        cat > "$PROJECT_ROOT/README.md" << 'EOF'
# EtherX Browser

A Chromium-based web browser with integrated Web3 capabilities and decentralized content verification.

## Project Structure

```
etherx-browser/
├── src/                    # Source code
│   ├── browser/           # Browser process code
│   ├── renderer/          # Renderer process code
│   ├── common/            # Shared code
│   ├── ui/                # UI components
│   └── web3/              # Web3 integration
├── resources/             # Resources
│   ├── icons/            # Application icons
│   ├── ui/               # UI resources
│   └── locales/          # Translations
├── build/                 # Build configuration
├── docs/                  # Documentation
├── tests/                 # Tests
├── tools/                 # Development tools
├── scripts/               # Build and automation scripts
├── research/              # Research and documentation
└── logs/                  # Build and execution logs
```

## Development Setup

See `docs/DEVELOPMENT.md` for setup instructions.

## Building

See `docs/BUILDING.md` for build instructions.

## License

TBD
EOF
        log_success "Created README.md"
    fi
    
    echo ""
}

################################################################################
# Function: Create environment info file
################################################################################
create_environment_info() {
    log_step "Creating environment information file..."
    
    ENV_INFO_FILE="$PROJECT_ROOT/ENVIRONMENT.md"
    
    cat > "$ENV_INFO_FILE" << EOF
# EtherX Browser - Development Environment Information

**Generated:** $(date)
**Hostname:** $(hostname)

## System Information

- **OS:** $(uname -s)
- **Architecture:** $(uname -m)
- **Kernel:** $(uname -r)
- **CPU Cores:** $cpu_cores
- **RAM:** ${total_ram}GB
- **Available Disk Space:** ${available_space}GB

## Installed Tools

### Core Tools
- **Git:** $(git --version)
- **Python:** $(python3 --version)
- **GCC:** $(gcc --version | head -n1)
- **G++:** $(g++ --version | head -n1)
- **Ninja:** $(ninja --version)
- **depot_tools:** Installed at $DEPOT_TOOLS_DIR

### Debugging Tools
- **GDB:** $(gdb --version | head -n1 || echo "Not installed")
- **LLDB:** $(lldb --version | head -n1 || echo "Not installed")

## Environment Variables

\`\`\`bash
export PATH="\$PATH:$DEPOT_TOOLS_DIR"
\`\`\`

## Git Configuration

\`\`\`
user.name = $(git config --global user.name)
user.email = $(git config --global user.email)
core.autocrlf = false
core.filemode = false
branch.autosetuprebase = always
\`\`\`

## IDE Setup

- **VS Code:** $(code --version | head -n1 || echo "Not installed")
- **Settings:** .vscode/settings.json
- **Launch Config:** .vscode/launch.json

## Next Steps

1. ✅ Environment setup complete
2. → Run Phase 1.3: \`scripts/phase1/03_chromium_download.sh\`
3. → Run Phase 1.4: \`scripts/phase1/04_chromium_build.sh\`

## Troubleshooting

### If builds fail:
- Check disk space (need 100GB+)
- Increase swap space if low on RAM
- Use \`--no-sandbox\` flag for testing

### Performance Tips:
- Use \`is_component_build=true\` for faster incremental builds
- Use \`ccache\` to speed up recompilation
- Close other applications during build

## Resources

- **Chromium Source:** Will be at $CHROMIUM_DIR/src
- **Build Output:** Will be at $CHROMIUM_DIR/src/out/Default
- **Logs:** $PROJECT_ROOT/logs/
EOF

    log_success "Environment information saved: $ENV_INFO_FILE"
    echo ""
}

################################################################################
# Function: Install optional performance tools
################################################################################
install_performance_tools() {
    log_step "Installing optional performance tools..."
    
    if [[ "$OS" == "linux" ]]; then
        log_info "Installing ccache for faster recompilation..."
        sudo apt install -y ccache || log_warning "Failed to install ccache"
        
        log_info "Installing distcc for distributed compilation..."
        sudo apt install -y distcc || log_warning "Failed to install distcc"
    fi
    
    log_success "Performance tools installed"
    echo ""
}

################################################################################
# Function: Verify installation
################################################################################
verify_installation() {
    log_step "Verifying installation..."
    
    local verification_failed=false
    
    # Check each required tool
    local tools=("git" "python3" "ninja" "gclient")
    
    for tool in "${tools[@]}"; do
        if command -v "$tool" &> /dev/null; then
            log_success "✓ $tool"
        else
            log_error "✗ $tool not found"
            verification_failed=true
        fi
    done
    
    if [[ "$verification_failed" == true ]]; then
        log_error "Verification failed. Please check installation."
        exit 1
    fi
    
    log_success "All tools verified successfully"
    echo ""
}

################################################################################
# Function: Generate setup summary
################################################################################
generate_summary() {
    log_step "Generating setup summary..."
    
    SUMMARY_FILE="$PROJECT_ROOT/SETUP_SUMMARY.md"
    
    cat > "$SUMMARY_FILE" << EOF
# EtherX Browser - Environment Setup Summary

**Completed:** $(date)
**Phase:** 1.2 - Development Environment Setup
**Status:** ✅ Complete

## What Was Installed

### Core Tools
✅ Git $(git --version | head -n1)
✅ Python 3 $(python3 --version)
✅ Ninja build system
✅ depot_tools (Chromium development tools)
✅ GCC/G++ compiler toolchain
✅ pkg-config

### Development Libraries (Linux)
✅ GTK+ 3 development files
✅ NSS development files
✅ X11 development files
✅ Audio development libraries
✅ And many more...

### IDE Configuration
✅ VS Code settings (.vscode/settings.json)
✅ VS Code launch configuration (.vscode/launch.json)
✅ Recommended VS Code extensions installed

### Project Structure
✅ Source directories created (src/)
✅ Resource directories created (resources/)
✅ Build directories created (build/)
✅ Documentation directories created (docs/)
✅ Test directories created (tests/)

## Configuration Applied

### Git Configuration
- Line endings: Unix (LF)
- File mode: Disabled
- Auto rebase: Enabled
- User name: $(git config --global user.name)
- User email: $(git config --global user.email)

### Environment Variables
Added to $SHELL_CONFIG:
\`\`\`bash
export PATH="\$PATH:$DEPOT_TOOLS_DIR"
\`\`\`

**Important:** Restart your terminal or run:
\`\`\`bash
source $SHELL_CONFIG
\`\`\`

## System Requirements Status

- ✅ Operating System: $OS
- ✅ Architecture: $ARCH
- ✅ Disk Space: ${available_space}GB available
- ✅ RAM: ${total_ram}GB
- ✅ CPU Cores: $cpu_cores

## Next Steps

### Immediate Actions
1. **Restart Terminal:** To apply PATH changes
   \`\`\`bash
   source $SHELL_CONFIG
   \`\`\`

2. **Verify depot_tools:**
   \`\`\`bash
   gclient --version
   \`\`\`

3. **Move to Phase 1.3:**
   \`\`\`bash
   ./scripts/phase1/03_chromium_download.sh
   \`\`\`

### Phase 1.3: Download Chromium Source
- Download ~30GB of source code
- Estimated time: 1-3 hours (depending on internet speed)
- Run: \`./scripts/phase1/03_chromium_download.sh\`

### Phase 1.4: Build Chromium
- First build will take 2-6 hours
- Requires 100GB+ disk space
- Run: \`./scripts/phase1/04_chromium_build.sh\`

## Troubleshooting

### Common Issues

**Issue:** depot_tools not found after installation
**Solution:** Restart terminal or run \`source $SHELL_CONFIG\`

**Issue:** Not enough disk space
**Solution:** Free up space or use external drive

**Issue:** Build fails with "out of memory"
**Solution:** 
- Close other applications
- Increase swap space
- Use fewer parallel jobs: \`ninja -j 4\` instead of default

**Issue:** Permission denied errors
**Solution:** Check file permissions, avoid running as root

## Resources Created

- **Environment Info:** $ENV_INFO_FILE
- **Setup Summary:** $SUMMARY_FILE (this file)
- **VS Code Settings:** .vscode/settings.json
- **VS Code Launch Config:** .vscode/launch.json
- **Project README:** README.md

## Logs

All installation logs saved to:
$LOG_FILE

## Time Estimate for Next Phases

- **Phase 1.3 (Download):** 1-3 hours
- **Phase 1.4 (First Build):** 2-6 hours
- **Total for Phase 1:** ~1 day

## Support

If you encounter issues:
1. Check logs: $LOG_FILE
2. Review Chromium build docs: https://chromium.googlesource.com/chromium/src/+/main/docs/
3. Search Chromium issue tracker: https://bugs.chromium.org/

---

**Status:** ✅ Environment ready for Chromium development!

**Next:** Run \`./scripts/phase1/03_chromium_download.sh\` to download Chromium source code.
EOF

    log_success "Setup summary saved: $SUMMARY_FILE"
    echo ""
}

################################################################################
# Main Execution
################################################################################
main() {
    log_info "Starting development environment setup..."
    echo ""
    
    check_system_requirements
    install_prerequisites
    install_depot_tools
    configure_git
    setup_ide
    install_debugging_tools
    create_project_structure
    create_environment_info
    install_performance_tools
    verify_installation
    generate_summary
    
    log_success "============================================"
    log_success "Phase 1.2 Environment Setup Complete!"
    log_success "============================================"
    echo ""
    log_info "📋 Summary"
    log_info "---"
    log_success "✅ All prerequisites installed"
    log_success "✅ depot_tools configured"
    log_success "✅ Git configured for Chromium development"
    log_success "✅ IDE setup complete"
    log_success "✅ Project structure created"
    echo ""
    log_warning "⚠️  IMPORTANT: Restart your terminal or run:"
    echo "   source $SHELL_CONFIG"
    echo ""
    log_info "📚 Next Steps:"
    log_info "1. Restart terminal (or source $SHELL_CONFIG)"
    log_info "2. Verify: gclient --version"
    log_info "3. Read: $SUMMARY_FILE"
    log_info "4. Run: ./scripts/phase1/03_chromium_download.sh"
    echo ""
    log_info "Estimated time for next phase: 1-3 hours (download)"
    log_info "Completed at: $(date)"
}

# Run main function
main "$@"
