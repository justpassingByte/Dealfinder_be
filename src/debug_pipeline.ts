import { searchPipelineService } from './services/searchPipeline';
import { Listing } from './types/listing';

const rawData = [
    { "title": "Kính Cường Lực VMOX Tự Dán Chống Nhìn Trộm, Trong Suốt, Phù Hợp Nhiều Mẫu iPhone", "price": 32900, "url": "https://shopee.vn/...", "image": "...", "rating": 5.0, "sold": 0, "shop": "Tìm sản phẩm tương tự" },
    { "title": "Điện thoại Apple iPhone 15 128GB", "price": 17690000, "url": "https://shopee.vn/...", "image": "...", "rating": 5.0, "sold": 0, "shop": "Tìm sản phẩm tương tự" },
    { "title": "Cáp sạc nhanh UGREEN PD 100W/240W Type C...", "price": 100240, "url": "https://shopee.vn/...", "image": "...", "rating": 5.0, "sold": 0, "shop": "Tìm sản phẩm tương tự" },
    { "title": "Ốp Lưng Điện Thoại Trong Suốt...", "price": 111213141516, "url": "https://shopee.vn/...", "image": "...", "rating": 5.0, "sold": 0, "shop": "Tìm sản phẩm tương tự" }
];

const listings: Listing[] = rawData.map(item => ({ ...item, marketplace: 'shopee' }));
const query = "iphone 15";

console.log("Processing query:", query);
const results = searchPipelineService.process(listings, query, 10);
console.log("Filtered Results Count:", results.length);
results.forEach(r => console.log(`- ${r.title}: ${r.price}`));
