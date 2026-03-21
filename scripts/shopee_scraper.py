"""
Shopee worker runtime using DrissionPage.

- Keyword searches: try Shopee search API first inside the live browser session
  without forcing a navigation to the search results page.
- Fallback: navigate to the search results page only if DOM extraction is needed.
- Direct URLs: keep using product-page extraction.
- Output: structured JSON to stdout, diagnostics to stderr only.
"""

import json
import os
import random
import re
import sys
import time
from typing import Dict, List, Optional
from urllib.parse import quote, urlparse

from DrissionPage import ChromiumOptions, ChromiumPage

ITEM_LOCATOR = 'css:.shopee-search-item-result__item, [data-sqe="item"], a[href*="-i."]'
TITLE_LOCATOR = 'css:.line-clamp-2, [data-sqe="name"], div.truncate'
LINK_LOCATOR = 'css:a[href*="-i."], a'

API_PAGE_SIZE = 60
MAX_API_PAGES = 3
API_TIMEOUT_SECONDS = 15

PRODUCT_PRICE_LOCATOR = 'css:.pqTW9c, .G27LRz, ._2nzS9m'
PRODUCT_TITLE_LOCATOR = 'css:.V_Y_S_, ._29_p48'


def _build_runtime_result(
    listings: Optional[List[Dict]] = None,
    channel: Optional[str] = None,
    blocked: bool = False,
    api_attempted: bool = False,
    api_failure_reason: Optional[str] = None,
    valid_empty_result: bool = False,
    error: Optional[str] = None,
) -> Dict:
    return {
        'listings': listings or [],
        'channel': channel,
        'blocked': blocked,
        'apiAttempted': api_attempted,
        'apiFailureReason': api_failure_reason,
        'validEmptyResult': valid_empty_result,
        'error': error,
    }


def _extract_title(item) -> str:
    title_ele = item.ele(TITLE_LOCATOR, timeout=0)
    if title_ele and title_ele.text:
        return title_ele.text.strip()

    for line in [text.strip() for text in item.text.split('\n') if text.strip()]:
        lower = line.lower()
        if len(line) > 10 and 'sold' not in lower:
            return line

    return 'No Title'


def _extract_url(item) -> str:
    url = ''
    if item.tag == 'a':
        url = item.attr('href') or ''
    else:
        link_ele = item.ele(LINK_LOCATOR, timeout=0)
        if link_ele:
            url = link_ele.attr('href') or ''

    if url and not url.startswith('http'):
        url = f'https://shopee.vn{url}'
    return url


def _extract_image(item) -> str:
    img_ele = item.ele('css:img', timeout=0)
    if not img_ele:
        return ''

    src = img_ele.attr('src') or ''
    if not src or 'blank.gif' in src:
        src = img_ele.attr('data-src') or src

    return src or ''


def _parse_number_fragment(text: str) -> int:
    if not text:
        return 0

    matches = re.findall(r'\b\d{1,3}(?:[\.,]\d{3})+\b|\b\d{4,9}\b', text)
    if not matches:
        return 0

    valid_prices = []
    for match in matches:
        clean = re.sub(r'[\.,]', '', match)
        if len(clean) > 12:
            continue
        try:
            value = int(clean)
            if 1000 <= value <= 300000000:
                valid_prices.append(value)
        except Exception:
            continue

    return max(valid_prices) if valid_prices else 0


def _parse_sold(raw: str) -> int:
    lower = raw.lower()
    if 'sold' not in lower and 'bán' not in lower and 'ban' not in lower:
        return 0

    match = re.search(r'([\d\.,]+)', lower)
    if not match:
        return 0

    num_text = match.group(1).replace(',', '.')
    try:
        value = float(num_text)
        if 'k' in lower:
            value *= 1000
        elif 'tr' in lower or 'm' in lower:
            value *= 1000000
        return int(value)
    except Exception:
        return 0


