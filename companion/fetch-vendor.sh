#!/bin/bash
# 重建渲染 vendor 库（Resources/pet/vendor）。仓库已含 vendor 可直接构建；
# 仅在升级 marked/katex/highlight.js/dompurify 时需要重跑本脚本。
set -euo pipefail
cd "$(dirname "$0")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

npm install --cache "$TMP/.npmcache" \
  marked katex @highlightjs/cdn-assets dompurify

V="$(cd .. && pwd)/Resources/pet/vendor"
mkdir -p "$V/fonts"
cp node_modules/marked/lib/marked.umd.js "$V/marked.umd.js"
cp node_modules/katex/dist/katex.min.js "$V/katex.min.js"
cp node_modules/katex/dist/katex.min.css "$V/katex.min.css"
cp node_modules/katex/dist/fonts/*.woff "$V/fonts/" 2>/dev/null || true
cp node_modules/katex/dist/fonts/*.woff2 "$V/fonts/" 2>/dev/null || true
cp node_modules/@highlightjs/cdn-assets/highlight.min.js "$V/highlight.min.js"
cp node_modules/dompurify/dist/purify.min.js "$V/purify.min.js"

echo "==> vendor refreshed at $V"
