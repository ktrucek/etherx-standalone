#!/usr/bin/env bash
# ============================================================
#  EtherX Mobile — Deploy Script
#  Repozitorij: https://github.com/ktrucek/etherx-mobile
#
#  Usage:
#    ./deploy-mobitel.sh              → auto-increment patch version
#    ./deploy-mobitel.sh 1.2.0        → postavi specificnu verziju
#    ./deploy-mobitel.sh --no-push    → commit + lokalni fix, bez push
#    ./deploy-mobitel.sh --sync       → samo sinkronizira repo s GitHuba
#
#  Što radi:
#   1. Provjeri/klonira etherx-mobile repo (../etherx-mobile)
#   2. Fixa Android build grešku: rn_edit_text_material drawable
#   3. Bumpa verziju u package.json, Android i iOS build metadata
#   4. Instalira dependencyje i radi lokalni Android release build
#   5. git commit + tag vX.Y.Z
#   6. git push → GitHub Actions builda Android + iOS artefakte
# ============================================================

set -euo pipefail

# ── Konfiguracija ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(dirname "$SCRIPT_DIR")/AI projekt/etherx-mobile"
# Fallback ako pokrecemo iz browser foldera direktno
if [[ ! -d "$MOBILE_DIR" ]]; then
  MOBILE_DIR="$SCRIPT_DIR/../etherx-mobile"
fi
MOBILE_REPO="https://github.com/ktrucek/etherx-mobile.git"
DEPLOY_OWNER="kriptoen:psacln"
BUILD_LOCAL=true
ANDROID_ONLY=false
IOS_ONLY=false
SKIP_BUILD=false
DEMO_MODE=false
SKIP_GIT=false
DEFAULT_APP_NAME="EtherX Browser"
DEMO_APP_NAME="EtherX Browser Demo"
DEFAULT_INITIAL_URL="https://n8n.kriptoentuzijasti.io/browser.html"
DEMO_INITIAL_URL="https://n8n.kriptoentuzijasti.io/browser.html?demo=1"

# ── Parse args ────────────────────────────────────────────────────────────────
NO_PUSH=false
SYNC_ONLY=false
REQUESTED_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --no-push)    NO_PUSH=true ;;
    --sync)       SYNC_ONLY=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --android-only) ANDROID_ONLY=true ;;
    --ios-only)   IOS_ONLY=true ;;
    --demo)       DEMO_MODE=true ;;
    --help|-h)
      echo "Koristenje: ./deploy-mobitel.sh [VERZIJA] [--demo] [--no-push] [--sync] [--skip-build] [--android-only] [--ios-only]"
      echo "  VERZIJA    npr. 1.2.1  (default: auto-increment patch)"
      echo "  --demo     Pripremi test/demo naziv aplikacije i demo početni URL"
      echo "  --no-push  Preskoči git push (samo lokalni commit)"
      echo "  --sync     Samo sinkroniziraj repo s GitHuba, bez deploya"
      echo "  --skip-build   Preskoči lokalni build korak"
      echo "  --android-only Lokalno radi samo Android korake"
      echo "  --ios-only     Preskoči Android lokalni build i fokusiraj iOS provjere/CI"
      exit 0 ;;
    *)  REQUESTED_VERSION="$arg" ;;
  esac
done

# ── Boje ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[mobitel]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

if [[ "$ANDROID_ONLY" == true && "$IOS_ONLY" == true ]]; then
  error "Ne možeš koristiti --android-only i --ios-only zajedno"
fi

if [[ "$DEMO_MODE" == true && "$NO_PUSH" == false ]]; then
  warn "Demo mode uključen — automatski postavljam --no-push za lokalno testiranje"
  NO_PUSH=true
fi

if [[ "$DEMO_MODE" == true ]]; then
  SKIP_GIT=true
fi

# ── 0. Pre-flight provjere ────────────────────────────────────────────────────
info "Pre-flight provjere..."
command -v git     &>/dev/null || error "git nije instaliran"
command -v node    &>/dev/null || error "node nije instaliran"
command -v python3 &>/dev/null || error "python3 nije instaliran"
command -v npm     &>/dev/null || error "npm nije instaliran"