def _extract_listing(item) -> Optional[Dict]:
    try:
        title = _extract_title(item)
        url = _extract_url(item)
        image = _extract_image(item)

        lines = [text.strip() for text in item.text.split('\n') if text.strip()]
        price = 0
        rating = 0.0
        sold = 0
        shop = 'Shopee'

        for line in lines:
            candidate_price = _parse_number_fragment(line)
            if candidate_price > price:
                price = candidate_price

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

        if rating == 0.0:
            rating = 5.0

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
                value = float(line.replace(',', '.'))
                if 0.0 <= value <= 5.0:
                    continue
            except Exception:
                pass
            if line.startswith('-') and line.endswith('%'):
                continue
            clean_lines.append(line)

        if clean_lines:
            shop = clean_lines[-1]

        return {
            'title': title,
            'price': price,
            'url': url,
            'image': image,
            'rating': rating,
            'sold': sold,
            'shop': shop,
            'marketplace': 'shopee',
        }
    except Exception as err:
        print(f'Error parsing item: {err}', file=sys.stderr)
        return None


def _wait_for_items(page) -> bool:
    try:
        found = page.wait.ele_displayed(ITEM_LOCATOR, timeout=12)
        return bool(found)
    except Exception:
        return False


def _human_scroll(page, steps: Optional[int] = None) -> None:
    steps = steps or random.randint(3, 6)
    for _ in range(steps):
        distance = random.randint(300, 800)
        try:
            page.scroll.down(distance)
        except Exception:
            try:
                page.scroll.to_bottom()
            except Exception:
                pass
        time.sleep(random.uniform(0.5, 1.3))
        if random.random() < 0.3:
            try:
                page.scroll.up(random.randint(100, 300))
            except Exception:
                pass
            time.sleep(random.uniform(0.2, 0.7))


def _handle_captcha(page) -> bool:
    title = (page.title or '').lower()
    if not any(keyword in title for keyword in ['captcha', 'verify', 'robot']):
        return True

    print('[Scraper] CAPTCHA detected. Waiting for manual recovery...', file=sys.stderr)
    for _ in range(120):
        time.sleep(1)
        title = (page.title or '').lower()
        if not any(keyword in title for keyword in ['captcha', 'verify', 'robot']):
            return True
    return False


def _normalize_api_price(value) -> int:
    try:
        return int(float(value) / 100000)
    except Exception:
        return 0


def _normalize_api_rating(item_basic: Dict) -> float:
    item_rating = item_basic.get('item_rating')
    if isinstance(item_rating, dict):
        try:
            return float(item_rating.get('rating_star') or 0)
        except Exception:
            return 0.0

    try:
        return float(item_basic.get('rating_star') or 0)
    except Exception:
        return 0.0


def _normalize_api_sold(item_basic: Dict) -> int:
    for key in ('historical_sold', 'sold'):
        try:
            value = item_basic.get(key)
            if value is not None:
                return int(value)
        except Exception:
            continue
    return 0


def _build_image_url(image_id: str) -> str:
    if not image_id:
        return ''
    if image_id.startswith('http'):
        return image_id
    return f'https://cf.shopee.vn/file/{image_id}'


def _normalize_api_listing(item: Dict) -> Optional[Dict]:
    item_basic = item.get('item_basic') if isinstance(item, dict) else None
    if not isinstance(item_basic, dict):
        return None

    name = item_basic.get('name')
    shopid = item_basic.get('shopid') or item_basic.get('shop_id')
    itemid = item_basic.get('itemid') or item_basic.get('item_id')
    price = _normalize_api_price(item_basic.get('price'))

    if not name or not shopid or not itemid or price <= 0:
        return None

    return {
        'title': str(name),
        'price': price,
        'url': f'https://shopee.vn/product/{shopid}/{itemid}',
        'image': _build_image_url(str(item_basic.get('image') or '')),
        'rating': _normalize_api_rating(item_basic),
        'sold': _normalize_api_sold(item_basic),
        'shop': str(item_basic.get('shop_name') or shopid),
        'marketplace': 'shopee',
    }


def _extract_api_items(data: Dict) -> Optional[List[Dict]]:
    if not isinstance(data, dict):
        return None

    direct_items = data.get('items')
    if isinstance(direct_items, list):
        return direct_items

    nested_data = data.get('data')
    if isinstance(nested_data, dict):
        nested_items = nested_data.get('items')
        if isinstance(nested_items, list):
            return nested_items

    return None


