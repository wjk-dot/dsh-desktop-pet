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
cp Resources/pet/index.html Resources/pet/pet.css Resources/pet/pet.js Resources/pet/icon.png "$APP/Contents/Resources/pet/"

echo "==> done: $APP"
echo "运行：open $APP"
