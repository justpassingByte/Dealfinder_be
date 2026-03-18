# Hướng Dẫn Triển Khai DealFinder (Kiến trúc phân tán)

Kiến trúc mới nhất:
- **Frontend:** Triển khai hoàn toàn miễn phí trên **Vercel** giúp tối ưu tốc độ load thông qua CDN toàn cầu.
- **Backend & Database:** Triển khai độc lập trên **VPS cá nhân** (Ví dụ: VPS 4 Cores, 4GB RAM) bao gồm Node API, BullMQ Worker, trình duyệt cào dữ liệu, PostgreSQL nội bộ và Redis.

---

## Phần 1: Triển khai Backend + Database lên VPS

1. **Đăng nhập vào VPS:**
   ```bash
   ssh root@ip_cua_vps
   ```

2. **Cài đặt Docker & Git (Nếu VPS chưa cài):**
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
   apt-get update && apt-get install git -y
   ```

3. **Clone Repo Backend:**
   ```bash
   mkdir -p /var/www/dealfinder && cd /var/www/dealfinder
   git clone https://github.com/justpassingByte/Dealfinder_be.git backend
   cd backend
   ```

4. **Cấu hình biến môi trường (`.env`):**
   ```bash
   cp .env.example .env
   nano .env
   ```
   *Lưu ý chỉnh sửa các thông số thiết yếu sau:*
   - `PRODUCTION_DOMAIN=api.ten_mien_cua_ban.com` (Đảm bảo đã khai báo bản ghi DNS trỏ về IP của VPS)
   - Khai báo CSDL Postgres nội bộ (sẽ chạy trực tiếp trên VPS thay thế Supabase):
     ```env
     POSTGRES_USER=postgres
     POSTGRES_PASSWORD=MatKhauChoDatabaseCuaBan123!
     POSTGRES_DB=dealfinder
     DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
     ```

5. **Dựng Hệ Thống (Build Containers):**
   ```bash
   docker compose up -d --build
   ```
   *Quá trình này cất đi gánh nặng của NextJS, tự dựng lên PostgreSQL local, Redis, Backend (hứng API) và Worker queue.*

6. **Khởi tạo Database & Chạy Migration (Rất Quan Trọng):**
   Đợi khoảng 30s sau khi Docker chạy lên, thực thi các lệnh sau để nạp cấu trúc rỗng cho CSDL:
   ```bash
   docker compose exec backend npm run migrate
   docker compose exec backend npm run migrate:catalog
   ```

7. **Bypass CAPTCHA Shopee (Giữ nguyên như cũ):**
   Vì thuật toán cào của Worker sẽ gặp phải CAPTCHA, mở cửa sổ Terminal (hoặc CMD) **BÊN TRONG MÁY TÍNH CÁ NHÂN CỦA BẠN (KHÔNG PHẢI VPS)** và gõ:
   ```bash
   ssh -L 9222:localhost:9222 root@ip_cua_vps
   ```
   Sau đó mở Google Chrome, lướt địa chỉ `http://localhost:9222`, chọn Tab Shopee giả lập và tick Captcha bằng tay. Nó sẽ vượt rào mọi công nghệ anti-bot.

---

## Phần 2: Triển khai Frontend lên Vercel Serverless

1. Đăng nhập vào [Vercel.com](https://vercel.com) (Liên kết bằng tài khoản Github của bạn).
2. Chọn **Add New Project**, cấp phép hiển thị repo và import thư mục React/NextJS Frontend của bạn.
3. Trong giao diện chuẩn bị cấu hình (mục **Environment Variables**), khai báo gốc rễ API vào VPS:
   - Tên biến: `NEXT_PUBLIC_API_URL`
   - Giá trị: `https://api.ten_mien_cua_ban.com/api` (Nhập đúng định dạng `URL VPS ở Bước 4` kèm theo đuôi `/api`).
4. Click nút **Deploy** và nhấm nháp ly cà phê. Vercel sẽ tự động build front-end, rải nội dung khắp thế giới và chỏ ngược mọi lời gọi API data về VPS cào deal của bạn!
