#!/usr/bin/env bash
# Commit checkpoint nếu có thay đổi; không che lỗi add/commit/push.
set -euo pipefail
message=$1
shift
for path in "$@"; do
  if git ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
    git add -- "$path"
  elif [[ -e "$path" ]]; then
    git add -- "$path"
  fi
done
if git diff --cached --quiet; then
  echo 'Không có thay đổi để commit.'
  exit 0
fi
git -c user.name='HacDao Sync Bot' -c user.email='bot@hacdaotruyen.local' commit -m "$message"
# Nhánh có thể vừa nhận commit khác trong lúc job chạy (run 37905565041 bị
# "rejected (fetch first)" → mất commit bản dịch) → rebase rồi push lại.
branch=${GITHUB_REF_NAME:-main}
for attempt in 1 2 3; do
  if git push origin "HEAD:$branch"; then exit 0; fi
  git pull --rebase --autostash origin "$branch"
done
git push origin "HEAD:$branch"