def _search_url(query: str) -> str:
    return f'https://shopee.vn/search?keyword={quote(query)}'


def _dismiss_common_popups(page) -> None:
    try:
        for selector in ('css:.shopee-popup__close-btn', 'css:.shopee-modal__close'):
            close_btn = page.ele(selector, timeout=0.5)
            if close_btn:
                close_btn.click()
    except Exception:
        pass


def _is_storefront_origin(url: str) -> bool:
    try:
        host = (urlparse(url).hostname or '').lower()
    except Exception:
        return False
    return host in ('shopee.vn', 'www.shopee.vn')


def _ensure_storefront_origin(page) -> None:
    current_url = page.url or ''

    if not _is_storefront_origin(current_url):
        print('[Scraper] Navigating to Shopee storefront to establish same-origin session', file=sys.stderr)
        page.get('https://shopee.vn/')
        time.sleep(random.uniform(1.5, 3.0))
    else:
        try:
            page.scroll.to_top()
        except Exception:
            pass

    _dismiss_common_popups(page)


def _ensure_search_page(page, query: str) -> None:
    current_url = page.url or ''
    encoded_query = quote(query)
    search_url = _search_url(query)

    if '/search' not in current_url or encoded_query not in current_url:
        print(f'[Scraper] Navigating to search URL for DOM fallback: "{query}"', file=sys.stderr)
        page.get(search_url)
        time.sleep(random.uniform(1.5, 3.0))
    else:
        try:
            page.scroll.to_top()
        except Exception:
            pass

    _dismiss_common_popups(page)


def _fetch_api_page(page, query: str, limit: int, newest: int) -> Dict:
    script = """
        const [keyword, limit, newest] = arguments;
        const params = new URLSearchParams({
            keyword,
            limit: String(limit),
            newest: String(newest),
            order: 'desc',
            page_type: 'search',
        });

        return fetch(`https://shopee.vn/api/v4/search/search_items?${params.toString()}`, {
            method: 'GET',
            credentials: 'include',
        }).then(async (response) => {
            const text = await response.text();
            let data = null;
            try {
                data = JSON.parse(text);
            } catch (error) {
                data = null;
            }
            return {
                ok: response.ok,
                status: response.status,
                contentType: response.headers.get('content-type') || '',
                data,
                textSnippet: text.slice(0, 600),
            };
        }).catch((error) => ({
            ok: false,
            status: 0,
            contentType: '',
            data: null,
            textSnippet: String(error),
            runtimeError: String(error),
        }));
    """

    try:
        result = page.run_js(script, query, limit, newest, timeout=API_TIMEOUT_SECONDS)
    except Exception as err:
        return {
            'ok': False,
            'status': 0,
            'contentType': '',
            'data': None,
            'textSnippet': str(err),
            'runtimeError': str(err),
        }

    if isinstance(result, dict):
        return result

    return {
        'ok': False,
        'status': 0,
        'contentType': '',
        'data': None,
        'textSnippet': 'Unexpected API result shape',
        'runtimeError': 'Unexpected API result shape',
    }


