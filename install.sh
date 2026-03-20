#!/bin/bash

# ═══════════════════════════════════════════════════════════
#  Shared Knowledge MCP - Cai dat tu dong
#  Ho tro: Claude Desktop, Claude Code, Cursor, Windsurf, Augment, Codex
# ═══════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

print_banner() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${NC}  ${BOLD}Shared Knowledge MCP - Cai dat${NC}                 ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  Ket noi Phoenix backend + Vue 3 frontend       ${CYAN}║${NC}"
  echo -e "${CYAN}║${NC}  13 tools | Cache thong minh | Memory GitHub     ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
}

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Kiem tra Node.js ──

install_node() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &> /dev/null; then
      info "Cai Node.js qua Homebrew..."
      brew install node@20
      brew link --overwrite node@20 2>/dev/null || brew link --force node@20 2>/dev/null || true
    else
      info "Cai Homebrew truoc..."
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      if [ -f "/opt/homebrew/bin/brew" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
      elif [ -f "/usr/local/bin/brew" ]; then
        eval "$(/usr/local/bin/brew shellenv)"
      fi
      brew install node@20
      brew link --overwrite node@20 2>/dev/null || brew link --force node@20 2>/dev/null || true
    fi
  elif command -v apt-get &> /dev/null; then
    info "Cai Node.js 20 qua NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v yum &> /dev/null; then
    info "Cai Node.js 20 qua NodeSource..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  else
    error "Khong the tu cai Node.js tren OS nay."
    echo "  Cai thu cong tai: https://nodejs.org/"
    exit 1
  fi

  if ! command -v node &> /dev/null; then
    error "Cai Node.js that bai."
    echo "  Cai thu cong tai: https://nodejs.org/"
    exit 1
  fi
  success "Node.js $(node -v) da cai thanh cong"
}

