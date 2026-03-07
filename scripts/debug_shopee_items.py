import sys
import os
import json
import random
import time
from DrissionPage import ChromiumOptions, ChromiumPage

def debug_shopee():
    co = ChromiumOptions().set_argument('--no-sandbox')
    co.set_argument('--disable-gpu')
    co.set_argument('--blink-settings=imagesEnabled=false')
    
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ]
    co.set_user_agent(random.choice(user_agents))

    profile_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shopee_user_profile')
    co.set_user_data_path(profile_path)
    
    page = ChromiumPage(co)
    page.get('https://shopee.vn/search?keyword=iphone%2015')
    
    # Wait for items
    time.sleep(2)
    page.wait.ele_displayed('css:.shopee-search-item-result__item, [data-sqe="item"]', timeout=10)
    
    items = page.eles('css:.shopee-search-item-result__item, [data-sqe="item"]')
    print(f"Found {len(items)} items")
    
    debug_data = []
    for item in items[:3]:
        debug_data.append({
            'html': item.html[:500] if item.html else "",
            'text': item.text,
            'lines': [line.strip() for line in item.text.split('\n') if line.strip()]
        })
        
    with open('debug_items.json', 'w', encoding='utf-8') as f:
        json.dump(debug_data, f, ensure_ascii=False, indent=2)
        
    print("Debug output written to debug_items.json")
    page.quit()

if __name__ == '__main__':
    debug_shopee()
