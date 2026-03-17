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

def _human_scroll(page, steps=None):
    """Scroll down in steps like a human would, often stopping to 'read'."""
    if steps is None:
        steps = random.randint(3, 6)
        
    for _ in range(steps):
        # Random scroll distance
        distance = random.randint(300, 800)
        page.scroll.down(distance)
        # Random wait after scrolling
        time.sleep(random.uniform(0.5, 1.5))
        # 30% chance of scrolling back up a little bit (as if re-reading)
        if random.random() < 0.3:
            page.scroll.up(random.randint(100, 300))
            time.sleep(random.uniform(0.3, 0.8))

def _random_mouse_behavior(page):
    """Hover over some elements to simulate interest."""
    try:
        # Find some random items or links to hover
        elements = page.eles('css:a, button, .shopee-search-item-result__item')
        if elements:
            to_hover = random.sample(elements, min(len(elements), 3))
            for el in to_hover:
                try:
                    page.actions.move_to(el)
                    time.sleep(random.uniform(0.2, 0.6))
                except:
                    pass
    except:
        pass

def get_consistent_ua(profile_path: str) -> str:
    """Ensure a profile always uses the same User-Agent to avoid detection."""
    ua_file = os.path.join(profile_path, 'user_agent.txt')
    if not os.path.exists(profile_path):
        os.makedirs(profile_path, exist_ok=True)
        
    if os.path.exists(ua_file):
        try:
            with open(ua_file, 'r') as f:
                ua = f.read().strip()
                if ua: return ua
        except:
            pass
    
    # Default realistic UA if not found
    new_ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    try:
        with open(ua_file, 'w') as f:
            f.write(new_ua)
    except:
        pass
    return new_ua