check_node() {
  local NEED_INSTALL=false

  if ! command -v node &> /dev/null; then
    warn "Node.js chua duoc cai."
    NEED_INSTALL=true
  else
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
      warn "Can Node.js >= 18. Hien tai: $(node -v)"
      NEED_INSTALL=true
    fi
  fi

  if [ "$NEED_INSTALL" = true ]; then
    echo ""
    read -rp "  Cai Node.js 20 LTS tu dong? (Y/n): " INSTALL_NODE < /dev/tty
    INSTALL_NODE="${INSTALL_NODE:-Y}"
    if [[ "$INSTALL_NODE" =~ ^[Yy]$ ]]; then
      install_node
    else
      error "Can Node.js >= 18. Cai xong chay lai."
      exit 1
    fi
  fi

  NODE_BIN="$(which node)"
  case "$NODE_BIN" in
    /*) ;;
    *)  NODE_BIN="/usr/local/bin/node" ;;
  esac

  success "Node.js $(node -v) tai ${BOLD}$NODE_BIN${NC}"
}

check_git() {
  if ! command -v git &> /dev/null; then
    error "git chua duoc cai. Cai git truoc roi chay lai."
    exit 1
  fi
  success "git $(git --version | awk '{print $3}') detected"
}

check_gh() {
  if command -v gh &> /dev/null; then
    if gh auth status &> /dev/null; then
      GH_USER=$(gh api user --jq .login 2>/dev/null || echo "")
      if [ -n "$GH_USER" ]; then
        success "GitHub CLI da dang nhap: ${BOLD}$GH_USER${NC}"
        HAS_GH=true
        return
      fi
    fi
  fi
  HAS_GH=false
  warn "GitHub CLI chua dang nhap (memory van hoat dong neu co token)"
}

# ── Cai MCP server ──

REPO_URL="https://github.com/vuluu2k/shared_knowledge_mcp.git"
DEFAULT_INSTALL_DIR="$HOME/.shared-knowledge-mcp"

install_mcp() {
  echo ""
  info "Cai MCP server o dau?"
  echo -e "  Mac dinh: ${BOLD}$DEFAULT_INSTALL_DIR${NC}"
  read -rp "  Duong dan (Enter de dung mac dinh): " INSTALL_DIR < /dev/tty
  INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
  INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"

  if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/package.json" ]; then
    success "MCP server da co tai $INSTALL_DIR"
    read -rp "  Cap nhat len phien ban moi nhat? (y/N): " UPDATE < /dev/tty
    if [[ "$UPDATE" =~ ^[Yy]$ ]]; then
      info "Dang cap nhat..."
      cd "$INSTALL_DIR"
      git pull origin main 2>/dev/null || git pull 2>/dev/null || warn "Git pull that bai, dung phien ban hien tai"
      npm install
      npm run build
      success "Cap nhat thanh cong"
      cd - > /dev/null
    fi
  else
    info "Dang clone repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"

    info "Cai dependencies..."
    cd "$INSTALL_DIR"
    npm install

    info "Build TypeScript..."
    npm run build
    cd - > /dev/null
    success "MCP server da cai tai $INSTALL_DIR"
  fi

  MCP_INDEX="$INSTALL_DIR/dist/index.js"
}

# ── Thu thap cau hinh ──

collect_env() {
  echo ""
  echo -e "${BOLD}── Cau hinh ──${NC}"
  echo ""

  # Backend path
  echo -e "  ${YELLOW}Duong dan repo backend (Phoenix):${NC}"
  local DEFAULT_BACKEND="$(dirname "$INSTALL_DIR")/builderx_api"
  read -rp "  BUILDERX_API_PATH [$DEFAULT_BACKEND]: " BACKEND_PATH < /dev/tty
  BACKEND_PATH="${BACKEND_PATH:-$DEFAULT_BACKEND}"
  BACKEND_PATH="${BACKEND_PATH/#\~/$HOME}"

  if [ -d "$BACKEND_PATH" ]; then
    success "Backend repo: $BACKEND_PATH"
  else
    warn "Thu muc $BACKEND_PATH chua ton tai (co the tao sau)"
  fi

  # Frontend path
  echo ""
  echo -e "  ${YELLOW}Duong dan repo frontend (Vue 3):${NC}"
  local DEFAULT_FRONTEND="$(dirname "$INSTALL_DIR")/builderx_spa"
  read -rp "  BUILDERX_SPA_PATH [$DEFAULT_FRONTEND]: " FRONTEND_PATH < /dev/tty
  FRONTEND_PATH="${FRONTEND_PATH:-$DEFAULT_FRONTEND}"
  FRONTEND_PATH="${FRONTEND_PATH/#\~/$HOME}"

  if [ -d "$FRONTEND_PATH" ]; then
    success "Frontend repo: $FRONTEND_PATH"
  else
    warn "Thu muc $FRONTEND_PATH chua ton tai (co the tao sau)"
  fi

  # Memory config
  echo ""
  echo -e "  ${YELLOW}Cau hinh Memory (luu tren GitHub):${NC}"
  echo "  Repo memory se duoc tu dong tao khi luu memory lan dau."
  echo ""

  # Owner
  local DEFAULT_OWNER=""
  if [ "$HAS_GH" = true ] && [ -n "$GH_USER" ]; then
    DEFAULT_OWNER="$GH_USER"
  fi

  if [ -n "$DEFAULT_OWNER" ]; then
    read -rp "  MEMORY_REPO_OWNER [$DEFAULT_OWNER]: " MEMORY_OWNER < /dev/tty
    MEMORY_OWNER="${MEMORY_OWNER:-$DEFAULT_OWNER}"
  else
    read -rp "  MEMORY_REPO_OWNER (GitHub username): " MEMORY_OWNER < /dev/tty
  fi

  # Repo name
  read -rp "  MEMORY_REPO_NAME [shared-knowledge-memory]: " MEMORY_NAME < /dev/tty
  MEMORY_NAME="${MEMORY_NAME:-shared-knowledge-memory}"

  # Token
  echo ""
  echo -e "  ${YELLOW}GitHub token (tuy chon):${NC}"
  if [ "$HAS_GH" = true ]; then
    echo "  Da co gh CLI dang nhap — co the bo qua."
  else
    echo "  Can token voi quyen 'repo' de tao va push repo memory."
    echo "  Tao tai: https://github.com/settings/tokens"
  fi
  read -rp "  MEMORY_REPO_TOKEN (Enter de bo qua): " MEMORY_TOKEN < /dev/tty
  MEMORY_TOKEN="${MEMORY_TOKEN:-}"

  # Summary
  echo ""
  success "Cau hinh:"
  echo "  Backend      : $BACKEND_PATH"
  echo "  Frontend     : $FRONTEND_PATH"
  echo "  Memory owner : $MEMORY_OWNER"
  echo "  Memory repo  : $MEMORY_NAME"
  if [ -n "$MEMORY_TOKEN" ]; then
    echo "  Memory token : ${MEMORY_TOKEN:0:10}..."
  else
    echo -e "  Memory token : ${YELLOW}(dung gh CLI auth)${NC}"
  fi
}

# ── Cau hinh IDE ──

build_env_json() {
  local ENV_JSON="\"BUILDERX_API_PATH\": \"$BACKEND_PATH\", \"BUILDERX_SPA_PATH\": \"$FRONTEND_PATH\", \"MEMORY_REPO_OWNER\": \"$MEMORY_OWNER\", \"MEMORY_REPO_NAME\": \"$MEMORY_NAME\""
  if [ -n "$MEMORY_TOKEN" ]; then
    ENV_JSON="$ENV_JSON, \"MEMORY_REPO_TOKEN\": \"$MEMORY_TOKEN\""
  fi
  echo "$ENV_JSON"
}

configure_claude_code() {
  info "Cau hinh Claude Code..."

  if command -v claude &> /dev/null; then
    local CMD="claude mcp add shared-knowledge"
    CMD="$CMD -e BUILDERX_API_PATH=\"$BACKEND_PATH\""
    CMD="$CMD -e BUILDERX_SPA_PATH=\"$FRONTEND_PATH\""
    CMD="$CMD -e MEMORY_REPO_OWNER=\"$MEMORY_OWNER\""
    CMD="$CMD -e MEMORY_REPO_NAME=\"$MEMORY_NAME\""
    if [ -n "$MEMORY_TOKEN" ]; then
      CMD="$CMD -e MEMORY_REPO_TOKEN=\"$MEMORY_TOKEN\""
    fi
    CMD="$CMD -- \"$NODE_BIN\" \"$MCP_INDEX\""
    eval "$CMD"
    success "Claude Code da cau hinh (qua CLI)"
  else
    CLAUDE_CONFIG="$HOME/.claude.json"
    local ENV_JSON
    ENV_JSON=$(build_env_json)

    if [ -f "$CLAUDE_CONFIG" ] && [ -s "$CLAUDE_CONFIG" ]; then
      node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$CLAUDE_CONFIG', 'utf8'));
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers['shared-knowledge'] = {
          command: '$NODE_BIN',
          args: ['$MCP_INDEX'],
          env: { $ENV_JSON }
        };
        fs.writeFileSync('$CLAUDE_CONFIG', JSON.stringify(config, null, 2));
      "
    else
      cat > "$CLAUDE_CONFIG" << JSONEOF
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "$NODE_BIN",
      "args": ["$MCP_INDEX"],
      "env": { $ENV_JSON }
    }
  }
}
JSONEOF
    fi
    success "Claude Code da cau hinh ($CLAUDE_CONFIG)"
  fi
}

configure_claude_desktop() {
  info "Cau hinh Claude Desktop..."

  CLAUDE_DESKTOP_DIR="$HOME/Library/Application Support/Claude"
  if [ ! -d "$CLAUDE_DESKTOP_DIR" ]; then
    CLAUDE_DESKTOP_DIR="$HOME/.config/Claude"
  fi

  mkdir -p "$CLAUDE_DESKTOP_DIR"
  CLAUDE_DESKTOP_CONFIG="$CLAUDE_DESKTOP_DIR/claude_desktop_config.json"
  local ENV_JSON
  ENV_JSON=$(build_env_json)

  if [ -f "$CLAUDE_DESKTOP_CONFIG" ] && [ -s "$CLAUDE_DESKTOP_CONFIG" ]; then
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$CLAUDE_DESKTOP_CONFIG', 'utf8'));
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers['shared-knowledge'] = {
        command: '$NODE_BIN',
        args: ['$MCP_INDEX'],
        env: { $ENV_JSON }
      };
      fs.writeFileSync('$CLAUDE_DESKTOP_CONFIG', JSON.stringify(config, null, 2));
    "
  else
    cat > "$CLAUDE_DESKTOP_CONFIG" << JSONEOF
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "$NODE_BIN",
      "args": ["$MCP_INDEX"],
      "env": { $ENV_JSON }
    }
  }
}
JSONEOF
  fi

  success "Claude Desktop da cau hinh ($CLAUDE_DESKTOP_CONFIG)"
  warn "Khoi dong lai Claude Desktop de kich hoat"
}

configure_cursor() {
  info "Cau hinh Cursor..."

  CURSOR_DIR="$HOME/.cursor"
  mkdir -p "$CURSOR_DIR"
  CURSOR_CONFIG="$CURSOR_DIR/mcp.json"
  local ENV_JSON
  ENV_JSON=$(build_env_json)

  if [ -f "$CURSOR_CONFIG" ] && [ -s "$CURSOR_CONFIG" ]; then
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$CURSOR_CONFIG', 'utf8'));
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers['shared-knowledge'] = {
        command: '$NODE_BIN',
        args: ['$MCP_INDEX'],
        env: { $ENV_JSON }
      };
      fs.writeFileSync('$CURSOR_CONFIG', JSON.stringify(config, null, 2));
    "
  else
    cat > "$CURSOR_CONFIG" << JSONEOF
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "$NODE_BIN",
      "args": ["$MCP_INDEX"],
      "env": { $ENV_JSON }
    }
  }
}
JSONEOF
  fi

  success "Cursor da cau hinh ($CURSOR_CONFIG)"
}

configure_windsurf() {
  info "Cau hinh Windsurf..."

  WINDSURF_DIR="$HOME/.codeium/windsurf"
  mkdir -p "$WINDSURF_DIR"
  WINDSURF_CONFIG="$WINDSURF_DIR/mcp_config.json"
  local ENV_JSON
  ENV_JSON=$(build_env_json)

  if [ -f "$WINDSURF_CONFIG" ] && [ -s "$WINDSURF_CONFIG" ]; then
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$WINDSURF_CONFIG', 'utf8'));
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers['shared-knowledge'] = {
        command: '$NODE_BIN',
        args: ['$MCP_INDEX'],
        env: { $ENV_JSON }
      };
      fs.writeFileSync('$WINDSURF_CONFIG', JSON.stringify(config, null, 2));
    "
  else
    cat > "$WINDSURF_CONFIG" << JSONEOF
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "$NODE_BIN",
      "args": ["$MCP_INDEX"],
      "env": { $ENV_JSON }
    }
  }
}
JSONEOF
  fi

  success "Windsurf da cau hinh ($WINDSURF_CONFIG)"
}

configure_augment() {
  info "Cau hinh Augment (VS Code)..."

  VSCODE_DIR="$HOME/.vscode"
  if [ -d "$HOME/Library/Application Support/Code/User" ]; then
    VSCODE_DIR="$HOME/Library/Application Support/Code/User"
  elif [ -d "$HOME/.config/Code/User" ]; then
    VSCODE_DIR="$HOME/.config/Code/User"
  fi

  mkdir -p "$VSCODE_DIR"
  AUGMENT_CONFIG="$VSCODE_DIR/augment_mcp.json"
  local ENV_JSON
  ENV_JSON=$(build_env_json)

  cat > "$AUGMENT_CONFIG" << JSONEOF
{
  "mcpServers": {
    "shared-knowledge": {
      "command": "$NODE_BIN",
      "args": ["$MCP_INDEX"],
      "env": { $ENV_JSON }
    }
  }
}
JSONEOF

  success "Augment da cau hinh ($AUGMENT_CONFIG)"
  warn "Mo VS Code > Cmd+Shift+P > 'Augment: Edit MCP Settings' va paste config"
}

configure_codex() {
  info "Cau hinh Codex (OpenAI)..."

  CODEX_DIR="$HOME/.codex"
  CODEX_CONFIG="$CODEX_DIR/config.toml"
  mkdir -p "$CODEX_DIR"

  local ENV_TOML="\"BUILDERX_API_PATH\" = \"$BACKEND_PATH\", \"BUILDERX_SPA_PATH\" = \"$FRONTEND_PATH\", \"MEMORY_REPO_OWNER\" = \"$MEMORY_OWNER\", \"MEMORY_REPO_NAME\" = \"$MEMORY_NAME\""
  if [ -n "$MEMORY_TOKEN" ]; then
    ENV_TOML="$ENV_TOML, \"MEMORY_REPO_TOKEN\" = \"$MEMORY_TOKEN\""
  fi

  TOML_BLOCK=$(cat << TOMLEOF

[mcp_servers.shared-knowledge]
command = "$NODE_BIN"
args = ["$MCP_INDEX"]
env = { $ENV_TOML }
TOMLEOF
)

  if [ -f "$CODEX_CONFIG" ]; then
    if grep -q '\[mcp_servers\.shared-knowledge\]' "$CODEX_CONFIG" 2>/dev/null; then
      node -e "
        const fs = require('fs');
        let content = fs.readFileSync('$CODEX_CONFIG', 'utf8');
        content = content.replace(/\\n?\\[mcp_servers\\.shared-knowledge\\][\\s\\S]*?(?=\\n\\[|$)/, '');
        fs.writeFileSync('$CODEX_CONFIG', content.trimEnd() + '\\n');
      " 2>/dev/null
      info "Thay the config shared-knowledge cu..."
    fi
    echo "$TOML_BLOCK" >> "$CODEX_CONFIG"
  else
    echo "# Shared Knowledge MCP" > "$CODEX_CONFIG"
    echo "$TOML_BLOCK" >> "$CODEX_CONFIG"
  fi

  success "Codex da cau hinh ($CODEX_CONFIG)"
}

# ── Chon IDE ──

select_ides() {
  echo ""
  echo -e "${BOLD}── Chon IDE/Tool de cau hinh ──${NC}"
  echo ""
  echo "  1) Claude Desktop"
  echo "  2) Claude Code (CLI)"
  echo "  3) Cursor"
  echo "  4) Windsurf"
  echo "  5) Augment (VS Code)"
  echo "  6) Codex (OpenAI)"
  echo "  7) Tat ca"
  echo "  0) Bo qua (cau hinh thu cong sau)"
  echo ""
  read -rp "  Chon (phan cach bang dau phay, vd: 1,2): " IDE_CHOICE < /dev/tty

  IFS=',' read -ra CHOICES <<< "$IDE_CHOICE"

  for choice in "${CHOICES[@]}"; do
    choice=$(echo "$choice" | tr -d ' ')
    case "$choice" in
      1) configure_claude_desktop ;;
      2) configure_claude_code ;;
      3) configure_cursor ;;
      4) configure_windsurf ;;
      5) configure_augment ;;
      6) configure_codex ;;
      7)
        configure_claude_desktop
        configure_claude_code
        configure_cursor
        configure_windsurf
        configure_augment
        configure_codex
        ;;
      0) info "Bo qua cau hinh IDE." ;;
      *) warn "Lua chon khong hop le: $choice" ;;
    esac
  done
}

# ── Kiem tra cai dat ──

verify() {
  echo ""
  info "Kiem tra cai dat..."

  if [ -f "$MCP_INDEX" ]; then
    node --check "$MCP_INDEX" 2>/dev/null && success "MCP server syntax OK" || warn "Kiem tra syntax that bai"
  else
    error "Khong tim thay $MCP_INDEX"
    exit 1
  fi
}

# ── Tao repo memory ngay ──

init_memory_repo() {
  echo ""
  read -rp "  Tao repo memory tren GitHub ngay bay gio? (Y/n): " CREATE_REPO < /dev/tty
  CREATE_REPO="${CREATE_REPO:-Y}"

  if [[ "$CREATE_REPO" =~ ^[Yy]$ ]]; then
    info "Tao repo memory..."

    local MEMORY_PATH="$HOME/.shared-knowledge-memory"

    if [ -d "$MEMORY_PATH/.git" ]; then
      success "Repo memory da ton tai tai $MEMORY_PATH"
      return
    fi

    mkdir -p "$MEMORY_PATH/memories/business"
    mkdir -p "$MEMORY_PATH/memories/tasks"
    mkdir -p "$MEMORY_PATH/memories/analysis"
    mkdir -p "$MEMORY_PATH/memories/decisions"

    for dir in business tasks analysis decisions; do
      touch "$MEMORY_PATH/memories/$dir/.gitkeep"
    done

    cat > "$MEMORY_PATH/README.md" << 'READMEEOF'
# Shared Knowledge Memory

Bo nho dai han cho AI agents lam viec tren BuilderX.

## Categories

- **business/** — Nghiep vu, domain rules
- **tasks/** — Lich su task
- **analysis/** — Ket qua phan tich API
- **decisions/** — Quyet dinh kien truc
READMEEOF

    cd "$MEMORY_PATH"
    git init --quiet
    git checkout -b main 2>/dev/null
    git add -A
    git commit -m "init: shared knowledge memory" --quiet

    if [ "$HAS_GH" = true ]; then
      gh repo create "$MEMORY_OWNER/$MEMORY_NAME" --private --source="$MEMORY_PATH" --push 2>/dev/null \
        && success "Repo memory da tao: github.com/$MEMORY_OWNER/$MEMORY_NAME (private)" \
        || warn "Khong tao duoc repo tren GitHub (co the da ton tai). Memory van luu local."
    elif [ -n "$MEMORY_TOKEN" ]; then
      local REMOTE_URL="https://$MEMORY_TOKEN@github.com/$MEMORY_OWNER/$MEMORY_NAME.git"
      git remote add origin "$REMOTE_URL" 2>/dev/null || true
      git push -u origin main 2>/dev/null \
        && success "Repo memory da push len GitHub" \
        || warn "Push that bai. Kiem tra token va tao repo thu cong."
    else
      warn "Khong co gh CLI hoac token. Repo memory chi luu local."
      echo "  De push len GitHub sau, chay:"
      echo "    cd $MEMORY_PATH"
      echo "    gh repo create $MEMORY_NAME --private --source=. --push"
    fi

    cd - > /dev/null
  else
    info "Bo qua. Repo memory se duoc tao tu dong khi goi save_memory lan dau."
  fi
}

# ── Ket qua ──

print_summary() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}  Cai dat thanh cong!${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Node.js      : ${BOLD}$NODE_BIN${NC}"
  echo -e "  MCP Server   : ${BOLD}$MCP_INDEX${NC}"
  echo -e "  Backend repo : $BACKEND_PATH"
  echo -e "  Frontend repo: $FRONTEND_PATH"
  echo -e "  Memory owner : $MEMORY_OWNER"
  echo -e "  Memory repo  : $MEMORY_NAME"
  echo ""
  echo -e "  ${BOLD}13 tools san sang:${NC}"
  echo "    smart_context, analyze_impact, get_api_schema,"
  echo "    get_ui_requirements, sync_contract, search_code,"
  echo "    read_source, generate_client, generate_backend_code,"
  echo "    save_memory, recall_memory, list_memories, delete_memory"
  echo ""
  echo -e "  ${BOLD}Buoc tiep theo:${NC}"
  echo "  1. Khoi dong lai IDE"
  echo "  2. Hoi AI: \"Order API hoat dong the nao?\""
  echo ""
  echo -e "  ${BOLD}Kiem tra (Claude Code):${NC}"
  echo "    claude mcp list"
  echo ""
  echo -e "  ${BOLD}Cap nhat sau nay:${NC}"
  echo "    $INSTALL_DIR/update.sh"
  echo ""
}

# ── Go cai dat ──

uninstall() {
  print_banner
  echo -e "${BOLD}── Go cai dat Shared Knowledge MCP ──${NC}"
  echo ""

  if [ -d "$DEFAULT_INSTALL_DIR" ]; then
    read -rp "  Xoa $DEFAULT_INSTALL_DIR? (y/N): " CONFIRM < /dev/tty
    if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
      rm -rf "$DEFAULT_INSTALL_DIR"
      success "Da xoa $DEFAULT_INSTALL_DIR"
    fi
  fi

  if command -v claude &> /dev/null; then
    claude mcp remove shared-knowledge 2>/dev/null && success "Da xoa khoi Claude Code" || true
  fi

  for CONFIG_FILE in "$HOME/.cursor/mcp.json" "$HOME/.codeium/windsurf/mcp_config.json"; do
    if [ -f "$CONFIG_FILE" ]; then
      node -e "
        const fs = require('fs');
        const c = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
        if (c.mcpServers) delete c.mcpServers['shared-knowledge'];
        fs.writeFileSync('$CONFIG_FILE', JSON.stringify(c, null, 2));
      " 2>/dev/null && success "Da xoa khoi $(basename $(dirname $CONFIG_FILE))" || true
    fi
  done

  echo ""
  success "Go cai dat xong. Khoi dong lai IDE."
}

# ── Main ──

main() {
  print_banner

  if [ "${1:-}" = "--uninstall" ] || [ "${1:-}" = "uninstall" ]; then
    uninstall
    exit 0
  fi

  check_node
  check_git
  check_gh

  install_mcp
  collect_env
  select_ides
  init_memory_repo
  verify
  print_summary
}

main "$@"
