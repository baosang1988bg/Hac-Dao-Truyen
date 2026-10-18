#!/usr/bin/env bash
# OpenHands chạy file này mỗi khi bắt đầu làm việc với repo (xem docs OpenHands
# "Repository Customization"). Sandbox mặc định là image Python, nên cài Node 22
# (giống CI) để chạy được cổng chất lượng npm run lint / test:frontend.
set -u
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$major" -ge 20 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null \
    && sudo apt-get install -y nodejs >/dev/null
fi
# Chỉ cài dependency frontend (đủ cho lint + test:frontend). KHÔNG cài wrangler
# toàn cục, KHÔNG nạp .env — sandbox không được có quyền ghi production.
npm ci --prefix frontend --no-audit --no-fund >/dev/null 2>&1 || echo "setup: npm ci frontend lỗi" >&2
