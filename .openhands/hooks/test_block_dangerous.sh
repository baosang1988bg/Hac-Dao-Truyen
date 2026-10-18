#!/usr/bin/env bash
# Tự kiểm hook chặn lệnh: bash .openhands/hooks/test_block_dangerous.sh
set -u
H="$(dirname "$0")/block_dangerous.sh"; fail=0
j() { python3 -c 'import json,sys;print(json.dumps({"tool_name":"terminal","tool_input":{"command":sys.argv[1]}}))' "$1"; }
t() { j "$2" | bash "$H" >/dev/null; r=$?; if [ "$r" != "$1" ]; then echo "FAIL (got $r, want $1): $2"; fail=1; fi; }
for c in "npm run deploy" "npx wrangler deploy" "wrangler d1 execute db --remote --command x" \
         "wrangler r2 object put b/k --file f" "python migrate_to_cloudflare.py" "gh workflow run x.yml" \
         "git push --force" "git push origin main" "cat .env" "cat frontend/.env" "head credentials.json"; do t 2 "$c"; done
for c in "npm run lint" "npm run test:frontend" "wrangler d1 execute db --local --command x" \
         "git push -u origin feature/x" "cat .env.example" "git status"; do t 0 "$c"; done
[ "$fail" = 0 ] && echo "block_dangerous.sh: tất cả test pass" ; exit $fail
