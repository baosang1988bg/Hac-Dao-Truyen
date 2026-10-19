# Áp dụng `/speckit-auto` (Multi-Provider Agent Swarm) cho dự án khác

> Swarm hiện nằm ở `tools/swarm/` của HacDaoTruyen (nhánh `main`).
> Khoảng 80% code là phần chung (adapter 5 hãng AI, ngân sách, git worktree, gate duyệt,
> dashboard, công cụ agent); 20% gắn với HacDaoTruyen và phải sửa khi chuyển sang dự án khác.
>
> Có 2 cách:
> - **Cách 1 — Copy & chỉnh** (~30 phút/dự án): làm được ngay, mỗi dự án giữ 1 bản sao.
> - **Cách 2 — Tách thành công cụ dùng chung**: cài 1 lần, mỗi dự án chỉ cần 1 file `.swarm.toml`.
>   Cần refactor ~1–2 giờ (nhờ Claude làm). Nên chọn khi dùng cho ≥ 2 dự án.

---

## 1. Điều kiện để dự án dùng được swarm

| Điều kiện | Lý do |
|---|---|
| Là **git repo** | Mỗi run tạo `git worktree` + nhánh `feature/NNN-…` riêng |
| Có lệnh **lint / test / build chạy được từ dòng lệnh, không cần tương tác** | Đây là "cổng chất lượng" để agent tự kiểm tra |
| Test chạy **headless** (không mở trình duyệt/emulator thật) | Agent chạy test trong tiến trình con |
| Secret nằm trong file **không được commit** (`.env`, …) | Worktree chỉ chứa file đã track → agent không thấy secret |
| Python 3.11+, git, Node (nếu dự án JS) trên máy chạy swarm | |

---

## 2. Bản đồ những chỗ gắn với HacDaoTruyen

| # | File | Đang gắn với HacDaoTruyen | Đổi thành |
|---|---|---|---|
| 1 | `prompts.py` → `COMMON_RULES` | React 18, Cloudflare Worker, quy tắc D1/R2 | Stack + quy ước của dự án mới |
| 2 | `sandbox.py` → `_checks()` | `npm run lint`, `test:frontend`, `test:worker`, `pytest`, `build --prefix frontend` | Lệnh lint/test/build của dự án mới |
| 3 | `pipeline.py` → `needed_checks()` | Chọn check theo thư mục `src/`, `frontend/`, file `.py` | Thư mục tương ứng của dự án mới |
| 4 | `sandbox.py` → `SECRET_NAMES`, `DENY_*` | `wrangler.jsonc`, `deploy.bat`, `key_status.json`, `tools/private/` | File secret + file deploy/native của dự án mới |
| 5 | `context.py` → `NOISY_PREFIXES`, `ALWAYS` | `novels/`, `AgentReach/`, `wrangler.jsonc` | Thư mục lớn/sinh tự động của dự án mới |
| 6 | `agents.toml` → `[run] worktree_root` | `../HacDaoTruyen-swarm` | `../<TenDuAn>-swarm` |
| 7 | `dashboard/index.html` | Tiêu đề "HacDao Swarm" | Tuỳ chọn |
| 8 | `prompts.py` → `CODER_SYSTEM` (bước 4) | Nhắc tên check `test_frontend / test_worker / test_python` | Tên check mới |

**Lưu ý kỹ thuật**
- Code import theo đường dẫn `tools.swarm` → ở dự án mới **giữ đúng vị trí `tools/swarm/`** (Cách 1).
- Luôn giữ một check tên **`lint`**: pipeline gọi Healer khi `lint` đỏ, và chế độ demo cũng gọi `lint`.
- Trường `needs` trong `_checks()` quyết định chỗ tự chạy `npm ci`: `"frontend"` = `frontend/node_modules`,
  `"root"` = `node_modules` ở gốc. App Ionic/React Native một khối → dùng `"root"`.

---

## 3. Cách 1 — Copy & chỉnh (từng bước)

### Bước 1. Chép file từ HacDaoTruyen sang dự án mới

```bash
# từ thư mục HacDaoTruyen (nhánh main)
NEW=../MyApp
mkdir -p $NEW/tools $NEW/.claude/skills
cp -r tools/swarm                     $NEW/tools/
cp -r .claude/skills/speckit-auto     $NEW/.claude/skills/
cp -r .specify/templates              $NEW/.specify/templates     # spec/plan/tasks template
# Antigravity (nếu dùng):
mkdir -p $NEW/.agents/skills && cp -r .agents/skills/speckit-auto $NEW/.agents/skills/
# Test (tuỳ chọn, nhớ sửa test_write_blocked theo danh sách cấm mới):
mkdir -p $NEW/tests && cp -r tests/swarm $NEW/tests/
```

Nếu dự án mới muốn dùng đủ bộ Spec Kit (`/speckit-specify`, `/speckit-plan`…), chạy
`specify init --here` trong dự án đó thay vì chỉ chép `templates`.

