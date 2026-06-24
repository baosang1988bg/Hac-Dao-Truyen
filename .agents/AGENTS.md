# Rules for Novel Scraping & Translation (Workspace: HacDaoTruyen)

## Handling Paginated Chapters on novel543.com
When scraping chapters from `novel543.com`, keep the following constraints and behaviors in mind:
1. **Cloudflare Blocking & Jina Reader Fallback**: 
   - `novel543.com` frequently blocks normal browser automation (Playwright/Chromium), which automatically triggers a fallback to Jina Reader (`r.jina.ai`).
   - Jina Reader returns clean Markdown text but strips out navigation HTML elements, meaning standard `next` and `prev` link selectors will fail.
2. **Programmatic Pagination URL Suffixes**:
   - Chapters on `novel543.com` are often paginated (indicated by `(1/N)` or `（1/N）` in the title).
   - If Jina Reader fallback is active and `next_url` is not found in the HTML, you must programmatically construct the URLs for subsequent pages:
     - Page 1 base: `.../8096_1477.html`
     - Page 2 constructed: `.../8096_1477_2.html`
     - Page 3 constructed: `.../8096_1477_3.html`
   - **URL Rule**: If the URL already ends with `_\d+_\d+\.html`, replace the last `_\d+` with `_{page_num}`; otherwise, replace `.html` with `_{page_num}.html`.
3. **Clean Chapter Titles**:
   - Always strip the pagination suffix (e.g. `(1/2)`, `(2/2)`) from the chapter title using the regex `\s*[\(\（]\s*\d+\s*/\s*\d+\s*[\)\）]\s*$` before saving the raw content or translating it. This prevents corrupted filenames (e.g., saving as `... 12_VI.md` instead of `..._VI.md`) and ensures they match the clean catalog structure.
