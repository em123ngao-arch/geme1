# Cẩm nang Đưa Trò chơi Lên Mạng (Deployment)

Đây là 2 cách để bạn có thể mang tựa game tâm huyết này rủ bạn bè cùng chơi:

## Cách 1: Nhanh gọn lẹ (Dùng ngrok - Chơi tạm thời)
Cách này phù hợp để bạn mở Server từ chính máy tính của mình và mời bạn bè vào chơi ngay lập tức mà không cần cấu hình phức tạp.

**Bước 1: Cài đặt ngrok**
- Lên trang chủ [ngrok.com](https://ngrok.com/), đăng ký 1 tài khoản miễn phí và tải ngrok về máy.
- Mở Terminal/Command Prompt lên và chạy lệnh kết nối tài khoản (lệnh này ngrok sẽ cung cấp khi bạn đăng nhập).

**Bước 2: Mở đường hầm cho Game**
- Game của bạn (Frontend) chạy ở port `5173`.
- Gõ lệnh này vào terminal: `ngrok http 5173`
- Ngrok sẽ tạo ra một đường link màu xanh (ví dụ: `https://abcd-12-34-56.ngrok-free.app`). 
- Gửi link này cho bạn bè, họ mở bằng điện thoại hay máy tính đều chơi được!

*(Lưu ý: Máy tính của bạn phải luôn bật chạy Server `npm run dev` ở cả thư mục `client` và `server` trong suốt quá trình bạn bè đang chơi).*

---

## Cách 2: Triển khai Chuyên nghiệp (Chạy 24/7 Miễn phí)
Nếu bạn muốn game luôn luôn sống, ai thích vào lúc nào cũng được, hãy đẩy source code lên các nền tảng Cloud.

**1. Tách Server (Backend) lên Render.com**
- Tạo 1 kho lưu trữ (Repository) trên GitHub và tải toàn bộ thư mục `server` lên đó.
- Vào trang [Render.com](https://render.com/), chọn tạo **Web Service** mới, trỏ đến kho GitHub của bạn.
- Thiết lập Environment Variables: Thêm biến `GEMINI_API_KEY` của bạn vào phần cài đặt của Render.
- Sau khi Render chạy xong, bạn sẽ có 1 đường link Backend (vd: `https://my-game-api.onrender.com`).

**2. Tách Client (Frontend) lên Vercel.com**
- Sửa lại code trong `client/src/socket.js` và `client/src/pages/Lobby.jsx`: Thay dòng chữ `http://localhost:3001` bằng đường link Backend mà Render vừa cấp cho bạn.
- Tải thư mục `client` lên GitHub.
- Vào trang [Vercel.com](https://vercel.com/), chọn **Add New Project**, chọn thư mục Client của bạn.
- Bấm Deploy. Vercel sẽ cho bạn 1 đường link trang web chính thức cực xịn.

> [!TIP]
> Bạn có thể bắt đầu với **Cách 1** trước để cho đứa bạn thân "test" độ khó của các câu hỏi do AI tạo ra. Khi mọi thứ đã hoàn hảo thì mới làm **Cách 2** để phổ biến cho nhiều người hơn nhé!
