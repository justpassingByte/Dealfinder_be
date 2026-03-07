"""
Robust Shopee Scraper using DrissionPage.
It uses CDP to look like a human.
"""

import sys
import json
import os
import time

from DrissionPage import ChromiumOptions, ChromiumPage

def search_shopee(query, max_items=10):
    # Stealth configuration
    co = ChromiumOptions().set_argument('--no-sandbox')
    co.set_user_agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
    
    # Use the user profile we already created! This has our valid Shopee login and cookies!
    profile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shopee_user_profile')
    co.set_user_data_path(profile_path)

    # ChromiumPage avoids WebDriver protocols which Shopee blocks
    page = ChromiumPage(co)
    
    try:
        url = f"https://shopee.vn/search?keyword={query.replace(' ', '%20')}"
        page.get(url)
        
        # Wait for the first item to appear in the DOM
        item_locator = 'css:.shopee-search-item-result__item'
        found = page.wait.ele_displayed(item_locator, timeout=12)
        if not found:
            print(f"Did not find {item_locator}. Taking screenshot... Error: Timeout waiting for items", file=sys.stderr)
            # Try to grab whatever it got
            page.get_screenshot(path='drission_screenshot.png', full_page=True)
            return []
        
        # We don't need to scroll if we are only grabbing the very first products
        
        # We need a robust way to get all items
        items = page.eles(item_locator)
        results = []
        
        print(f"Found {len(items)} items using locator", file=sys.stderr)
        
        for item in items[:max_items]:
            try:
                text_content = item.text.split('\n')
                
                title = "No Title"
                raw_price = "0"
                rating_val = 5.0
                sold_val = 0
                shop_location = "Shopee Seller"
                
                texts = [t.strip() for t in text_content if t.strip()]
                
                # Scan through text lines
                for i, line in enumerate(texts):
                    # If it has the currency symbol, it's the price
                    if '₫' in line:
                        raw_price = line
                        
                    # Title usually is the longest string that doesn't look like junk
                    elif title == "No Title" and len(line) > 10 and not any(k in line.lower() for k in ['đã bán', 'ngày', 'yêu thích', 'mall']):
                        title = line
                        
                    # Sold and Rating
                    elif "đã bán" in line.lower():
                        # Parse sold amount (e.g. "Đã bán 50k+")
                        sold_str = line.lower().replace('đã bán', '').strip()
                        num_str = ''.join(c for c in sold_str if c.isdigit() or c in '.,')
                        try:
                            num = float(num_str.replace(',', '.'))
                            if 'k' in sold_str: num *= 1000
                            elif 'tr' in sold_str: num *= 1000000
                            sold_val = int(num)
                        except Exception:
                            sold_val = 0
                            
                        # Parse rating (usually the item exactly before "đã bán")
                        if i > 0:
                            try:
                                possible_rating = float(texts[i-1])
                                if 0.0 <= possible_rating <= 5.0:
                                    rating_val = possible_rating
                            except ValueError:
                                pass
                                
                # Shop Location is usually near the end of the text list
                junk_suffixes = ['tìm sản phẩm tương tự', 'ad', 'tài trợ']
                candidate_locations = [t for t in texts if t.lower() not in junk_suffixes and 'ngày' not in t.lower() and 'đã bán' not in t.lower() and t != '']
                if len(candidate_locations) > 0:
                    shop_location = candidate_locations[-1]
                
                # Image
                img_ele = item.ele('css:img', timeout=0)
                img_url = img_ele.attr('src') if img_ele else ""
                
                # Link
                link_ele = item.ele('css:a', timeout=0)
                url = link_ele.attr('href') if link_ele else ""
                if url and not url.startswith('http'):
                    url = f"https://shopee.vn{url}"

                # Parse price string (e.g. "₫12.500.000" -> 12500000)
                # handle ranges like "₫1000 - ₫2000" by taking the first one
                first_price_part = raw_price.split('-')[0]
                price_value = int(''.join(filter(str.isdigit, first_price_part))) if any(c.isdigit() for c in first_price_part) else 0

                results.append({
                    "title": title.strip(),
                    "price": price_value,
                    "url": url,
                    "image": img_url,
                    "rating": rating_val,
                    "sold": sold_val,
                    "shop": shop_location
                })
            except Exception as e:
                print(f"Error parsing item: {e}", file=sys.stderr)
                continue
                
        return results

    except Exception as e:
        print(f"General Scraper Error: {str(e)}", file=sys.stderr)
        return []
        
    finally:
        page.quit()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(1)
        
    query = sys.argv[1]
    results = search_shopee(query, max_items=10)
    
    # Node.js expecting JSON on stdout
    print(json.dumps(results))