### Bước 2. `.gitignore`

```gitignore
.swarm/
.env.swarm
```

### Bước 3. Sửa 8 chỗ ở mục 2 — dùng mẫu theo stack ở mục 4

### Bước 4. Hiến pháp dự án (khuyến nghị)

Tạo `.specify/memory/constitution.md` và `AGENTS.md` ở gốc: stack, quy ước code, những gì cấm.
Spec Lead và Architect luôn đọc 2 file này (danh sách `ALWAYS` trong `context.py`).

### Bước 5. Chạy thử

```bash
cp tools/swarm/env.swarm.example .env.swarm   # điền key
python -m tools.swarm check
python -m tools.swarm demo                    # miễn phí, kiểm tra dashboard
python -m tools.swarm check --ping            # gọi thử model (< 1 cent)
python -m tools.swarm auto --budget 1 "Mô tả một tính năng nhỏ"
```

---

## 4. Mẫu cấu hình theo stack

### 4.1. Ionic + Angular + Capacitor

**`sandbox.py` → `_checks()`**

```python
def _checks() -> dict[str, dict]:
    return {
        "lint": {"desc": "ng lint (ESLint)",
                 "argv": lambda: [_which("npm"), "run", "lint"], "needs": ["root"]},
        "test_unit": {"desc": "Karma/Jest headless",
                      "argv": lambda: [_which("npm"), "test", "--", "--watch=false",
                                       "--browsers=ChromeHeadless"], "needs": ["root"]},
        "build_web": {"desc": "ng build (KHÔNG cap sync / build native)",
                      "argv": lambda: [_which("npm"), "run", "build"], "needs": ["root"]},
    }
```

> Dùng Jest thay Karma thì đổi lệnh `test_unit` thành `[npm, "test", "--", "--ci"]`.

**`pipeline.py` → `needed_checks()`**

```python
def needed_checks(self) -> list[str]:
    changed = self.ws.changed_files()
    checks = ["lint", "test_unit"]
    if any(f.startswith("src/") for f in changed):
        checks.append("build_web")
    return checks
```

**`sandbox.py` → danh sách cấm**

```python
SECRET_NAMES = {".env", ".env.swarm", "google-services.json", "GoogleService-Info.plist",
                "keystore.properties", "credentials.json", ".npmrc", "id_rsa", "id_ed25519"}
DENY_ALL_PREFIXES = (".git/", "node_modules/", ".swarm/", "www/", ".angular/")
DENY_WRITE_PREFIXES = (".github/workflows/", "tools/swarm/", "android/", "ios/",
                       "src/environments/environment.prod")
DENY_WRITE_FILES = {"capacitor.config.ts", "capacitor.config.json", "package-lock.json",
                    "fastlane/Fastfile"}
```

> Thêm đuôi `.jks`, `.keystore`, `.p12`, `.mobileprovision` vào `SKIP_SUFFIXES` trong `context.py`.

**`context.py`**

```python
NOISY_PREFIXES = ("www/", "android/", "ios/", ".angular/", "resources/", "coverage/")
ALWAYS = ["AGENTS.md", ".specify/memory/constitution.md", "package.json",
          "angular.json", "capacitor.config.ts", "ionic.config.json"]
```

**`prompts.py` → `COMMON_RULES`**

```python
COMMON_RULES = """Quy tắc dự án MyIonicApp (bắt buộc):
- Viết tài liệu, comment bằng TIẾNG VIỆT; tên biến/hàm, log, lệnh giữ tiếng Anh.
- Ionic 8 + Angular 18 standalone components, Signals cho state cục bộ, RxJS cho luồng async.
- Capacitor 6: gọi plugin native qua service bọc (vd CameraService), không gọi trực tiếp trong component.
- KHÔNG sửa android/, ios/, capacitor.config.ts; không chạy cap sync / build native.
- Dùng component Ionic có sẵn (ion-*) trước khi tự viết; tôn trọng safe-area và dark mode.
- Không thêm dependency mới nếu plan.md chưa lý giải rõ.
- Definition of Done: `npm run lint` sạch, `npm test` pass, `npm run build` thành công.
"""
```

### 4.2. React Native (TypeScript)

**`sandbox.py` → `_checks()`**

```python
def _checks() -> dict[str, dict]:
    return {
        "lint": {"desc": "ESLint + TypeScript",
                 "argv": lambda: [_which("npm"), "run", "lint"], "needs": ["root"]},
        "typecheck": {"desc": "tsc --noEmit",
                      "argv": lambda: [_which("npx"), "tsc", "--noEmit"], "needs": ["root"]},
        "test_unit": {"desc": "Jest",
                      "argv": lambda: [_which("npx"), "jest", "--ci"], "needs": ["root"]},
    }
```

**`pipeline.py` → `needed_checks()`**: `return ["lint", "typecheck", "test_unit"]`

**Danh sách cấm**

