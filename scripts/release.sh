#!/usr/bin/env bash
# Brett release script — builds and publishes desktop and/or iOS locally.
#
# Usage:
#   scripts/release.sh desktop    # Build signed + notarized DMG/ZIP, upload to Railway
#   scripts/release.sh ios        # Build IPA, upload to TestFlight via Fastlane
#   scripts/release.sh all        # Both, sequentially
#
# One-time setup:
#   1. Store notarization credentials in the login keychain:
#        xcrun notarytool store-credentials "brett-notarize" \
#          --apple-id brentbarkman@gmail.com \
#          --team-id FQUJNV9M6S \
#          --password <app-specific-password>
#      (Generate the app-specific password at appleid.apple.com → Sign-In and Security.)
#   2. Install Fastlane deps: cd apps/ios && bundle install
#   3. Drop the App Store Connect API key .p8 at:
#        apps/ios/fastlane/AuthKey_6H9C24ZV75.p8
#   4. Set Railway release storage env vars in ~/.config/brett/release.env:
#        RELEASE_STORAGE_ENDPOINT=https://...
#        RELEASE_STORAGE_ACCESS_KEY=...
#        RELEASE_STORAGE_SECRET_KEY=...
#        RELEASE_STORAGE_BUCKET=brett-releases
#        VITE_API_URL=https://api.brett.brentbarkman.com

set -euo pipefail

TARGET="${1:-}"
if [[ "$TARGET" != "desktop" && "$TARGET" != "ios" && "$TARGET" != "all" ]]; then
  echo "Usage: $0 {desktop|ios|all}" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Load release env vars from ~/.config/brett/release.env if present.
# Keeps S3 credentials out of the repo and out of your shell history.
RELEASE_ENV="${HOME}/.config/brett/release.env"
if [[ -f "$RELEASE_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$RELEASE_ENV"
  set +a
fi

# Branch guard — desktop/iOS releases must come from the release branch so
# the binaries match the API version CI deployed. Override for emergencies
# only with ALLOW_ANY_BRANCH=1.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "release" && -z "${ALLOW_ANY_BRANCH:-}" ]]; then
  echo "Error: not on release branch (currently on '$CURRENT_BRANCH')." >&2
  echo "Desktop/iOS releases must come from release to match what the API deployed." >&2
  echo "Override (emergencies only): ALLOW_ANY_BRANCH=1 $0 $*" >&2
  exit 1
fi

if [[ -z "${ALLOW_ANY_BRANCH:-}" ]]; then
  git fetch origin release --quiet
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/release)" ]]; then
    echo "Error: local release is not in sync with origin/release." >&2
    echo "Run: git pull origin release" >&2
    exit 1
  fi
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree has uncommitted changes. Commit or stash before releasing." >&2
  exit 1
fi

release_desktop() {
  echo "=== Desktop release ==="

  # Auto-bump version using the same formula CI used: base major.minor from
  # package.json + commit count as patch. Mutates package.json in place but
  # we do NOT commit it — the version is ephemeral, pinned by the build.
  local BASE PATCH VERSION
  BASE=$(node -p "require('./apps/desktop/package.json').version.split('.').slice(0,2).join('.')")
  PATCH=$(git rev-list --count HEAD)
  VERSION="${BASE}.${PATCH}"
  echo "Desktop version: $VERSION"

  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('apps/desktop/package.json', 'utf-8'));
    pkg.version = '${VERSION}';
    fs.writeFileSync('apps/desktop/package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

  # Guarantee we revert the version bump even if the build fails, so
  # git history stays clean across iterations. The trap runs from whatever
  # cwd we're in at exit time (likely apps/desktop/ after pushd), so use
  # `git -C "$ROOT_DIR"` to pin the path resolution to the repo root.
  trap "git -C '$ROOT_DIR' checkout -- apps/desktop/package.json" EXIT

  pnpm --filter @brett/api exec prisma generate
  pnpm build

  pushd apps/desktop > /dev/null
  node -e "
    const fs = require('fs');
    fs.writeFileSync('dist/electron/api-config.json', JSON.stringify({
      apiURL: process.env.VITE_API_URL || 'http://localhost:3001'
    }));
  "
  node scripts/copy-electron-deps.js

  # APPLE_KEYCHAIN_PROFILE points electron-builder's notarize step at the
  # notarytool keychain profile set up during one-time setup.
  APPLE_KEYCHAIN_PROFILE="brett-notarize" \
    npx electron-builder --mac --publish never

  popd > /dev/null

  npx tsx scripts/upload-release.ts

  echo "✓ Desktop v${VERSION} published"
}

release_ios() {
  echo "=== iOS release ==="

  if ! command -v bundle > /dev/null; then
    echo "bundler not installed. Run: gem install bundler" >&2
    exit 1
  fi

  pushd apps/ios > /dev/null
  bundle exec fastlane ios beta
  popd > /dev/null

  echo "✓ iOS uploaded to TestFlight"
}

case "$TARGET" in
  desktop) release_desktop ;;
  ios)     release_ios ;;
  all)     release_desktop; release_ios ;;
esac