# ── 1. Kloniranje / sinkronizacija repozitorija ───────────────────────────────
if [[ ! -d "$MOBILE_DIR/.git" ]]; then
  warn "etherx-mobile repo nije pronađen lokalno — kloniram s GitHuba..."
  info "Ciljni folder: $MOBILE_DIR"
  mkdir -p "$(dirname "$MOBILE_DIR")"
  git clone "$MOBILE_REPO" "$MOBILE_DIR"
  success "Klonirano u: $MOBILE_DIR"
else
  info "etherx-mobile repo pronađen: $MOBILE_DIR"
  cd "$MOBILE_DIR"
  info "Dohvaćam zadnje izmjene s GitHuba..."
  git fetch origin
  # Sinkroniziraj samo ako nema lokalnih izmjena koje bi se izgubile
  DIRTY=$(git status --porcelain 2>/dev/null | grep -v "^??" || true)
  if [[ -z "$DIRTY" ]]; then
    git pull origin main --ff-only 2>/dev/null || \
    git pull origin master --ff-only 2>/dev/null || \
    warn "Pull nije uspio (možda nema remote main/master grane)"
    success "Repo sinkroniziran s GitHuba"
  else
    warn "Ima lokalnih izmjena — preskačem pull, koristim lokalne izmjene"
  fi
fi

if [[ "$SYNC_ONLY" == true ]]; then
  success "Sinkronizacija završena. Folder: $MOBILE_DIR"
  exit 0
fi

cd "$MOBILE_DIR"

# ── 1b. Postavi app mode (demo/release) ─────────────────────────────────────
if [[ "$DEMO_MODE" == true ]]; then
  APP_NAME="$DEMO_APP_NAME"
  MODE_BADGE="Demo"
  MODE_URL="$DEMO_INITIAL_URL"
  DEMO_MODE_PY=true
else
  APP_NAME="$DEFAULT_APP_NAME"
  MODE_BADGE="Mobile"
  MODE_URL="$DEFAULT_INITIAL_URL"
  DEMO_MODE_PY=false
fi

info "Postavljam app mode → ${APP_NAME}"
python3 - <<PYEOF
from pathlib import Path
import re

mode_path = Path('mobile-mode.ts')
content = mode_path.read_text(encoding='utf-8')
content = re.sub(r"demoMode:\s*(true|false)", "demoMode: $DEMO_MODE_PY", content, count=1)
content = re.sub(r"appDisplayName:\s*'[^']*'", "appDisplayName: '$APP_NAME'", content, count=1)
content = re.sub(r"titleLabel:\s*'[^']*'", "titleLabel: '$APP_NAME'", content, count=1)
content = re.sub(r"badgeLabel:\s*'[^']*'", "badgeLabel: '$MODE_BADGE'", content, count=1)
content = re.sub(r"initialUrl:\s*'[^']*'", "initialUrl: '$MODE_URL'", content, count=1)
mode_path.write_text(content, encoding='utf-8')
print('  mobile-mode.ts ažuriran')
PYEOF

python3 - <<PYEOF
import json
path = 'app.json'
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)
data['displayName'] = '$APP_NAME'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('  app.json displayName ažuriran')
PYEOF

python3 - <<PYEOF
from pathlib import Path
path = Path('android/app/src/main/res/values/strings.xml')
text = path.read_text(encoding='utf-8')
text = text.replace('<string name="app_name">EtherX Browser</string>', '<string name="app_name">$APP_NAME</string>')
text = text.replace('<string name="app_name">EtherX Browser Demo</string>', '<string name="app_name">$APP_NAME</string>')
path.write_text(text, encoding='utf-8')
print('  Android app_name ažuriran')
PYEOF

python3 - <<PYEOF
import plistlib
path = 'ios/EtherXMobile/Info.plist'
with open(path, 'rb') as f:
    data = plistlib.load(f)
data['CFBundleDisplayName'] = '$APP_NAME'
with open(path, 'wb') as f:
    plistlib.dump(data, f)
print('  iOS CFBundleDisplayName ažuriran')
PYEOF

# ── 2. Fix Android build greške: rn_edit_text_material ───────────────────────
info "Provjeravam Android drawable resurse..."

DRAWABLE_DIR="android/app/src/main/res/drawable"
DRAWABLE_FILE="${DRAWABLE_DIR}/rn_edit_text_material.xml"
STYLES_FILE="android/app/src/main/res/values/styles.xml"