def search_shopee(query: str, max_items: int = 100) -> List[Dict]:
    profile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shopee_user_profile')
    ua = get_consistent_ua(profile_path)

    co = ChromiumOptions()
    co.set_argument('--no-sandbox')
    co.set_argument('--disable-gpu')
    co.set_argument('--disable-dev-shm-usage')
    co.set_user_agent(ua)
    co.set_user_data_path(profile_path)
    # Set a fixed port to allow multiple script runs to connect to the same browser instance
    co.set_local_port(9222)
    
    # Images ON is safer for anti-bot detection.
    co.set_argument('--blink-settings=imagesEnabled=true') 

    try:
        # ChromiumPage will connect to port 9222 if already open, or start a new browser.
        page = ChromiumPage(co)
        
        # --- HUMAN WARMUP / SESSION CHECK ---
        if 'shopee.vn' not in page.url:
            print(f"[Scraper] Fresh session or different site. Navigating to homepage...", file=sys.stderr)
            page.get('https://shopee.vn/')
            time.sleep(random.uniform(2.0, 4.0))
            # Look around a bit if it's the first time
            _human_scroll(page, steps=random.randint(2, 4))
            _random_mouse_behavior(page)
        else:
            print(f"[Scraper] Reusing existing browser tab at {page.url}", file=sys.stderr)

        # Check for initial captcha
        if 'captcha' in page.title.lower() or 'verify' in page.title.lower():
            print(f"[Scraper] Blocked or Verification needed. Attempting human interaction...", file=sys.stderr)
            _human_scroll(page, steps=2)
            time.sleep(2)
        
        # chromium-based popups or shopee overlays handling
        try:
            # Common shopee popup close buttons
            for selector in ['css:.shopee-popup__close-btn', 'css:.shopee-modal__close']:
                close_btn = page.ele(selector, timeout=1)
                if close_btn:
                    close_btn.click()
                    time.sleep(1)
        except:
            pass

        # --- SEARCH PHASE ---
        max_items = max(1, min(max_items, 120))
        max_pages = (max_items // 60) + 1 if max_items > 60 else 1
        
        # Human way: type into search bar
        search_input = page.ele('css:.shopee-searchbar-input__input', timeout=5)
        if search_input:
            # Skip typing if manual solve already navigated us to results
            curr_url = page.url.lower()
            if 'search' in curr_url and (query.replace(' ', '+').lower() in curr_url or query.replace(' ', '%20').lower() in curr_url):
                print(f"[Scraper] Detected results page already loaded, skipping input.", file=sys.stderr)
            else:
                print(f"[Scraper] Typing query: {query}", file=sys.stderr)
                search_input.click()
                page.actions.key_down('CONTROL').key_down('a').key_up('a').key_up('CONTROL').key_down('BACKSPACE').key_up('BACKSPACE')
                time.sleep(random.uniform(0.3, 0.7))
                
                for char in query:
                    search_input.input(char)
                    time.sleep(random.uniform(0.04, 0.12))
                
                time.sleep(random.uniform(1.0, 2.0))
                
                # Submission
                print(f"[Scraper] Submitting search...", file=sys.stderr)
                search_input.input('\n')
                
                # Wait and check if we need backup methods
                time.sleep(1.5)
                if 'search' not in page.url.lower():
                    print(f"[Scraper] Submission failed, trying fallback click/JS...", file=sys.stderr)
                    # Try JS as a final resort
                    page.run_js("document.querySelector('.shopee-searchbar__search-button')?.click();")
                    # Clear and set value via JS to be ultra sure
                    page.run_js(f"const inp = document.querySelector('.shopee-searchbar-input__input'); if(inp) {{ inp.value = '{query}'; inp.dispatchEvent(new Event('input', {{ bubbles: true }})); }}")
                    page.run_js("document.querySelector('.shopee-searchbar-input__input')?.closest('form')?.submit();")
        else:
            print(f"[Scraper] Search bar not found, navigating directly...", file=sys.stderr)
            page.get(f"https://shopee.vn/search?keyword={query.replace(' ', '%20')}")

        # --- CAPTCHA CHECK & RECOVERY ---
        def handle_captcha(p):
            title = p.title.lower()
            html = p.html.lower()
            # Look for common block keywords
            if any(k in title for k in ['captcha', 'verify', 'robot']) or \
               any(k in html for k in ['recaptcha', 'g-recaptcha', 'verification-wrapper', 'm-captcha']):
                
                print(f"\n[Scraper] !!! CAPTCHA/BLOCK DETECTED !!!", file=sys.stderr)
                print(f"[Scraper] Please look at the browser window and solve it manually.", file=sys.stderr)
                print(f"[Scraper] Waiting up to 120 seconds for manual resolution...", file=sys.stderr)
                
                # Wait until the keywords disappear from title and html
                for _ in range(120):
                    time.sleep(1)
                    t_now, h_now = p.title.lower(), p.html.lower()
                    if not any(k in t_now for k in ['captcha', 'verify', 'robot']) and \
                       'captcha' not in h_now and 'verification-wrapper' not in h_now:
                        print(f"[Scraper] Block cleared! Resuming...", file=sys.stderr)
                        time.sleep(2) # Extra buffer
                        return True
                return False
            return True

        if not handle_captcha(page):
            print(f"[Scraper] ERROR: CAPTCHA not solved in time.", file=sys.stderr)
            sys.exit(1) # Exit with error code

        results: List[Dict] = []
        seen_keys = set()
        
        for page_idx in range(max_pages):
            # Check for Captcha/Block at start of each page
            if not handle_captcha(page):
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

            # Human-like browsing of results
            _human_scroll(page, steps=random.randint(4, 7))
            _random_mouse_behavior(page)
            
            # Short wait for any images/lazy loads after scroll
            time.sleep(random.uniform(1.0, 2.0))
            
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

        if not results:
            print(f"[Scraper] No results found for \"{query}\".", file=sys.stderr)
            # If we reached here without errors but found nothing, it's a valid empty result.
            # But let's check if we are actually on a results page.
            if 'search' not in page.url.lower():
                print(f"[Scraper] ERROR: Ended up on wrong page ({page.url})", file=sys.stderr)
                sys.exit(1)

        return results[:max_items]
    except Exception as err:
        print(f"General Scraper Error: {err}", file=sys.stderr)
        return []
    finally:
        if page:
            # We DON'T call page.quit() anymore to keep the browser alive on port 9222.
            # We just close the current tab or stop loading to keep things tidy.
            try:
                page.stop_loading()
            except:
                pass
            print(f"[Scraper] Finished task. Browser session kept alive.", file=sys.stderr)
    return []


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