```python
DENY_ALL_PREFIXES = (".git/", "node_modules/", ".swarm/", "ios/Pods/", "android/build/", "android/app/build/")
DENY_WRITE_PREFIXES = (".github/workflows/", "tools/swarm/", "android/", "ios/")
DENY_WRITE_FILES = {"app.json", "eas.json", "package-lock.json", "yarn.lock", "Podfile.lock"}
```

**`context.py`**: `NOISY_PREFIXES = ("android/", "ios/", "coverage/", "assets/fonts/")`

> Không cho agent chạy `pod install`, `gradlew`, `xcodebuild`, Metro hay emulator: chậm, cần
> chứng chỉ ký app, lỗi native agent khó tự sửa. Phần native để người làm.

### 4.3. Backend Python (FastAPI)

```python
def _checks() -> dict[str, dict]:
    return {
        "lint": {"desc": "ruff", "argv": lambda: [sys.executable, "-m", "ruff", "check", "."], "needs": []},
        "test_python": {"desc": "pytest", "argv": lambda: [sys.executable, "-m", "pytest", "-q", "-x"], "needs": []},
    }
```

---

## 5. Chọn model và ngân sách theo dự án

Sửa `tools/swarm/agents.toml`:

- `[run] budget_usd` — dự án nhỏ để $1, tính năng lớn $3–5.
- `[roles.spec] context_budget_tokens` — repo nhỏ (< 200 file) có thể tăng lên 120k để Spec Lead hiểu toàn bộ code.
- Không có key của hãng nào → bỏ model đó khỏi `models = [...]` của vai trò (vd QA chỉ dùng Claude:
  `models = ["anthropic/claude-sonnet-5-5"]`).
- Không có GPU → Healer dùng `models = ["anthropic/claude-sonnet-5-5"]`.

---

## 6. Checklist áp dụng cho một dự án mới

- [ ] Dự án là git repo, `git status` sạch
- [ ] Lệnh lint / test / build chạy được headless từ dòng lệnh
- [ ] Đã chép `tools/swarm/`, `.specify/templates/`, skill `speckit-auto`
- [ ] Đã thêm `.swarm/`, `.env.swarm` vào `.gitignore`
- [ ] Đã sửa `COMMON_RULES`, `_checks()`, `needed_checks()`, danh sách cấm, `NOISY_PREFIXES`/`ALWAYS`, `worktree_root`
- [ ] Còn check tên `lint`; tên check trong `CODER_SYSTEM` khớp `_checks()`
- [ ] Có `AGENTS.md` + `.specify/memory/constitution.md`
- [ ] `python -m tools.swarm check` xanh
- [ ] `python -m tools.swarm demo` ra `✅ Hoàn tất`
- [ ] `check --ping` đủ ✅
- [ ] Chạy thật 1 tính năng nhỏ với `--budget 1`, review diff trong worktree

---

## 7. Cách 2 — Tách thành công cụ dùng chung (đề xuất)

Mục tiêu: không phải copy và sửa code nữa; mọi thứ riêng của dự án nằm trong 1 file ở repo dự án.

```toml
# .swarm.toml (commit trong repo dự án)
[project]
name = "MyIonicApp"
rules = """Ionic 8 + Angular 18 standalone, Capacitor 6.
Không sửa android/ ios/ capacitor.config.ts."""
deny_write = ["android/", "ios/", "capacitor.config.ts"]
secrets = ["google-services.json", "GoogleService-Info.plist"]
noisy_dirs = ["www/", "android/", "ios/", ".angular/"]
always_read = ["angular.json", "capacitor.config.ts"]

[checks]
lint      = { cmd = "npm run lint" }
test_unit = { cmd = "npm test -- --watch=false --browsers=ChromeHeadless" }
build_web = { cmd = "npm run build", when = ["src/"] }

[run]
budget_usd = 1.5
```

Cách dùng sau khi tách:

```bash
pipx install git+https://github.com/<ban>/speckit-swarm   # cài 1 lần cho mọi dự án
cd MyIonicApp
swarm init          # sinh .swarm.toml mẫu theo stack phát hiện được (Ionic / RN / Python)
swarm check --ping
swarm auto "Mô tả tính năng"
```

So sánh với thứ bạn quen: giống tách một Angular service dùng chung thành npm package có
`forRoot(config)` — logic nằm trong package, mỗi app chỉ khai báo cấu hình.

Việc cần làm cho Cách 2 (nhờ Claude):
1. Tách `tools/swarm/` thành repo `speckit-swarm` (package Python, lệnh `swarm`).
2. Chuyển 8 chỗ ở mục 2 sang đọc từ `.swarm.toml`; giá model/provider vẫn ở cấu hình chung của người dùng.
3. Lệnh `swarm init` tự nhận stack và sinh `.swarm.toml` mẫu.
4. HacDaoTruyen chuyển sang dùng bản chung (giữ `.swarm.toml` tương đương cấu hình hiện tại).