mkdir -p "$DRAWABLE_DIR"

# Provjeri koristi li styles.xml ovaj drawable
if [[ -f "$STYLES_FILE" ]] && grep -q "rn_edit_text_material" "$STYLES_FILE"; then
  if [[ ! -f "$DRAWABLE_FILE" ]]; then
    info "Kreiram nedostajući drawable: rn_edit_text_material.xml"
    cat > "$DRAWABLE_FILE" << 'XMLEOF'
<?xml version="1.0" encoding="utf-8"?>
<!--
  rn_edit_text_material.xml
  Standardni Material EditText background drawable za React Native.
  Potreban kada styles.xml referencira android:editTextBackground="@drawable/rn_edit_text_material"
-->
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:insetLeft="@dimen/abc_edit_text_inset_horizontal_material"
    android:insetRight="@dimen/abc_edit_text_inset_horizontal_material"
    android:insetTop="@dimen/abc_edit_text_inset_top_material"
    android:insetBottom="@dimen/abc_edit_text_inset_bottom_material">
    <selector>
        <item android:state_enabled="false">
            <nine-patch
                android:alpha="?android:attr/disabledAlpha"
                android:src="@drawable/abc_textfield_default_mtrl_alpha"
                android:tint="?attr/colorControlNormal" />
        </item>
        <item
            android:state_focused="false"
            android:state_pressed="false">
            <nine-patch
                android:src="@drawable/abc_textfield_default_mtrl_alpha"
                android:tint="?attr/colorControlNormal" />
        </item>
        <item>
            <nine-patch
                android:src="@drawable/abc_textfield_activated_mtrl_alpha"
                android:tint="?attr/colorControlActivated" />
        </item>
    </selector>
</inset>
XMLEOF
    success "Kreiran: $DRAWABLE_FILE"
  else
    success "rn_edit_text_material.xml već postoji — OK"
  fi
else
  warn "styles.xml ne referencira rn_edit_text_material — preskačem drawable kreiranje"
fi

# Čišćenje Android build cachea (ako postoji)
if [[ -d "android/build" ]] || [[ -d "android/app/build" ]]; then
  info "Brišem Android build cache (android/build i android/app/build)..."
  rm -rf android/build android/app/build 2>/dev/null || true
  success "Android build cache obrisan"
fi

# ── 3. Bump verzije ───────────────────────────────────────────────────────────
CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('package.json'))['version'])")
info "Trenutna verzija: ${YELLOW}$CURRENT_VERSION${NC}"

if [[ -n "$REQUESTED_VERSION" ]]; then
  NEW_VERSION="$REQUESTED_VERSION"
else
  IFS='.' read -r VMAJ VMIN VPATCH <<< "$CURRENT_VERSION"
  VPATCH=$((VPATCH + 1))
  NEW_VERSION="${VMAJ}.${VMIN}.${VPATCH}"
fi

info "Nova verzija: ${GREEN}$NEW_VERSION${NC}"

if [[ "$DEMO_MODE" == true ]]; then
  info "Demo build aktivan: naziv=${APP_NAME}, url=${MODE_URL}"
fi

# Potvrda (interaktivno)
if [[ -t 0 ]]; then
  read -rp "$(echo -e "${YELLOW}Nastaviti s v${NEW_VERSION}? [Y/n] ${NC}")" CONFIRM
  CONFIRM="${CONFIRM:-Y}"
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { info "Prekinuto."; exit 0; }
fi

# Bump package.json
info "Bumping package.json → $NEW_VERSION"
python3 - <<PYEOF
import json
path = 'package.json'
with open(path, 'r') as f:
    d = json.load(f)
d['version'] = '$NEW_VERSION'
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print("  package.json ažuriran")
PYEOF

# Bump android/app/build.gradle versionName i versionCode
if [[ -f "android/app/build.gradle" ]]; then
  info "Bumping android/app/build.gradle → $NEW_VERSION"
  # Dohvati trenutni versionCode i inkrementiraj
  CURRENT_CODE=$(grep -oP '(?<=versionCode )\d+' android/app/build.gradle | head -1)
  NEW_CODE=$(( ${CURRENT_CODE:-1} + 1 ))
  python3 - <<PYEOF
