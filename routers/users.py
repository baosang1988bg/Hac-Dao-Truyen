"""
routers/users.py
----------------
API tài khoản người dùng (roadmap 3.1–3.4): đăng ký/đăng nhập,
bookmark, tiến độ đọc, bình luận.

Hợp đồng API này được Worker Cloudflare (D1) và frontend làm theo —
đổi shape ở đây phải đổi cả hai nơi kia.
"""

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

import user_store
from auth import _is_valid as _is_admin_token, require_admin
from security_utils import validate_slug

router = APIRouter()

# Giới hạn nội dung comment
MAX_COMMENT_LENGTH = 2000
MIN_PASSWORD_LENGTH = 8

# Giới hạn form "Request Novel"
MAX_REQUEST_URL_LENGTH = 500
MAX_REQUEST_NOTE_LENGTH = 500
NOVEL_REQUEST_STATUSES = {"approved", "rejected"}


# ── Auth helpers ─────────────────────────────────────────────────────────────

def _bearer_token(authorization: str) -> str:
    """Tách token từ header Authorization; chuỗi rỗng nếu thiếu/sai format."""
    if not authorization.startswith("Bearer "):
        return ""
    return authorization[len("Bearer "):].strip()


def require_user(authorization: str = Header(default="")) -> dict:
    """Dependency — trả về dict user {id,email,name}, raise 401 nếu không hợp lệ."""
    token = _bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Thiếu token xác thực")
    user = user_store.get_user_by_token(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Token không hợp lệ hoặc đã hết hạn")
    return user


# ── Models ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


class ProgressRequest(BaseModel):
    chapter: int


class CommentRequest(BaseModel):
    chapter: int
    content: str


class NovelRequestCreate(BaseModel):
    url: str
    note: str = ""


class NovelRequestReview(BaseModel):
    status: str
    admin_note: str = ""


# ── Auth endpoints ───────────────────────────────────────────────────────────

@router.post("/api/user/register", status_code=201)
def register(req: RegisterRequest):
    """Đăng ký tài khoản mới — trả token + thông tin user."""
    email = req.email.strip().lower()
    if not user_store.is_valid_email(email):
        raise HTTPException(status_code=400, detail="Email không hợp lệ")
    if len(req.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Mật khẩu phải có ít nhất {MIN_PASSWORD_LENGTH} ký tự",
        )
    user = user_store.create_user(email, req.password, req.name.strip())
    if user is None:
        raise HTTPException(status_code=409, detail="Email đã được đăng ký")
    token = user_store.create_session(user["id"])
    return {"token": token, "user": user}


@router.post("/api/user/login")
def login(req: LoginRequest):
    """Đăng nhập — trả token + thông tin user, 401 nếu sai."""
    user = user_store.authenticate(req.email.strip().lower(), req.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Sai email hoặc mật khẩu")
    token = user_store.create_session(user["id"])
    return {"token": token, "user": user}


@router.post("/api/user/logout")
def logout(user: dict = Depends(require_user), authorization: str = Header(default="")):
    """Đăng xuất — hủy session hiện tại."""
    user_store.delete_session(_bearer_token(authorization))
    return {"ok": True}


@router.get("/api/user/me")
def me(user: dict = Depends(require_user)):
    """Thông tin user hiện tại."""
    return user


# ── Bookmarks ────────────────────────────────────────────────────────────────

@router.get("/api/user/bookmarks")
def get_bookmarks(user: dict = Depends(require_user)):
    """Danh sách truyện đã bookmark."""
    return user_store.list_bookmarks(user["id"])


@router.put("/api/user/bookmarks/{slug}")
def put_bookmark(slug: str, user: dict = Depends(require_user)):
    """Thêm bookmark (idempotent)."""
    validate_slug(slug)
    user_store.add_bookmark(user["id"], slug)
    return {"ok": True}


@router.delete("/api/user/bookmarks/{slug}")
def delete_bookmark(slug: str, user: dict = Depends(require_user)):
    """Xóa bookmark."""
    validate_slug(slug)
    user_store.remove_bookmark(user["id"], slug)
    return {"ok": True}


# ── Reading progress ─────────────────────────────────────────────────────────

@router.get("/api/user/progress")
def get_progress(user: dict = Depends(require_user)):
    """Tiến độ đọc của user."""
    return user_store.list_progress(user["id"])


@router.put("/api/user/progress/{slug}")
def put_progress(slug: str, req: ProgressRequest, user: dict = Depends(require_user)):
    """Upsert tiến độ đọc một truyện."""
    validate_slug(slug)
    user_store.set_progress(user["id"], slug, req.chapter)
    return {"ok": True}


# ── Comments ─────────────────────────────────────────────────────────────────

@router.get("/api/novels/{slug}/comments")
def get_comments(slug: str, chapter: int | None = None):
    """Comment của một truyện (public), mới nhất trước, tối đa 100."""
    validate_slug(slug)
    return user_store.list_comments(slug, chapter, limit=100)


@router.post("/api/novels/{slug}/comments", status_code=201)
def post_comment(slug: str, req: CommentRequest, user: dict = Depends(require_user)):
    """Đăng comment — chống spam: mỗi user 1 comment / 20 giây."""
    validate_slug(slug)
    content = req.content.strip()
    if not content or len(content) > MAX_COMMENT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Nội dung phải từ 1 đến {MAX_COMMENT_LENGTH} ký tự",
        )
    if user_store.user_commented_recently(user["id"]):
        raise HTTPException(
            status_code=429, detail="Bạn comment quá nhanh, thử lại sau 20 giây"
        )
    comment_id = user_store.add_comment(user["id"], slug, req.chapter, content)
    return {"id": comment_id}


@router.delete("/api/comments/{comment_id}")
def delete_comment(comment_id: int, authorization: str = Header(default="")):
    """Xóa comment — cho phép admin HOẶC chính chủ comment."""
    token = _bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Thiếu token xác thực")
    comment = user_store.get_comment(comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy comment")
    user = user_store.get_user_by_token(token)
    if (user and user["id"] == comment["user_id"]) or _is_admin_token(token):
        user_store.delete_comment(comment_id)
        return {"ok": True}
    raise HTTPException(status_code=403, detail="Không có quyền xóa comment này")


# ── Request Novel ────────────────────────────────────────────────────────────
# Độc giả đã đăng nhập gửi URL truyện Trung muốn dịch; admin xem danh sách và
# duyệt/từ chối. Duyệt CHỈ đổi trạng thái trong DB — KHÔNG tự động gọi scraper
# hay import (tránh SSRF/rủi ro tự động hóa); admin vẫn phải tự chạy
# `python main.py import --url ...` thủ công sau khi duyệt.

@router.post("/api/novel-requests", status_code=201)
def create_novel_request(req: NovelRequestCreate, user: dict = Depends(require_user)):
    """Gửi yêu cầu truyện mới — chống spam: tối đa 3 request đang pending/user."""
    url = req.url.strip()
    note = req.note.strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(
            status_code=400, detail="URL phải bắt đầu bằng http:// hoặc https://"
        )
    if not (1 <= len(url) <= MAX_REQUEST_URL_LENGTH):
        raise HTTPException(
            status_code=400,
            detail=f"URL phải từ 1 đến {MAX_REQUEST_URL_LENGTH} ký tự",
        )
    if len(note) > MAX_REQUEST_NOTE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Ghi chú tối đa {MAX_REQUEST_NOTE_LENGTH} ký tự",
        )
    if user_store.count_pending_requests(user["id"]) >= user_store.MAX_PENDING_NOVEL_REQUESTS:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Bạn đang có {user_store.MAX_PENDING_NOVEL_REQUESTS} yêu cầu chờ duyệt. "
                "Vui lòng đợi admin xử lý trước khi gửi thêm."
            ),
        )
    request_id, auto_rejected = user_store.create_novel_request(user["id"], url, note)
    if auto_rejected:
        # Race: 2 request gửi gần nhau cùng qua được check phía trên, nhưng khi
        # insert xong đếm lại thì đã vượt giới hạn — user_store đã tự reject
        # request vừa tạo, ở đây chỉ cần báo lỗi cho client.
        raise HTTPException(
            status_code=429,
            detail=(
                f"Bạn đang có {user_store.MAX_PENDING_NOVEL_REQUESTS} yêu cầu chờ duyệt. "
                "Vui lòng đợi admin xử lý trước khi gửi thêm."
            ),
        )
    return {"id": request_id}


