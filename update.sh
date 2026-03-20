#!/bin/bash

# ═══════════════════════════════════════════════════════════
#  Shared Knowledge MCP - Cap nhat
# ═══════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

DEFAULT_INSTALL_DIR="$HOME/.shared-knowledge-mcp"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BOLD}Shared Knowledge MCP - Cap nhat${NC}                ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Tim thu muc cai dat ──

INSTALL_DIR="${1:-}"

if [ -z "$INSTALL_DIR" ]; then
  if [ -d "$DEFAULT_INSTALL_DIR" ] && [ -f "$DEFAULT_INSTALL_DIR/package.json" ]; then
    INSTALL_DIR="$DEFAULT_INSTALL_DIR"
  elif [ -f "./package.json" ] && grep -q "shared-knowledge-mcp" "./package.json" 2>/dev/null; then
    INSTALL_DIR="$(pwd)"
  else
    error "Khong tim thay MCP server."
    echo ""
    echo "  Cach dung: ./update.sh [duong-dan]"
    echo "  Vi du:     ./update.sh ~/.shared-knowledge-mcp"
    echo ""
    exit 1
  fi
fi

INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"

if [ ! -f "$INSTALL_DIR/package.json" ]; then
  error "Khong tim thay MCP server tai $INSTALL_DIR"
  exit 1
fi

info "MCP server tai ${BOLD}$INSTALL_DIR${NC}"

# ── Luu phien ban hien tai ──

cd "$INSTALL_DIR"

CURRENT_COMMIT=""
if [ -d ".git" ]; then
  CURRENT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  info "Phien ban hien tai: $CURRENT_COMMIT"
fi

# ── Pull code moi ──

if [ -d ".git" ]; then
  info "Dang pull code moi nhat..."

  # Kiem tra thay doi local
  if ! git diff --quiet 2>/dev/null; then
    warn "Co thay doi local chua commit"
    echo ""
    echo "  1) Stash thay doi va cap nhat"
    echo "  2) Bo thay doi local va cap nhat"
    echo "  3) Huy"
    echo ""
    read -rp "  Chon [1]: " CHOICE < /dev/tty
    CHOICE="${CHOICE:-1}"

    case "$CHOICE" in
      1)
        git stash
        success "Da stash (khoi phuc bang: git stash pop)"
        ;;
      2)
        git checkout .
        success "Da bo thay doi local"
        ;;
      3)
        info "Huy cap nhat."
        exit 0
        ;;
      *)
        error "Lua chon khong hop le"
        exit 1
        ;;
    esac
  fi

  git pull origin main 2>/dev/null || git pull 2>/dev/null
  NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

  if [ "$CURRENT_COMMIT" = "$NEW_COMMIT" ]; then
    success "Da la phien ban moi nhat ($NEW_COMMIT)"
  else
    success "Da cap nhat: $CURRENT_COMMIT → $NEW_COMMIT"

    # Hien thi thay doi
    if [ "$CURRENT_COMMIT" != "unknown" ] && [ "$NEW_COMMIT" != "unknown" ]; then
      echo ""
      info "Thay doi:"
      git log --oneline "$CURRENT_COMMIT".."$NEW_COMMIT" 2>/dev/null | head -20 | while read -r line; do
        echo "  $line"
      done
    fi
  fi
else
  warn "Khong phai git repo — khong the pull."
  echo "  De cap nhat, cai lai tu git:"
  echo "  git clone https://github.com/vuluu2k/shared_knowledge_mcp.git $INSTALL_DIR"
  exit 1
fi

# ── Cai lai dependencies ──

info "Cai dependencies..."
npm install 2>&1 | tail -1
success "Dependencies da cap nhat"

# ── Build lai TypeScript ──

info "Build TypeScript..."
npm run build 2>&1 | tail -1
success "Build thanh cong"

# ── Kiem tra ──

info "Kiem tra..."
node --check "$INSTALL_DIR/dist/index.js" 2>/dev/null && success "Syntax OK" || warn "Kiem tra syntax that bai"

# ── Xong ──

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Cap nhat thanh cong!${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Khoi dong lai IDE de su dung phien ban moi.${NC}"
echo ""