import re
path = 'android/app/build.gradle'
with open(path, 'r') as f:
    content = f.read()
content = re.sub(r'versionCode\s+\d+', f'versionCode $NEW_CODE', content, count=1)
content = re.sub(r'versionName\s+"[^"]+"', f'versionName "$NEW_VERSION"', content, count=1)
with open(path, 'w') as f:
    f.write(content)
print(f"  android/app/build.gradle: versionCode=$NEW_CODE, versionName=$NEW_VERSION")
PYEOF
fi

# Bump iOS Info.plist verzije
if [[ -f "ios/EtherXMobile/Info.plist" ]]; then
  info "Bumping ios/EtherXMobile/Info.plist → $NEW_VERSION"
  CURRENT_IOS_BUILD=$(python3 - <<'PYEOF'
import plistlib
with open('ios/EtherXMobile/Info.plist', 'rb') as f:
    data = plistlib.load(f)
print(data.get('CFBundleVersion', '1'))
PYEOF
)
  if [[ "$CURRENT_IOS_BUILD" =~ ^[0-9]+$ ]]; then
    NEW_IOS_BUILD=$((CURRENT_IOS_BUILD + 1))
  else
    NEW_IOS_BUILD=1
  fi
  python3 - <<PYEOF
import plistlib
path = 'ios/EtherXMobile/Info.plist'
with open(path, 'rb') as f:
    data = plistlib.load(f)
data['CFBundleShortVersionString'] = '$NEW_VERSION'
data['CFBundleVersion'] = '$NEW_IOS_BUILD'
with open(path, 'wb') as f:
    plistlib.dump(data, f)
print('  ios/EtherXMobile/Info.plist: CFBundleShortVersionString=$NEW_VERSION, CFBundleVersion=$NEW_IOS_BUILD')
PYEOF
fi

# Bump package-lock.json
if [[ -f "package-lock.json" ]]; then
  python3 - <<PYEOF
import json
path = 'package-lock.json'
with open(path, 'r') as f:
    d = json.load(f)
d['version'] = '$NEW_VERSION'
if 'packages' in d and '' in d['packages']:
    d['packages']['']['version'] = '$NEW_VERSION'
with open(path, 'w') as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
    f.write('\n')
print("  package-lock.json ažuriran")
PYEOF
fi

# ── 4. Dependency install + lokalni build ────────────────────────────────────
if [[ "$SKIP_BUILD" == false ]]; then
  info "Instaliram Node dependencyje (npm ci)..."
  npm ci

  if [[ "$IOS_ONLY" == false ]]; then
    if [[ "$DEMO_MODE" == true ]]; then
      info "Pokrećem lokalni Android debug build za demo testiranje..."
    else
      info "Pokrećem lokalni Android release build..."
    fi
    chmod +x android/gradlew
    if [[ "$DEMO_MODE" == true ]]; then
      (cd android && ./gradlew assembleDebug --no-daemon)
      success "Android demo debug build gotov"
    else
      (cd android && ./gradlew assembleRelease --no-daemon)
      success "Android release build gotov"
    fi
  else
    warn "--ios-only: preskačem lokalni Android build"
  fi

  if [[ "$ANDROID_ONLY" == false ]]; then
    if [[ "$OSTYPE" == darwin* ]]; then
      info "macOS detektiran — pripremam iOS dependencyje"
      (cd ios && bundle install && bundle exec pod install)
      if /usr/libexec/PlistBuddy -c 'Print :teamID' ios/ExportOptions.plist 2>/dev/null | grep -q '[A-Z0-9]'; then
        info "Pokrećem iOS archive build..."
        (cd ios && xcodebuild archive -workspace EtherXMobile.xcworkspace -scheme EtherXMobile -configuration Release -archivePath "$PWD/build/EtherXMobile.xcarchive" -destination 'generic/platform=iOS')
        success "iOS archive build gotov"
      else
        warn "iOS signing nije kompletan (teamID je prazan u ios/ExportOptions.plist) — lokalni iOS archive preskočen"
      fi
    else
      warn "Lokalni iOS build nije moguć na Linuxu — GitHub Actions ostaje kanal za iOS artefakt"
    fi
  else
    warn "--android-only: preskačem iOS lokalne korake"
  fi
else
  warn "--skip-build: preskačem lokalni build korak"
