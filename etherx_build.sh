#!/bin/bash

################################################################################
# EtherX Browser - Master Build Script
#
# This script orchestrates the entire EtherX Browser development process
# from initial setup through all phases of development.
################################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${MAGENTA}[STEP]${NC} $1"; }
log_phase() { echo -e "${CYAN}[PHASE]${NC} $1"; }

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"

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
║               Chromium-Based Browser with Web3                ║
║               Master Build & Development System               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF

echo ""
log_info "Welcome to EtherX Browser Development System!"
echo ""

################################################################################
# Function: Check if phase is complete
################################################################################
is_phase_complete() {
    local phase=$1
    local marker_file="$PROJECT_ROOT/.phase${phase}_complete"
    [[ -f "$marker_file" ]]
}

mark_phase_complete() {
    local phase=$1
    touch "$PROJECT_ROOT/.phase${phase}_complete"
}

################################################################################
# Function: Show main menu
################################################################################
show_main_menu() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "                    DEVELOPMENT PHASES"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    # Phase 1
    if is_phase_complete "1"; then
        echo -e "  ${GREEN}✓${NC} Phase 1: Research & Environment Setup [COMPLETE]"
    else
        echo -e "  ${YELLOW}○${NC} Phase 1: Research & Environment Setup [TODO]"
    fi
    echo "     1.1 - Chromium Architecture Research"
    echo "     1.2 - Development Environment Setup"
    echo "     1.3 - Download Chromium Source Code"
    echo "     1.4 - Build Chromium"
    echo ""
    
    # Phase 2
    if is_phase_complete "2"; then
        echo -e "  ${GREEN}✓${NC} Phase 2: Core Browser (MVP) [COMPLETE]"
    else
        echo -e "  ${YELLOW}○${NC} Phase 2: Core Browser (MVP) [TODO]"
    fi
    echo "     2.1 - Application Shell"
    echo "     2.2 - Embed WebView"
    echo "     2.3 - Navigation Bar"
    echo "     2.4 - Tab Management"
    echo "     2.5 - Web Page Rendering"
    echo ""
    
    # Phase 3
    if is_phase_complete "3"; then
        echo -e "  ${GREEN}✓${NC} Phase 3: Advanced Features [COMPLETE]"
    else
        echo -e "  ${YELLOW}○${NC} Phase 3: Advanced Features [TODO]"
    fi
    echo "     3.x - Bookmarks, History, Downloads"
    echo "     3.x - Settings & Preferences"
    echo "     3.x - Web3 Integration"
    echo ""
    
    # Phase 4
    if is_phase_complete "4"; then
        echo -e "  ${GREEN}✓${NC} Phase 4: UI/UX Polish [COMPLETE]"
    else
        echo -e "  ${YELLOW}○${NC} Phase 4: UI/UX Polish [TODO]"
    fi
    echo ""
    
    # Phase 5
    if is_phase_complete "5"; then
        echo -e "  ${GREEN}✓${NC} Phase 5: Testing & Optimization [COMPLETE]"
    else
        echo -e "  ${YELLOW}○${NC} Phase 5: Testing & Optimization [TODO]"
    fi
    echo ""
    
    # Phase 6
    if is_phase_complete "6"; then
        echo -e "  ${GREEN}✓${NC} Phase 6: Deployment [COMPLETE]"
    else
        echo -e "  ${YELLOW}○${NC} Phase 6: Deployment [TODO]"
    fi
    echo ""
    
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "Options:"
    echo "  1)  Run Phase 1: Research & Setup"
    echo "  2)  Run Phase 2: Build MVP"
    echo "  3)  Run Phase 3: Advanced Features"
    echo "  4)  Run Phase 4: UI/UX"
    echo "  5)  Run Phase 5: Testing"
    echo "  6)  Run Phase 6: Deployment"
    echo ""
    echo "  10) Run ALL Phases (Automated)"
    echo "  11) Run Specific Script"
    echo ""
    echo "  20) View Project Status"
    echo "  21) View Logs"
    echo "  22) Clean Build"
    echo ""
    echo "  0)  Exit"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
}

