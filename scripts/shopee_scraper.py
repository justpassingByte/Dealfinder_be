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

def search_shopee(query: str, max_items: int = 100, is_maintenance: bool = False) -> List[Dict]:
    profile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shopee_user_profile')
    ua = get_consistent_ua(profile_path)

    co = ChromiumOptions()
    
    # Kết nối tới Chrome đang chạy sẵn (Docker mode)
    browser_host = os.environ.get('SCRAPER_BROWSER_HOST', '127.0.0.1')
    browser_port = int(os.environ.get('SCRAPER_BROWSER_PORT', '9222'))
    co.set_address(f"{browser_host}:{browser_port}")
    
    # BẮT BUỘC: Giả lập User-Agent Windows để Shopee không nhận ra Bot
    co.set_user_agent(ua)

    try:
        browser = ChromiumPage(co)
        
        # We need exactly 2 tabs (0 for User, 1 for Maintenance)
        while len(browser.tab_ids) < 2:
            browser.new_tab()
            
        tab_ids = browser.tab_ids
        # Close any additional tabs that might have accidentally accumulated
        while len(tab_ids) > 2:
            try:
                browser.get_tab(tab_ids[-1]).close()
            except:
                pass
            tab_ids = browser.tab_ids
            
        target_tab_id = tab_ids[1] if is_maintenance else tab_ids[0]
        page = browser.get_tab(target_tab_id)
        
        try:
            browser.set.tab_to_front(target_tab_id)
        except:
            pass
        
        # --- MODE SWITCH: DIRECT URL VS SEARCH ---
        is_url = query.startswith('http')
        
        if is_url:
            print(f"[Scraper] Direct Mode: Navigating to Product Page...", file=sys.stderr)
            page.get(query)
            time.sleep(random.uniform(2.0, 4.0))
        else:
            # Existing Search Mode logic
            # === RESET STATE REACT CÁCH AN TOÀN NHẤT ===
            # Nếu đang ở trang có kết quả tìm kiếm cũ (chứa keyword=) 
            # hoặc chưa ở shopee, ta về thẳng trang chủ để ô Search tự trống trơn 100%,
            # khỏi cần tìm cách hack xóa text của React nữa.
            if 'shopee.vn' not in page.url or 'keyword=' in page.url:
                page.get('https://shopee.vn/')
                time.sleep(random.uniform(1.5, 3.0))
            
            # Close popups
            try:
                for selector in ['css:.shopee-popup__close-btn', 'css:.shopee-modal__close']:
                    close_btn = page.ele(selector, timeout=0.5)
                    if close_btn: close_btn.click()
            except: pass

            search_input = page.ele('css:.shopee-searchbar-input__input', timeout=5)
            if search_input:
                search_input.click()
                time.sleep(random.uniform(0.1, 0.3))
                
                # KHÔNG CẦN CLEAR NỮA VÌ TRANG CHỦ LÀ Ô TRỐNG
                
                # === NHẬP query mới từng ký tự ===
                for char in query:
                    search_input.input(char, clear=False)
                    time.sleep(random.uniform(0.05, 0.15))
                
                # Click nút Search
                time.sleep(random.uniform(0.8, 1.5))
                search_btn = page.ele('css:button.btn-solid-primary', timeout=3)
                if not search_btn:
                    search_btn = page.ele('css:.shopee-searchbar__search-button', timeout=2)
                if not search_btn:
                    search_btn = page.ele('css:button[type="button"]', timeout=2)
                if search_btn:
                    search_btn.click()
                else:
                    search_input.input('\n', clear=False)
            else:
                page.get(f"https://shopee.vn/search?keyword={query.replace(' ', '%20')}")

        # --- CAPTCHA CHECK ---
        def handle_captcha(p):
            if any(k in p.title.lower() for k in ['captcha', 'verify', 'robot']):
                print(f"\n[Scraper] !!! CAPTCHA DETECTED !!!", file=sys.stderr)
                for _ in range(120):
                    time.sleep(1)
                    if not any(k in p.title.lower() for k in ['captcha', 'verify', 'robot']):
                        return True
                return False
            return True

        if not handle_captcha(page):
            sys.exit(1)

        if is_url:
            # --- PRODUCT PAGE EXTRACTION ---
            # Shopee product page selectors are different from search
            # We look for price in the main detail section
            time.sleep(2)
            price_ele = page.ele('css:.pqTW9c, .G27LRz, ._2nzS9m', timeout=5) # Common Shopee price classes
            title_ele = page.ele('css:.V_Y_S_, ._29_p48', timeout=5)
            
            price_text = price_ele.text if price_ele else "0"
            # Clean price (e.g. "₫1.200.000" -> 1200000)
            price = _parse_number_fragment(price_text)
            
            return [{
                'title': title_ele.text if title_ele else "Unknown Product",
                'price': price,
                'url': query,
                'image': '', # Optional for updates
                'rating': 5.0,
                'sold': 0,
                'shop': 'Shopee'
            }]

        # --- SEARCH RESULTS EXTRACTION ---
        results: List[Dict] = []
        seen_keys = set()
        max_pages = (max_items // 60) + 1 if max_items > 60 else 1
        
        for page_idx in range(max_pages):
            if not handle_captcha(page): break
            if not _wait_for_items(page): break

            _human_scroll(page, steps=random.randint(4, 6))
            time.sleep(1)
            
            items = page.eles(ITEM_LOCATOR)
            for item in items:
                if len(results) >= max_items: break
                listing = _extract_listing(item)
                if not listing: continue
                key = f"{listing.get('url', '')}|{listing.get('price', 0)}"
                if key in seen_keys: continue
                seen_keys.add(key)
                results.append(listing)
            
            if len(results) >= max_items: break
            time.sleep(1)

        return results[:max_items]
    except Exception as err:
        print(f"General Scraper Error: {err}", file=sys.stderr)
        return []
    finally:
        # DO NOT CLOSE: We keep the tab open for the next search to look human.
        try:
            # Tối ưu RAM cho VPS 2GB: Dọn cache và ép nhả RAM cho HĐH mà không làm mất trạng thái login
            browser.clear_cache(cookies=False, storage=False)
            import gc
            gc.collect()
        except:
            pass
        print(f"[Scraper] Task finished. Tab preserved. Cache cleared for memory constraints.", file=sys.stderr)
    return []


def _parse_cli_max_items(argv: List[str]) -> int:
    if len(argv) < 3:
        return 100

    try:
        return int(argv[2])
    except ValueError:
        return 100


def _parse_cli_is_maintenance(argv: List[str]) -> bool:
    if len(argv) < 4:
        return False
    return argv[3].lower() == 'maintenance'


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
    is_maintenance_arg = _parse_cli_is_maintenance(sys.argv)
    output = search_shopee(query_arg, max_items=max_items_arg, is_maintenance=is_maintenance_arg)
    print(json.dumps(output, ensure_ascii=False))
