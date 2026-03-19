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

7. **Bypass CAPTCHA Shopee (Giải pháp triệt để):**
   Hệ thống sử dụng cơ chế giả lập vân tay trình duyệt (fingerprinting) và gõ phím như người thật để tránh bị Shopee block. Tuy nhiên, thi thoảng Shopee vẫn sẽ hiện CAPTCHA. Cách xử lý:
   
   - **Bước 1 (Trên máy tính cá nhân):** Mở Terminal/CMD và tạo SSH Tunnel để "mượn" trình duyệt đang chạy trên VPS:
     ```bash
     ssh -L 9223:localhost:9223 root@ip_cua_vps
     ```
   - **Bước 2:** Mở trình duyệt Chrome trên máy cá nhân, truy cập địa chỉ: `http://localhost:9223`.
   - **Bước 3:** Bạn sẽ thấy danh sách các Tab đang mở trên VPS. Hãy chọn Tab Shopee đang bị kẹt CAPTCHA.
   - **Bước 4:** Giải CAPTCHA bằng tay ngay trên trình duyệt máy bạn (reCAPTCHA hoặc kéo thanh trượt). 
   - **Lưu ý quan trọng:** Không được đóng các Tab này! Worker được thiết kế để giữ lại Tab nhằm duy trì trạng thái đăng nhập và "độ tin cậy" (trust score) của trình duyệt đối với Shopee. 

8. **Tối ưu RAM cho VPS (Quan trọng):**
   Mỗi khi hệ thống cào xong, scraper sẽ tự động dọn dẹp cache trình duyệt và ép nhả RAM (garbage collection) để đảm bảo VPS có thể chạy ổn định lâu dài ngay cả với cấu hình thấp (2GB-4GB RAM).

---

## Phần 2: Triển khai Frontend lên Vercel Serverless

1. Đăng nhập vào [Vercel.com](https://vercel.com) (Liên kết bằng tài khoản Github của bạn).
2. Chọn **Add New Project**, cấp phép hiển thị repo và import thư mục React/NextJS Frontend của bạn.
3. Trong giao diện chuẩn bị cấu hình (mục **Environment Variables**), khai báo gốc rễ API vào VPS:
   - Tên biến: `NEXT_PUBLIC_API_URL`
   - Giá trị: `https://api.ten_mien_cua_ban.com` (Tuyệt đối **KHÔNG CÓ** chữ `/api` phía sau nhé, vì code đã tự nối `/api` vào URL rồi).
4. Click nút **Deploy** và nhấm nháp ly cà phê. Vercel sẽ tự động build front-end, rải nội dung khắp thế giới và chỏ ngược mọi lời gọi API data về VPS cào deal của bạn!
