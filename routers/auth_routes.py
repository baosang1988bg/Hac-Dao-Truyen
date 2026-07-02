"""
routers/auth_routes.py
----------------------
Endpoint xác thực admin: login / logout / verify.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import login as auth_login, logout as auth_logout, require_admin

router = APIRouter()


class LoginRequest(BaseModel):
    password: str


@router.post("/api/auth/login")
def api_login(req: LoginRequest):
    """Đăng nhập admin — mật khẩu kiểm tra ở server, trả về Bearer token."""
    token = auth_login(req.password)
    return {"status": "success", "token": token}


@router.post("/api/auth/logout")
def api_logout(token: str = Depends(require_admin)):
    auth_logout(token)
    return {"status": "success"}


@router.get("/api/auth/verify")
def api_verify(token: str = Depends(require_admin)):
    """Kiểm tra token còn hạn không (frontend gọi khi khởi động)."""
    return {"status": "valid"}