################################################################################
# Function: Run Phase 1
################################################################################
run_phase1() {
    log_phase "Starting Phase 1: Research & Environment Setup"
    echo ""
    
    echo "Phase 1 consists of 4 steps:"
    echo "  1.1 - Chromium Architecture Research"
    echo "  1.2 - Development Environment Setup"
    echo "  1.3 - Download Chromium Source Code (~30GB, 1-3 hours)"
    echo "  1.4 - Build Chromium (2-6 hours)"
    echo ""
    read -p "Run all Phase 1 steps? (y/n): " choice
    
    if [[ "$choice" != "y" ]]; then
        run_phase1_submenu
        return
    fi
    
    # Step 1.1
    log_step "Phase 1.1 - Chromium Architecture Research"
    if [[ -x "$SCRIPTS_DIR/phase1/01_chromium_architecture_research.sh" ]]; then
        bash "$SCRIPTS_DIR/phase1/01_chromium_architecture_research.sh"
    else
        log_warning "Script not found or not executable"
    fi
    echo ""
    read -p "Research materials created. Please study them before continuing. Press Enter when ready..."
    
    # Step 1.2
    log_step "Phase 1.2 - Development Environment Setup"
    if [[ -x "$SCRIPTS_DIR/phase1/02_environment_setup.sh" ]]; then
        bash "$SCRIPTS_DIR/phase1/02_environment_setup.sh"
    else
        log_error "Script not found: 02_environment_setup.sh"
        return 1
    fi
    
    # Step 1.3
    log_step "Phase 1.3 - Download Chromium Source"
    log_warning "This will download ~30GB and take 1-3 hours"
    read -p "Continue? (y/n): " choice
    if [[ "$choice" == "y" ]]; then
        if [[ -x "$SCRIPTS_DIR/phase1/03_chromium_download.sh" ]]; then
            bash "$SCRIPTS_DIR/phase1/03_chromium_download.sh"
        else
            log_error "Script not found: 03_chromium_download.sh"
            return 1
        fi
    fi
    
    # Step 1.4
    log_step "Phase 1.4 - Build Chromium"
    log_warning "This will take 2-6 hours"
    read -p "Continue? (y/n): " choice
    if [[ "$choice" == "y" ]]; then
        if [[ -x "$SCRIPTS_DIR/phase1/04_chromium_build.sh" ]]; then
            bash "$SCRIPTS_DIR/phase1/04_chromium_build.sh"
        else
            log_error "Script not found: 04_chromium_build.sh"
            return 1
        fi
    fi
    
    mark_phase_complete "1"
    log_success "Phase 1 Complete!"
}

################################################################################
# Function: Phase 1 Submenu
################################################################################
run_phase1_submenu() {
    echo ""
    echo "Phase 1 Sub-Steps:"
    echo "  1) 1.1 - Chromium Architecture Research"
    echo "  2) 1.2 - Development Environment Setup"
    echo "  3) 1.3 - Download Chromium Source"
    echo "  4) 1.4 - Build Chromium"
    echo "  0) Back"
    echo ""
    read -p "Select step: " step
    
    case $step in
        1)
            bash "$SCRIPTS_DIR/phase1/01_chromium_architecture_research.sh"
            ;;
        2)
            bash "$SCRIPTS_DIR/phase1/02_environment_setup.sh"
            ;;
        3)
            bash "$SCRIPTS_DIR/phase1/03_chromium_download.sh"
            ;;
        4)
            bash "$SCRIPTS_DIR/phase1/04_chromium_build.sh"
            ;;
        0)
            return
            ;;
        *)
            log_error "Invalid option"
            ;;
    esac
}

################################################################################
# Function: Run Phase 2
################################################################################
run_phase2() {
    log_phase "Starting Phase 2: Core Browser (MVP)"
    
    if ! is_phase_complete "1"; then
        log_warning "Phase 1 not complete. Please complete Phase 1 first."
        return 1
    fi
    
    log_info "Phase 2 scripts will be available after Phase 1 completion."
    log_info "Creating Phase 2 script stubs..."
    
    mkdir -p "$SCRIPTS_DIR/phase2"
    
    # Create stub scripts for Phase 2
    for script in 01_application_shell 02_embed_webview 03_navigation_bar 04_tab_management 05_web_rendering; do
        if [[ ! -f "$SCRIPTS_DIR/phase2/${script}.sh" ]]; then
            cat > "$SCRIPTS_DIR/phase2/${script}.sh" << 'EOF'
#!/bin/bash
echo "Phase 2 Script: $0"
echo "This script will guide you through building this component."
echo "Implementation in progress..."
EOF
            chmod +x "$SCRIPTS_DIR/phase2/${script}.sh"
        fi
    done
    
    log_info "Phase 2 development environment ready"
    log_info "Refer to TODO.md for detailed instructions"
}

################################################################################
# Function: View Project Status
################################################################################
view_project_status() {
    clear
    echo "═══════════════════════════════════════════════════════════════"
    echo "                    PROJECT STATUS"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    # Check each phase
    for phase in {1..6}; do
        if is_phase_complete "$phase"; then
            echo -e "  Phase $phase: ${GREEN}✓ COMPLETE${NC}"
        else
            echo -e "  Phase $phase: ${YELLOW}○ TODO${NC}"
        fi
    done
    
    echo ""
    echo "───────────────────────────────────────────────────────────────"
    echo "  System Information"
    echo "───────────────────────────────────────────────────────────────"
    echo "  OS: $(uname -s)"
    echo "  Arch: $(uname -m)"
    echo "  CPU Cores: $(nproc 2>/dev/null || sysctl -n hw.ncpu)"
    echo "  RAM: $(free -h 2>/dev/null | awk '/^Mem:/{print $2}' || sysctl -n hw.memsize | awk '{print int($1/1024/1024/1024)"GB"}')"
    echo ""
    
    # Check key directories
    echo "───────────────────────────────────────────────────────────────"
    echo "  Directories"
    echo "───────────────────────────────────────────────────────────────"
    
    if [[ -d "$HOME/depot_tools" ]]; then
        echo -e "  depot_tools: ${GREEN}✓ Installed${NC}"
    else
        echo -e "  depot_tools: ${RED}✗ Not found${NC}"
    fi
    
    if [[ -d "$HOME/chromium/src" ]]; then
        echo -e "  Chromium source: ${GREEN}✓ Downloaded${NC}"
        echo "    Size: $(du -sh "$HOME/chromium" 2>/dev/null | cut -f1)"
    else
        echo -e "  Chromium source: ${RED}✗ Not found${NC}"
    fi
    
    if [[ -d "$HOME/chromium/src/out/Default" ]]; then
        echo -e "  Chromium build: ${GREEN}✓ Built${NC}"
        echo "    Size: $(du -sh "$HOME/chromium/src/out/Default" 2>/dev/null | cut -f1)"
    else
        echo -e "  Chromium build: ${RED}✗ Not built${NC}"
    fi
    
    echo ""
    read -p "Press Enter to continue..."
}

