"""
routers/novels.py
-----------------
Endpoint quản lý truyện: danh sách, chi tiết, catalog, glossary.
"""

import os
import json
from typing import Dict

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from novel_manager import load_novel
from auth import require_admin
from security_utils import validate_slug, safe_novel_dir

router = APIRouter()

NOVELS_DIR = "novels"


class GlossaryUpdateRequest(BaseModel):
    glossary: Dict[str, str]


@router.get("/api/novels")
def list_novels():
    """Lấy danh sách các truyện hiện có."""
    if not os.path.exists(NOVELS_DIR):
        return []

    novels = []
    for slug in os.listdir(NOVELS_DIR):
        if os.path.isdir(os.path.join(NOVELS_DIR, slug)):
            json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
            if os.path.exists(json_path):
                with open(json_path, "r", encoding="utf-8") as f:
                    try:
                        data = json.load(f)
                        novels.append(data)
                    except json.JSONDecodeError:
                        pass
    return novels


@router.get("/api/novels/{slug}")
def get_novel(slug: str):
    """Lấy chi tiết truyện (gồm cả glossary)."""
    validate_slug(slug)
    try:
        profile = load_novel(slug)
        # Read the raw dict because load_novel returns NovelProfile object
        json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Novel not found")


@router.post("/api/novels/{slug}/glossary", dependencies=[Depends(require_admin)])
def update_glossary(slug: str, req: GlossaryUpdateRequest):
    """Cập nhật từ điển. (admin)"""
    validate_slug(slug)
    try:
        profile = load_novel(slug)
        profile.glossary = req.glossary
        profile.save()
        return {"status": "success", "message": "Glossary updated"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Novel not found")


@router.get("/api/novels/{slug}/catalog")
def get_novel_catalog(slug: str):
    """Lấy danh sách catalog chương của truyện từ catalog.json."""
    catalog_path = os.path.join(safe_novel_dir(slug), "catalog.json")
    if not os.path.exists(catalog_path):
        return []
    try:
        with open(catalog_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading catalog: {e}")
