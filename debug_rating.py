import json
from DrissionPage import ChromiumOptions, ChromiumPage
import os

co = ChromiumOptions().set_argument('--no-sandbox')
co.set_user_agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
profile_path = os.path.join(os.getcwd(), 'shopee_user_profile')
co.set_user_data_path(profile_path)
page = ChromiumPage(co)

page.get('https://shopee.vn/search?keyword=iphone%2015')
found = page.wait.ele_displayed('css:.shopee-search-item-result__item', timeout=12)
if not found:
    print("Cannot find items")
else:
    items = page.eles('css:.shopee-search-item-result__item')
    for item in items[:5]:
        stars = item.eles('css:svg.icon-rating-solid')
        rating_val = len(stars)

        # Let's see the text lines again
        texts = item.text.split('\n')
        sold_text = ""
        for t in texts:
            if 'đã bán' in t.lower():
                sold_text = t
        
        print("Stars count =", rating_val)
        print("Sold text =", sold_text)
        print("Raw texts =", texts)
        print("------------------------------------------")
page.quit()
