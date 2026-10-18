#!/usr/bin/env bash
# PreToolUse hook (OpenHands, tương thích Claude Code hooks):
# chặn cứng các lệnh chạm production hoặc đọc secret.
# Đây là lớp phòng thủ THỨ HAI — lớp chính là không đưa token/secret vào sandbox
# (xem docs/RUNBOOK_OPENHANDS.md). Quét toàn bộ payload JSON nên bắt được cả
# lệnh terminal lẫn đường dẫn file mà tool đọc/sửa.
set -u
payload="$(cat)"

deny() {
  printf '{"decision":"deny","reason":"%s"}\n' "$1"
  exit 2
}

# Gộp khoảng trắng để chống lách kiểu "npm   run  deploy".
flat="$(printf '%s' "$payload" | tr -s '[:space:]' ' ')"

check() { printf '%s' "$flat" | grep -Eiq -- "$1"; }

check 'npm( --?[a-z-]+)* run(-script)? deploy'            && deny "Cấm deploy production từ agent (npm run deploy)."
check 'wrangler([^"]*)? (deploy|publish|versions deploy|rollback)' && deny "Cấm wrangler deploy/publish từ agent."
check 'wrangler([^"]*)? secret'                            && deny "Cấm thao tác secret Cloudflare từ agent."
check 'wrangler([^"]*)? r2 object (put|delete)'            && deny "Cấm ghi/xoá object R2 production từ agent."
check 'wrangler([^"]*)? d1 [^"]*--remote'                  && deny "Cấm thao tác D1 remote từ agent."
check 'deploy\.bat|migrate_to_cloudflare\.py'              && deny "Cấm đồng bộ D1/R2 production từ agent."
check 'gh (workflow run|variable set|secret (set|delete))' && deny "Cấm kích hoạt workflow/đổi biến GitHub từ agent."
check 'git push[^"]*(--force|-f( |$)|--force-with-lease)'  && deny "Cấm git push --force."
check 'git push[^"]*( |:)(refs/heads/)?main( |"|$)'        && deny "Cấm push thẳng lên main — tạo nhánh feature/… hoặc chore/…."
check '(^|[^A-Za-z0-9_.-])(\.env|\.dev\.vars|credentials\.json|key_status\.json)([^A-Za-z0-9_.-]|$)' \
  && deny "Cấm đọc/sửa file secret (.env, .dev.vars, credentials.json, key_status.json)."

exit 0
