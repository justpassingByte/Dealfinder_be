# Hướng Dẫn Triển Khai DealFinder (2 Repository Riêng Biệt)

Vì bạn sử dụng 2 Repository riêng cho Backend và Frontend, chúng ta sẽ sử dụng Repo Backend làm trung tâm điều khiển (Master).

---

## Bước 1: Chuẩn bị trên máy tính cá nhân
Đảm bảo bạn đã push bản cập nhật mới nhất cho cả 2 repo:
- **Tại folder backend:** `git add . && git commit -m "chore: setup orchestrator" && git push origin main`
- **Tại folder frontend:** `git add . && git commit -m "chore: production ready" && git push origin main`

---

## Bước 2: Triển khai trên VPS (Chi tiết từng lệnh)

1. **Đăng nhập vào VPS:**
   ```bash
   ssh root@ip_cua_vps
   ```

2. **Cài đặt Docker (Nếu VPS chưa có):**
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
   ```

3. **Clone cả 2 Repo về cùng một thư mục:**
   ```bash
   mkdir -p /var/www/dealfinder && cd /var/www/dealfinder
   
   # Clone Backend
   git clone https://github.com/justpassingByte/Dealfinder_be.git backend
   
   # Clone Frontend (Bắt buộc đặt tên folder là 'frontend')
   git clone https://github.com/justpassingByte/DealFinder_fe.git frontend
   ```
   *Lưu ý: Sau khi clone, bạn sẽ có cấu trúc:*
   - `/var/www/dealfinder/backend`
   - `/var/www/dealfinder/frontend`

4. **Cấu hình Environment:**
   ```bash
   cd backend
   nano .env
   ```
   Thêm các dòng vào đầu file (thay bằng tên miền của bạn):
   ```bash
   PRODUCTION_DOMAIN=smartdeal.vn
   PRODUCTION_URL=https://smartdeal.vn
   ```

5. **Chạy hệ thống:**
   Tại folder `backend`, chạy lệnh:
   ```bash
   docker compose up -d --build
   ```

---

## Bước 3: Giải CAPTCHA từ xa (SSH Tunnel)
Khi Shopee yêu cầu giải CAPTCHA, hãy mở Terminal TRÊN MÁY TÍNH CỦA BẠN và chạy:
```bash
ssh -L 9222:localhost:9222 root@ip_cua_vps
```
Sau đó mở trình duyệt tại máy bạn, truy cập: `http://localhost:9222`, chọn tab Shopee để giải tay.

---

## Bước 4: Khởi tạo Database
```bash
docker compose exec backend npm run migrate
docker compose exec backend npm run migrate:catalog
```
