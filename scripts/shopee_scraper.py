"""
Robust Shopee scraper using DrissionPage.
- Fetches multiple search pages and scrolls each page.
- Returns raw listings as JSON on stdout.
- Prints diagnostics to stderr only.
"""

import sys
import json
import os
import time
from typing import Dict, List, Optional

from DrissionPage import ChromiumOptions, ChromiumPage

ITEM_LOCATOR = 'css:.shopee-search-item-result__item, [data-sqe="item"], a[href*="-i."]'
TITLE_LOCATOR = 'css:.line-clamp-2, [data-sqe="name"], div.truncate'
LINK_LOCATOR = 'css:a[href*="-i."], a'
SHOP_EXCLUDE_WORDS = {'ad', 'sponsored', 'mall', 'yêu thích', 'tài trợ', 'tìm sản phẩm', 'tìm', 'sản phẩm', 'tương tự', 'shopee'}


def _extract_title(item) -> str:
    title_ele = item.ele(TITLE_LOCATOR, timeout=0)
    if title_ele and title_ele.text:
        return title_ele.text.strip()

    title = "No Title"
    for line in [t.strip() for t in item.text.split('\n') if t.strip()]:
        lower = line.lower()
        if len(line) > 10 and 'sold' not in lower:
            title = line
            break

    return title


def _extract_url(item) -> str:
    url = ""
    if item.tag == 'a':
        url = item.attr('href') or ""
    else:
        link_ele = item.ele(LINK_LOCATOR, timeout=0)
        if link_ele:
            url = link_ele.attr('href') or ""

    if url and not url.startswith('http'):
        url = f"https://shopee.vn{url}"
    return url


def _extract_image(item) -> str:
    img_ele = item.ele('css:img', timeout=0)
    if not img_ele:
        return ""

    src = img_ele.attr('src') or ""
    if not src or 'blank.gif' in src:
        src = img_ele.attr('data-src') or src

    return src or ""


import re

def _parse_number_fragment(text: str) -> int:
    if not text:
        return 0

    # Look for digits, possibly with separators (dots or commas)
    # Target formats: 1.000.000, 1,000,000, 1000000
    # Avoid picking up strings that are just a list of model numbers
    matches = re.findall(r'\b\d{1,3}(?:[\.,]\d{3})+\b|\b\d{4,9}\b', text)
    if not matches:
        return 0

    # Pick the largest one that looks like a valid price, but avoid absurdly long digit strings
    valid_prices = []
    for m in matches:
        clean = re.sub(r'[\.,]', '', m)
        if len(clean) > 12: # Skip obviously fake large numbers (trillion+)
            continue
        try:
            val = int(clean)
            if 1000 <= val <= 300000000: # 1k to 300M range is safe for most items
                valid_prices.append(val)
        except:
            continue
            
    return max(valid_prices) if valid_prices else 0


def _parse_sold(raw: str) -> int:
    lower = raw.lower()
    if 'sold' not in lower and 'bán' not in lower and 'ban' not in lower:
        return 0

    # Only extract digits and multipliers
    num_match = re.search(r'([\d\.,]+)', lower)
    if not num_match:
        return 0

    num_text = num_match.group(1).replace(',', '.')
    try:
        value = float(num_text)
        if 'k' in lower:
            value *= 1000
        elif 'tr' in lower or 'm' in lower:
            value *= 1000000
        return int(value)
    except:
        return 0


def _extract_listing(item) -> Optional[Dict]:
    try:
        title = _extract_title(item)
        url = _extract_url(item)
        image = _extract_image(item)

        lines = [t.strip() for t in item.text.split('\n') if t.strip()]
        price = 0
        rating = 0.0
        sold = 0
        shop = 'Shopee'

        # 1. Extract Price
        for line in lines:
            candidate_price = _parse_number_fragment(line)
            if candidate_price > price:
                price = candidate_price

        # 2. Extract Rating & Sold
        for idx, line in enumerate(lines):
            lower = line.lower()
            if 'sold' in lower or 'bán' in lower or 'ban' in lower:
                sold = max(sold, _parse_sold(line))
                if idx > 0:
                    try:
                        candidate_rating = float(lines[idx - 1].replace(',', '.'))
                        if 0.0 <= candidate_rating <= 5.0:
                            rating = candidate_rating
                    except ValueError:
                        pass
        
        # Fallback for rating if not found but item has sales
        if rating == 0.0:
            rating = 5.0

        # 3. Extract Location (Shopee cards show location, not shop name)
        clean_lines = []
        for line in lines:
            lower = line.lower()
            if any(word in lower for word in ['tìm sản phẩm', 'tương tự', 'ad', 'tài trợ']):
                continue
            if line == title or _parse_number_fragment(line) == price:
                continue
            if 'sold' in lower or 'bán' in lower or 'ban' in lower:
                continue
            try:
                val = float(line.replace(',', '.'))
                if 0.0 <= val <= 5.0:
                    continue
            except:
                pass
            if line.startswith('-') and line.endswith('%'):
                continue
            clean_lines.append(line)

        if clean_lines:
            shop = clean_lines[-1] # Usually location like 'Hà Nội' or 'Nước ngoài'

        return {
            'title': title,
            'price': price,
            'url': url,
            'image': image,
            'rating': rating,
            'sold': sold,
            'shop': shop,
        }
    except Exception as err:
        print(f"Error parsing item: {err}", file=sys.stderr)
        return None


