#!/usr/bin/env bash
# Build the Story Builder Android debug APK.
#
# Assembles the web app (webapp/www), syncs it into the Capacitor Android
# project, and builds a debug APK. Requires Android SDK + JDK 21.
set -euo pipefail
cd "$(dirname "$0")"

# --- Toolchain locations (override via env if yours differ) ---
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

# Find a JDK 21 (Capacitor 8 plugins require it).
if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q 'version "21'; then
  for cand in \
    /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    "$(/usr/libexec/java_home -v 21 2>/dev/null || true)" \
    /Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home; do
    if [ -n "$cand" ] && [ -x "$cand/bin/java" ]; then export JAVA_HOME="$cand"; break; fi
  done
fi
echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"

# 1. Assemble web assets (engine bundle + seed data + www).
echo "==> Assembling web app..."
node build-webapp.js
node build-seed.js
node build-www.js

# 2. Sync into the Android project.
echo "==> Syncing Capacitor..."
npx cap sync android

# 3. Build the debug APK.
echo "==> Building APK..."
( cd android && ./gradlew assembleDebug )

APK="android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then
  echo ""
  echo "APK built: $APK"
  echo "Install with: adb install -r \"$APK\""
else
  echo "Build finished but APK not found at $APK" >&2
  exit 1
fi
