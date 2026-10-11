#!/usr/bin/env bash
# Commit checkpoint nếu có thay đổi; không che lỗi add/commit/push.
set -euo pipefail
# Danh tính bot cho MỌI lệnh git tạo commit (commit lẫn pull --rebase khi push
# bị từ chối). Thiếu ở bước rebase → "Committer identity unknown" và mất commit
# ngân sách (run 38111379376).
export GIT_AUTHOR_NAME='HacDao Sync Bot' GIT_AUTHOR_EMAIL='bot@hacdaotruyen.local'
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
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
git commit -m "$message"
# Nhánh có thể vừa nhận commit khác trong lúc job chạy (run 37905565041 bị
# "rejected (fetch first)" → mất commit bản dịch) → rebase rồi push lại.
branch=${GITHUB_REF_NAME:-main}
for attempt in 1 2 3; do
  if git push origin "HEAD:$branch"; then exit 0; fi
  git pull --rebase --autostash origin "$branch"
done
git push origin "HEAD:$branch"