fi

# ── 5. Git commit + tag ───────────────────────────────────────────────────────
TAG_NAME="v${NEW_VERSION}"
if [[ "$SKIP_GIT" == false ]]; then
  info "Stagiranje datoteka..."
  git add -A

  DIRTY_CHECK=$(git status --porcelain 2>/dev/null | grep -v "^??" || true)
  if [[ -n "$DIRTY_CHECK" ]]; then
    COMMIT_MSG="v${NEW_VERSION}: deploy - fix Android rn_edit_text_material drawable"
    info "Commitam: $COMMIT_MSG"
    git commit -m "$COMMIT_MSG"
  else
    warn "Nema izmjena za commit (sve je čisto)"
  fi

  git tag -d "$TAG_NAME" 2>/dev/null || true
  info "Tagiranje: $TAG_NAME"
  git tag "$TAG_NAME"
else
  warn "Demo mode: preskačem git commit i tag korake"
fi

# ── 6. Push na GitHub (triggerira CI build) ───────────────────────────────────
if [[ "$SKIP_GIT" == true ]]; then
  warn "Demo mode: preskačem GitHub push"
elif [[ "$NO_PUSH" == false ]]; then
  info "Pushanje na GitHub (triggerira Actions CI build)..."
  # Probaj main, pa master
  git push origin main 2>/dev/null || \
    git push origin master 2>/dev/null || \
    error "Push nije uspio — provjeri pristup GitHubu"
  git push origin "$TAG_NAME" || warn "Tag push nije uspio"
  success "GitHub push gotov — CI build triggeriran za $TAG_NAME"
else
  warn "--no-push: Preskačem GitHub push"
fi

# ── 7. Fix ownership ─────────────────────────────────────────────────────────
info "Postavljam vlasništvo → $DEPLOY_OWNER ..."
chown -R "$DEPLOY_OWNER" "$MOBILE_DIR" 2>/dev/null || \
  warn "Nije moguće postaviti vlasništvo (pokretaj kao root)"

# ── 8. Sažetak ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Mobitel deploy završen: v${NEW_VERSION}${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  📦 Verzija:    ${CYAN}v${NEW_VERSION}${NC}"
echo -e "  📱 Repo:       ${CYAN}https://github.com/ktrucek/etherx-mobile${NC}"
if [[ "$SKIP_GIT" == false ]]; then
  echo -e "  🔖 Git tag:    ${CYAN}${TAG_NAME}${NC}"
fi
if [[ -f "android/app/build/outputs/apk/release/app-release.apk" ]]; then
  echo -e "  🤖 Android APK: ${CYAN}${MOBILE_DIR}/android/app/build/outputs/apk/release/app-release.apk${NC}"
fi
if [[ -f "android/app/build/outputs/apk/debug/app-debug.apk" ]]; then
  echo -e "  🧪 Android Demo APK: ${CYAN}${MOBILE_DIR}/android/app/build/outputs/apk/debug/app-debug.apk${NC}"
fi
if [[ "$NO_PUSH" == false ]]; then
  echo -e "  🚀 CI build:   ${CYAN}https://github.com/ktrucek/etherx-mobile/actions${NC}"
fi
echo -e "  📁 Lokalni folder: ${MOBILE_DIR}"
echo ""
echo -e "  🔧 Riješene greške:"
echo -e "     ✅ Android drawable rn_edit_text_material — kreiran/provjeren"
echo -e "     ✅ Android build cache očišćen"
echo -e "     ✅ Verzije sinkronizirane za package.json + Android + iOS Info.plist"
if [[ "$DEMO_MODE" == true ]]; then
  echo -e "     ✅ Demo mode aktivan: naziv aplikacije i početni URL postavljeni za testiranje"
fi
if [[ -f "android/keystore.properties" ]]; then
  echo -e "     ✅ Android release signing konfiguriran kroz android/keystore.properties"
else
  echo -e "     ⚠️ Android release trenutno pada na debug signing dok ne dodaš android/keystore.properties"
fi
if [[ -f "ios/ExportOptions.plist" ]] && grep -q '<string></string>' ios/ExportOptions.plist; then
  echo -e "     ⚠️ iOS App Store/TestFlight potpis još traži Apple Team ID + certifikate"
fi
echo ""
