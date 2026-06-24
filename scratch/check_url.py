#!/usr/bin/env python3
import urllib.request
import urllib.error

def check_url():
    # Try fetching via Jina Reader
    url = "https://www.novel543.com/0315291074/8012_75_2.html"
    jina_url = f"https://r.jina.ai/{url}"
    print(f"Checking URL: {url}")
    try:
        req = urllib.request.Request(
            jina_url, 
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
            print("Status: SUCCESS!")
            print(f"Length of response: {len(content)}")
            print("\nPreview of response:")
            print("\n".join(content.split("\n")[:10]))
    except urllib.error.HTTPError as he:
        print(f"HTTP Error: {he.code}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_url()
