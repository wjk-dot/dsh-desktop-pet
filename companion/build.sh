#!/bin/bash
# 构建 DeepSeekPet.app：swift build -c release + 手工组装 .app bundle。
set -euo pipefail
cd "$(dirname "$0")"

echo "==> swift build (release)"
swift build -c release

APP=build/DeepSeekPet.app
echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/pet"

cp .build/release/DeepSeekPet "$APP/Contents/MacOS/DeepSeekPet"
cp Info.plist "$APP/Contents/Info.plist"
cp Resources/icon.icns "$APP/Contents/Resources/icon.icns"
# 宠物页面 + vendor（marked/katex/highlight/dompurify）整目录拷贝
cp -R Resources/pet/. "$APP/Contents/Resources/pet/"

# TCC 把录屏授权绑定到应用的 designated requirement。只让 swift build
# 对可执行文件做临时 ad-hoc 签名，会使每次重建都得到不同 cdhash，导致
# macOS 反复把桌宠当成新应用询问权限。优先使用本机 Apple Development
# 证书对完整 bundle 签名，保持 bundle identifier + team identifier 稳定。
if [[ -z "${CODE_SIGN_IDENTITY:-}" ]]; then
  CODE_SIGN_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development:.*\)"/\1/p' | head -n 1 || true)"
fi
if [[ -z "$CODE_SIGN_IDENTITY" ]]; then
  echo "error: no Apple Development signing identity found; cannot build a stable TCC identity" >&2
  exit 1
fi
codesign --force --sign "$CODE_SIGN_IDENTITY" --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

echo "==> done: $APP"
echo "运行：open $APP"