def _search_via_api(page, query: str, max_items: int) -> Dict:
    target_items = min(max_items, API_PAGE_SIZE * MAX_API_PAGES)
    page_count = max(1, min(MAX_API_PAGES, (target_items + API_PAGE_SIZE - 1) // API_PAGE_SIZE))
    listings: List[Dict] = []
    seen_keys = set()
    api_failure_reason: Optional[str] = None

    for page_idx in range(page_count):
        remaining = target_items - len(listings)
        if remaining <= 0:
            break

        limit = min(API_PAGE_SIZE, remaining)
        newest = page_idx * API_PAGE_SIZE
        payload = _fetch_api_page(page, query, limit, newest)

        if payload.get('runtimeError'):
            api_failure_reason = str(payload.get('runtimeError'))
            if page_idx == 0:
                return _build_runtime_result(
                    channel=None,
                    api_attempted=True,
                    api_failure_reason=api_failure_reason,
                    error=api_failure_reason,
                )
            break

        status = int(payload.get('status') or 0)
        content_type = str(payload.get('contentType') or '').lower()
        text_snippet = str(payload.get('textSnippet') or '')
        lower_snippet = text_snippet.lower()

        if not payload.get('ok'):
            api_failure_reason = f'API request failed with status {status}'
            if 'captcha' in lower_snippet or 'robot' in lower_snippet:
                api_failure_reason = f'{api_failure_reason} (captcha)'
            if page_idx == 0:
                return _build_runtime_result(
                    channel=None,
                    api_attempted=True,
                    api_failure_reason=api_failure_reason,
                    error=api_failure_reason,
                )
            break

        if 'json' not in content_type and not isinstance(payload.get('data'), dict):
            api_failure_reason = 'Shopee API returned non-JSON content'
            if page_idx == 0:
                return _build_runtime_result(
                    channel=None,
                    api_attempted=True,
                    api_failure_reason=api_failure_reason,
                    error=api_failure_reason,
                )
            break

        data = payload.get('data')
        if not isinstance(data, dict):
            api_failure_reason = 'Shopee API returned an invalid JSON payload'
            if page_idx == 0:
                return _build_runtime_result(
                    channel=None,
                    api_attempted=True,
                    api_failure_reason=api_failure_reason,
                    error=api_failure_reason,
                )
            break

        items = _extract_api_items(data)
        if not isinstance(items, list):
            data_keys = ', '.join(sorted(str(key) for key in data.keys())[:8]) or 'no keys'
            api_failure_reason = f'Shopee API payload did not include an items array (keys: {data_keys})'
            if page_idx == 0:
                return _build_runtime_result(
                    channel=None,
                    api_attempted=True,
                    api_failure_reason=api_failure_reason,
                    error=api_failure_reason,
                )
            break

        if page_idx == 0 and len(items) == 0:
            return _build_runtime_result(
                listings=[],
                channel='api',
                api_attempted=True,
                api_failure_reason=None,
                valid_empty_result=True,
            )

        page_listings = []
        for item in items:
            listing = _normalize_api_listing(item)
            if listing:
                page_listings.append(listing)

        if len(items) > 0 and not page_listings:
            api_failure_reason = 'Shopee API payload was missing required listing fields'
            if page_idx == 0:
                return _build_runtime_result(
                    channel=None,
                    api_attempted=True,
                    api_failure_reason=api_failure_reason,
                    error=api_failure_reason,
                )
            break

        for listing in page_listings:
            key = f"{listing.get('url', '')}|{listing.get('price', 0)}"
            if key in seen_keys:
                continue
            seen_keys.add(key)
            listings.append(listing)

        if len(page_listings) < limit:
            break

    return _build_runtime_result(
        listings=listings[:target_items],
        channel='api',
        api_attempted=True,
        api_failure_reason=api_failure_reason,
        valid_empty_result=False,
    )


def _extract_product_page(page, query: str) -> List[Dict]:
    print('[Scraper] Direct Mode: navigating to product page...', file=sys.stderr)
    page.get(query)
    time.sleep(random.uniform(2.0, 4.0))

    price_ele = page.ele(PRODUCT_PRICE_LOCATOR, timeout=5)
    title_ele = page.ele(PRODUCT_TITLE_LOCATOR, timeout=5)

    price_text = price_ele.text if price_ele else '0'
    price = _parse_number_fragment(price_text)

    return [{
        'title': title_ele.text if title_ele else 'Unknown Product',
        'price': price,
        'url': query,
        'image': '',
        'rating': 5.0,
        'sold': 0,
        'shop': 'Shopee',
        'marketplace': 'shopee',
    }]


def _collect_dom_search_results(page, max_items: int) -> List[Dict]:
    if not _wait_for_items(page):
        return []

    _human_scroll(page, steps=random.randint(4, 6))
    time.sleep(1)

    results: List[Dict] = []
    seen_keys = set()
    items = page.eles(ITEM_LOCATOR)
    for item in items:
        if len(results) >= max_items:
            break
        listing = _extract_listing(item)
        if not listing:
            continue
        key = f"{listing.get('url', '')}|{listing.get('price', 0)}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        results.append(listing)

    return results[:max_items]


def _ensure_worker_tab(browser, is_maintenance: bool):
    while len(browser.tab_ids) < 2:
        browser.new_tab()

    tab_ids = browser.tab_ids
    while len(tab_ids) > 2:
        try:
            browser.get_tab(tab_ids[-1]).close()
        except Exception:
            pass
        tab_ids = browser.tab_ids

    target_tab_id = tab_ids[1] if is_maintenance else tab_ids[0]
    page = browser.get_tab(target_tab_id)

    try:
        browser.set.tab_to_front(target_tab_id)
    except Exception:
        pass

    return page


def get_consistent_ua(profile_path: str) -> str:
    ua_file = os.path.join(profile_path, 'user_agent.txt')
    os.makedirs(profile_path, exist_ok=True)

    if os.path.exists(ua_file):
        try:
            with open(ua_file, 'r', encoding='utf-8') as file:
                ua = file.read().strip()
                if ua:
                    return ua
        except Exception:
            pass

    ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    try:
        with open(ua_file, 'w', encoding='utf-8') as file:
            file.write(ua)
    except Exception:
        pass
    return ua


def search_shopee(query: str, max_items: int = 100, is_maintenance: bool = False) -> Dict:
    profile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shopee_user_profile')
    ua = get_consistent_ua(profile_path)

    co = ChromiumOptions()
    browser_host = os.environ.get('SCRAPER_BROWSER_HOST', '127.0.0.1')
    browser_port = int(os.environ.get('SCRAPER_BROWSER_PORT', '9222'))
    co.set_address(f'{browser_host}:{browser_port}')
    co.set_user_agent(ua)

    browser = None
    try:
        browser = ChromiumPage(co)
        page = _ensure_worker_tab(browser, is_maintenance)

        if query.startswith('http'):
            if not _handle_captcha(page):
                return _build_runtime_result(blocked=True, error='CAPTCHA detected on product page')
            listings = _extract_product_page(page, query)
            return _build_runtime_result(listings=listings, channel='dom')

        _ensure_storefront_origin(page)

        if not _handle_captcha(page):
            return _build_runtime_result(blocked=True, error='CAPTCHA detected before API attempt')

        api_result = _search_via_api(page, query, max_items)
        if not api_result.get('error'):
            return api_result

        print(
            f"[Scraper][API] Falling back to DOM for '{query}': {api_result.get('apiFailureReason') or api_result.get('error')}",
            file=sys.stderr,
        )

        _ensure_search_page(page, query)

        if not _handle_captcha(page):
            return _build_runtime_result(
                blocked=True,
                api_attempted=True,
                api_failure_reason=api_result.get('apiFailureReason') or api_result.get('error'),
                error='CAPTCHA detected before DOM fallback',
            )

        listings = _collect_dom_search_results(page, max_items)
        return _build_runtime_result(
            listings=listings,
            channel='dom',
            api_attempted=True,
            api_failure_reason=api_result.get('apiFailureReason') or api_result.get('error'),
        )
    except Exception as err:
        print(f'General Scraper Error: {err}', file=sys.stderr)
        return _build_runtime_result(error=str(err))
    finally:
        try:
            if browser is not None:
                browser.clear_cache(cookies=False, storage=False)
        except Exception:
            pass
        print('[Scraper] Task finished. Tab preserved. Cache cleared.', file=sys.stderr)


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
        print(json.dumps(_build_runtime_result(error='Missing query argument')))
        sys.exit(1)

    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    query_arg = sys.argv[1]
    max_items_arg = _parse_cli_max_items(sys.argv)
    is_maintenance_arg = _parse_cli_is_maintenance(sys.argv)
    output = search_shopee(query_arg, max_items=max_items_arg, is_maintenance=is_maintenance_arg)
    print(json.dumps(output, ensure_ascii=False))
    if output.get('error'):
        sys.exit(1)
