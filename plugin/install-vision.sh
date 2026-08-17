#!/bin/bash
# Install only the optional Qwen skill and print the exact profile patch.
# Credentials remain in the user's local Qwen configuration/environment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SKILL_HOME="${DSH_HOME:-$HOME/.dsh}/skills"
SKILL_DIR="$SKILL_HOME/qwen-mm-plugins-api"
TAG="qwen-mm-plugins-api-v1.0.3"

command -v uvx >/dev/null || {
  echo "uvx is required. Install uv first: https://docs.astral.sh/uv/"
  exit 1
}

if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  git clone --depth 1 --branch "$TAG" https://github.com/QwenLM/Qwen-MM-Plugins.git "$TMP/repo"
  mkdir -p "$SKILL_DIR"
  cp -R "$TMP/repo/src/capabilities/api/skill/." "$SKILL_DIR/"
fi

echo "Installed Qwen vision skill: $SKILL_DIR"
echo ""
echo "Add the following to your active DSH profile's cordis.patch.yml, then restart DeepSeek Harness:"
cat "$ROOT/qwen-vision.patch.yml"
echo ""
if [ -f "$HOME/.qwen-mm-plugins/config" ] || [ -n "${DASHSCOPE_API_KEY:-}" ]; then
  echo "Qwen credential configuration detected. Run the app after applying the patch."
else
  echo "No Qwen credential configuration detected. Configure DASHSCOPE_API_KEY locally; do not put it in this repository."
fi