@router.get("/api/novel-requests/mine")
def list_my_novel_requests(user: dict = Depends(require_user)):
    """Danh sách yêu cầu của chính user, mới nhất trước."""
    return user_store.list_my_requests(user["id"])


@router.get("/api/admin/novel-requests", dependencies=[Depends(require_admin)])
def list_all_novel_requests(status: str | None = None):
    """Danh sách TẤT CẢ yêu cầu (admin), lọc theo status nếu truyền, kèm email."""
    return user_store.list_all_requests(status)


@router.post("/api/admin/novel-requests/{request_id}/review", dependencies=[Depends(require_admin)])
def review_novel_request(request_id: int, req: NovelRequestReview):
    """Duyệt/từ chối 1 yêu cầu — chỉ đổi trạng thái, KHÔNG tự động import."""
    if req.status not in NOVEL_REQUEST_STATUSES:
        raise HTTPException(
            status_code=400, detail="status chỉ nhận 'approved' hoặc 'rejected'"
        )
    admin_note = req.admin_note.strip()
    if len(admin_note) > MAX_REQUEST_NOTE_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Ghi chú admin tối đa {MAX_REQUEST_NOTE_LENGTH} ký tự",
        )
    result = user_store.review_novel_request(request_id, req.status, admin_note)
    if result is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu")
    if result is False:
        raise HTTPException(status_code=409, detail="Yêu cầu này đã được xử lý trước đó")
    return {"ok": True}