def _wait_for_items(page) -> bool:
    try:
        found = page.wait.ele_displayed(ITEM_LOCATOR, timeout=12)
        return bool(found)
    except Exception:
        return False


def _scroll_page(page, max_scrolls: int = 5) -> None:
    for _ in range(max_scrolls):
        try:
            page.scroll.to_bottom()
            page.wait.load_start(timeout=2)
        except Exception:
            pass
        time.sleep(0.9)


import random

def search_shopee(query: str, max_items: int = 100) -> List[Dict]:
    co = ChromiumOptions().set_argument('--no-sandbox')
    co.set_argument('--disable-gpu')
    co.set_argument('--disable-dev-shm-usage')
    co.set_argument('--blink-settings=imagesEnabled=false') # Speed up & reduce footprint
    
    # Use a realistic, randomized user agent
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ]
    co.set_user_agent(random.choice(user_agents))

    profile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shopee_user_profile')
    co.set_user_data_path(profile_path)

    page = ChromiumPage(co)

    max_items = max(1, min(max_items, 120))
    # Limit to 1 page to speed up the process and avoid irrelevant accessories on later pages
    max_pages = 1
    base_url = f"https://shopee.vn/search?keyword={query.replace(' ', '%20')}"

    results: List[Dict] = []
    seen_keys = set()

    try:
        for page_idx in range(max_pages):
            if page_idx == 0:
                page_url = base_url
            else:
                page_url = f"{base_url}&page={page_idx + 1}"
                
            print(f"[Scraper] Fetching page {page_idx + 1}/{max_pages}: {page_url}", file=sys.stderr)

            page.get(page_url)
            
            # Check for Captcha/Block
            page_title = page.title.lower()
            if 'captcha' in page_title or 'verify' in page_title or 'robot' in page_title:
                print(f"[Scraper] ERROR: Blocked by CAPTCHA/Verification on page {page_idx + 1}", file=sys.stderr)
                page.get_screenshot(path='drission_screenshot.png', full_page=True)
                break

            if not _wait_for_items(page):
                # Double check for captcha if no items found
                if 'captcha' in page.html.lower():
                    print(f"[Scraper] ERROR: Hidden CAPTCHA detected in HTML", file=sys.stderr)
                else:
                    print(f"[Scraper] No items detected on page {page_idx + 1}", file=sys.stderr)
                
                page.get_screenshot(path='drission_screenshot.png', full_page=True)
                if page_idx == 0:
                    break
                continue

            # Smaller human-like delay
            time.sleep(random.uniform(0.8, 1.5))
            
            _scroll_page(page)
            # Short wait for any images/lazy loads after scroll
            time.sleep(1.0)
            
            items = page.eles(ITEM_LOCATOR)
            print(f"[Scraper] Found {len(items)} DOM items on page {page_idx + 1}", file=sys.stderr)

            for item in items:
                if len(results) >= max_items:
                    break

                listing = _extract_listing(item)
                if not listing:
                    continue

                key = f"{listing.get('url', '')}|{listing.get('title', '')}|{listing.get('price', 0)}"
                if key in seen_keys:
                    continue

                seen_keys.add(key)
                results.append(listing)

            if len(results) >= max_items:
                break

            # Delay between pages
            time.sleep(random.uniform(1.0, 2.5))

        return results[:max_items]
    except Exception as err:
        print(f"General Scraper Error: {err}", file=sys.stderr)
        return []
    finally:
        page.quit()


def _parse_cli_max_items(argv: List[str]) -> int:
    if len(argv) < 3:
        return 100

    try:
        return int(argv[2])
    except ValueError:
        return 100


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(1)

    # Force UTF-8 for Windows output pipes
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    query_arg = sys.argv[1]
    max_items_arg = _parse_cli_max_items(sys.argv)
    output = search_shopee(query_arg, max_items=max_items_arg)
    print(json.dumps(output, ensure_ascii=False))
