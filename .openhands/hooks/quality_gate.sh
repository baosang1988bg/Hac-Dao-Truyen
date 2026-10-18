#!/usr/bin/env bash
# Stop hook: không cho agent kết thúc khi cổng chất lượng chưa xanh
# (Definition of Done trong .specify/memory/constitution.md).
# test:worker / test:python / build chạy trong CI; ở đây giữ nhanh để không timeout.
set -u
cd "${OPENHANDS_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  # Thiếu Node thì không chặn vĩnh viễn (tránh agent kẹt vòng lặp) — chỉ cảnh báo.
  printf '{"decision":"allow","additionalContext":"CẢNH BÁO: sandbox thiếu Node/npm nên chưa chạy được npm run lint và test:frontend. Kiểm tra .openhands/setup.sh."}\n'
  exit 0
fi
[ -d frontend/node_modules ] || npm ci --prefix frontend --no-audit --no-fund >/dev/null 2>&1 || true

fail() {
  printf '{"decision":"deny","reason":"%s chưa qua. Sửa rồi mới được kết thúc."}\n' "$1"
  exit 2
}

npm run lint          >/tmp/oh_lint.log 2>&1 || { tail -40 /tmp/oh_lint.log >&2; fail "npm run lint"; }
npm run test:frontend >/tmp/oh_test.log 2>&1 || { tail -40 /tmp/oh_test.log >&2; fail "npm run test:frontend"; }
exit 0