################################################################################
# Function: View Logs
################################################################################
view_logs() {
    clear
    echo "═══════════════════════════════════════════════════════════════"
    echo "                         LOGS"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    if [[ -d "$PROJECT_ROOT/logs" ]]; then
        log_info "Available logs:"
        ls -lh "$PROJECT_ROOT/logs"/*.log 2>/dev/null || echo "No logs found"
        echo ""
        read -p "Enter log file name to view (or Enter to go back): " logfile
        
        if [[ -n "$logfile" && -f "$PROJECT_ROOT/logs/$logfile" ]]; then
            less "$PROJECT_ROOT/logs/$logfile"
        fi
    else
        log_warning "Logs directory not found"
    fi
    
    echo ""
    read -p "Press Enter to continue..."
}

################################################################################
# Function: Clean Build
################################################################################
clean_build() {
    clear
    echo "═══════════════════════════════════════════════════════════════"
    echo "                      CLEAN BUILD"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    log_warning "This will remove build artifacts to free disk space"
    echo ""
    echo "Options:"
    echo "  1) Clean Chromium build output (~20-30GB)"
    echo "  2) Clean logs"
    echo "  3) Clean ALL (keeps source code)"
    echo "  4) Reset ALL phases (start over)"
    echo "  0) Cancel"
    echo ""
    read -p "Select option: " choice
    
    case $choice in
        1)
            if [[ -d "$HOME/chromium/src/out" ]]; then
                log_info "Removing: $HOME/chromium/src/out"
                rm -rf "$HOME/chromium/src/out"
                log_success "Build output cleaned"
            else
                log_info "No build output to clean"
            fi
            ;;
        2)
            if [[ -d "$PROJECT_ROOT/logs" ]]; then
                log_info "Removing logs..."
                rm -rf "$PROJECT_ROOT/logs"/*
                log_success "Logs cleaned"
            else
                log_info "No logs to clean"
            fi
            ;;
        3)
            log_warning "Cleaning all build artifacts..."
            rm -rf "$HOME/chromium/src/out" 2>/dev/null
            rm -rf "$PROJECT_ROOT/logs"/* 2>/dev/null
            log_success "Clean complete"
            ;;
        4)
            log_warning "This will reset all phase completion markers"
            read -p "Are you sure? (yes/no): " confirm
            if [[ "$confirm" == "yes" ]]; then
                rm -f "$PROJECT_ROOT/.phase"*"_complete"
                log_success "All phases reset"
            fi
            ;;
        0)
            return
            ;;
        *)
            log_error "Invalid option"
            ;;
    esac
    
    echo ""
    read -p "Press Enter to continue..."
}

################################################################################
# Main Loop
################################################################################
main() {
    while true; do
        show_main_menu
        read -p "Select option: " option
        
        case $option in
            1)
                run_phase1
                ;;
            2)
                run_phase2
                ;;
            3)
                log_info "Phase 3 coming soon..."
                read -p "Press Enter to continue..."
                ;;
            4)
                log_info "Phase 4 coming soon..."
                read -p "Press Enter to continue..."
                ;;
            5)
                log_info "Phase 5 coming soon..."
                read -p "Press Enter to continue..."
                ;;
            6)
                log_info "Phase 6 coming soon..."
                read -p "Press Enter to continue..."
                ;;
            10)
                log_warning "Automated full build will run all phases"
                read -p "Continue? (y/n): " choice
                if [[ "$choice" == "y" ]]; then
                    run_phase1
                    run_phase2
                    # Add more phases...
                fi
                ;;
            11)
                echo ""
                read -p "Enter script path (e.g., scripts/phase1/01_*.sh): " script_path
                if [[ -x "$PROJECT_ROOT/$script_path" ]]; then
                    bash "$PROJECT_ROOT/$script_path"
                else
                    log_error "Script not found or not executable"
                fi
                ;;
            20)
                view_project_status
                ;;
            21)
                view_logs
                ;;
            22)
                clean_build
                ;;
            0)
                log_info "Exiting EtherX Browser Development System"
                exit 0
                ;;
            *)
                log_error "Invalid option"
                sleep 1
                ;;
        esac
    done
}

# Make scripts executable
chmod +x "$SCRIPTS_DIR"/phase*/*.sh 2>/dev/null || true

# Run main
main "$@"
