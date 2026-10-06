#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

(
  cd "$repo_root/jantok-backend"
  npm ci
  npm audit --omit=dev
  npm run prisma:validate
  npm run prisma:generate
  npm run format:check
  npm run lint
  npm run typecheck
  npm test
  npm run test:e2e
  npm run build
)

(
  cd "$repo_root/jantok-admin"
  npm ci
  npm audit --omit=dev
  npm run lint
  npm run typecheck
  npm run build
)

(
  cd "$repo_root/jantok-mobile"
  flutter pub get
  dart format --output=none --set-exit-if-changed lib test
  flutter analyze
  flutter test
)

docker compose --project-directory "$repo_root" config --quiet
