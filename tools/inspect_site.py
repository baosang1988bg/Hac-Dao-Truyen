import sys as _sys, os as _os; _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))  # cho phép import module ở root
"""
inspect_site.py — chạy một lần để xem HTML structure của 69shuba.com
Chạy: python inspect_site.py
"""
import asyncio
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
from config import USER_AGENT

URL = "https://www.69shuba.com/txt/43484/28931795"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(user_agent=USER_AGENT)
        page = await context.new_page()

        print(f"Navigating to {URL}...")
        await page.goto(URL, wait_until="networkidle", timeout=60000)
        await asyncio.sleep(4)

        html = await page.content()
        await browser.close()

    soup = BeautifulSoup(html, "html.parser")

    print("\n=== TITLE candidates ===")
    for tag in ["h1", "h2", "h3"]:
        for e in soup.find_all(tag)[:3]:
            print(f"  <{tag}>: {e.get_text(strip=True)[:100]}")

    print("\n=== Elements with id= containing long text ===")
    for elem in soup.find_all(id=True):
        txt = elem.get_text(strip=True)
        if len(txt) > 200:
            print(f"  id=\"{elem['id']}\"  len={len(txt)}  preview: {txt[:80]!r}")

    print("\n=== Elements with class= containing long text ===")
    seen = set()
    for elem in soup.find_all(class_=True):
        cls = " ".join(elem.get("class", []))
        if cls in seen:
            continue
        txt = elem.get_text(strip=True)
        if len(txt) > 200:
            seen.add(cls)
            print(f"  class=\"{cls}\"  len={len(txt)}  preview: {txt[:80]!r}")

    print("\n=== Navigation / prev-next links ===")
    for a in soup.find_all("a", href=True):
        txt = a.get_text(strip=True)
        href = a["href"]
        if any(k in txt for k in ["上一", "下一", "prev", "next", "Prev", "Next", "前", "后"]):
            print(f"  [{txt}] -> {href}")

    print("\n=== Raw HTML snippet (first 3000 chars) ===")
    print(html[:3000])

asyncio.run(main())
