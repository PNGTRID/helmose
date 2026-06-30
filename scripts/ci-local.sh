#!/usr/bin/env bash
# Helmose 本地 CI —— 等价于 .github/workflows/ci.yml 的 backend + frontend 客观裁判。
# GitHub Actions 已停用（gh workflow disable），日常验证统一跑本脚本即可。
# 用法：bash scripts/ci-local.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== [1/4] Backend · cargo check --all-targets ==="
cd "$REPO_ROOT/src-tauri"
cargo check --all-targets

echo "=== [2/4] Backend · cargo test ==="
# index_real_wiki_smoke 标 #[ignore]（依赖本机 ~/wiki），cargo test 默认跳过
cargo test

echo "=== [3/4] Frontend · pnpm build (tsc -b && vite build) ==="
cd "$REPO_ROOT/frontend"
pnpm build

echo "=== [4/4] Frontend · pnpm test (vitest run) ==="
pnpm test

echo ""
echo "✅ 本地 CI 全绿（backend check + test / frontend build + test）"
