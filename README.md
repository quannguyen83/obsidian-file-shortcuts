# File Shortcuts for Obsidian

Tạo một file shortcut có tên dễ đọc trong folder bạn chọn. Bấm shortcut trong **File Explorer của Obsidian** để mở đúng file gốc, ngay trong tab đó. Không cần phím tắt.

Ví dụ: đặt `Thesis/Visual Odometry/KLT khi ảnh bị mờ.obslink` trỏ tới `Zotero PDFs/3FI3GWR4.pdf`. Bạn tự tổ chức folder trong vault; PDF tiếp tục nằm ở đường dẫn đã import.

## Cài đặt v0.1.0

### Qua BRAT

1. Trong BRAT, chọn **Add a beta plugin for testing**.
2. Nhập `quannguyen83/obsidian-file-shortcuts`.
3. Chọn **Add Plugin**, sau đó bật **File Shortcuts** trong Community plugins.

[GitHub Releases](https://github.com/quannguyen83/obsidian-file-shortcuts/releases) chứa riêng `main.js`, `manifest.json`, `styles.css` để BRAT cài và cập nhật.

### Cài ZIP thủ công

**[Tải bản cài ZIP](https://github.com/quannguyen83/obsidian-file-shortcuts/raw/refs/heads/main/release/file-shortcuts-0.1.0.zip)**

1. Giải nén ZIP. Bạn sẽ nhận được folder `file-shortcuts` chứa `main.js`, `manifest.json` và `styles.css`.
2. Chép folder đó vào `<vault>/.obsidian/plugins/`. Kết quả phải là `<vault>/.obsidian/plugins/file-shortcuts/manifest.json`, không lồng thêm một folder nữa.
3. Khởi động lại Obsidian hoặc reload vault.
4. Vào **Settings → Community plugins**, bật **File Shortcuts**. Nếu đang ở Restricted mode, tắt chế độ đó trước.

Yêu cầu Obsidian **1.7.2 trở lên**. Plugin chưa được phát hành vào Community plugins directory; bản ZIP có sẵn file build, không cần Node.js hay build thủ công.

## Sử dụng bằng chuột

### Tạo từ file gốc

1. Chuột phải vào PDF hoặc file bạn muốn trong File Explorer.
2. Chọn **Create shortcut…**.
3. Chọn **Choose folder**, tìm folder có sẵn trong vault.
4. Đặt **Shortcut name**, rồi bấm **Create shortcut**.
5. Bấm file `.obslink` vừa tạo để mở file gốc.

Folder bạn chọn được nhớ cho lần tạo tiếp theo. Hãy tạo các folder mong muốn bằng File Explorer như bình thường.

### Tạo ngay trong folder

Chuột phải vào folder → **Create shortcut here…** → chọn file đích → đặt tên → **Create shortcut**.

Command Palette cũng có hai lệnh tạo shortcut, nhưng bạn không cần dùng phím tắt.

### Đổi tên, di chuyển, xóa

- Đổi tên hoặc chuyển **shortcut** sang folder khác: shortcut vẫn mở cùng file đích.
- Xóa **shortcut**: chỉ xóa file `.obslink`, file gốc vẫn còn.
- Đổi tên hoặc chuyển **file đích/folder chứa file đích** khi plugin đang bật: plugin cập nhật đường dẫn trong các shortcut liên quan.
- File đích đã bị xóa hoặc không còn tìm thấy: shortcut hiện thông báo và nút **Choose target file** để bạn chọn lại.
- Chuột phải shortcut → **Change shortcut target…** để đổi file đích.
- Nếu trùng tên trong folder đã chọn, plugin yêu cầu đổi tên; không ghi đè file đã có.

## Cách hoạt động

Mỗi `.obslink` là một file JSON nhỏ, ví dụ:

```json
{
  "version": 1,
  "target": "Zotero PDFs/3FI3GWR4.pdf"
}
```

Đường dẫn tính từ gốc vault. Khi bạn bấm shortcut, plugin mở **TFile của file đích thật** qua API của Obsidian. PDF viewer nhận đúng đường dẫn `Zotero PDFs/3FI3GWR4.pdf`; không có thêm bản PDF hoặc đường dẫn PDF giả. Các shortcut trỏ cùng một file sẽ làm việc trên cùng file đó.

Plugin hoạt động độc lập với Zotero và dùng được với các loại file mà Obsidian hoặc viewer plugin đã cài có thể mở. Việc chọn viewer do Obsidian và các plugin của bạn quyết định. Nếu PDF Annotator chưa là viewer mặc định, bạn mở chế độ annotation như khi mở PDF gốc. Đồng bộ annotation vẫn do bridge hiện có thực hiện.

## Giới hạn

- **File Shortcuts phải được bật** để bấm `.obslink` và tự mở file đích.
- Đổi tên file đích khi plugin tắt, hoặc đổi tên bằng ứng dụng ngoài Obsidian mà Obsidian chỉ nhận thành xóa/tạo, có thể cần chọn lại target.
- Shortcut trỏ tới file trong **cùng vault**. Khi đồng bộ sang máy khác, cần có cả `.obslink` và file đích đúng đường dẫn; hãy kiểm tra công cụ sync của bạn có bao gồm đuôi `.obslink`.
- Plugin chỉ mở file đích; không tự đồng bộ nội dung PDF hay annotation.

## Phát triển và kiểm tra

```sh
npm ci
npm test
npm run build
```

`npm run build` kiểm tra TypeScript và tạo `main.js`. `npm run package` tạo ZIP cài đặt trong `release/` (cần Python 3 cho bước ZIP). Repo giữ sẵn `main.js` và ZIP để cài thử.

Workflow `Publish plugin release` kiểm tra build/tests và tạo GitHub Release theo version trong `manifest.json`. Khi tăng version trên `main`, workflow đính kèm ba file plugin để BRAT cập nhật. Release đã có sẽ không bị ghi đè.

Các bài kiểm tra tự động bao gồm parse/path validation, shortcut nhiều tầng và vòng lặp, mở đúng TFile, tránh chuyển nhầm tab khi đọc file chậm, tạo shortcut từ menu folder, chặn ghi đè, file đích thiếu và cập nhật đường dẫn khi đổi tên liên tiếp. Tests dùng Obsidian API test doubles; không thay thế kiểm tra trên ứng dụng Obsidian thật.

### Kiểm tra trong Obsidian

1. Tạo shortcut tới một PDF đã có annotation; bấm shortcut và kiểm tra PDF/annotation đúng như mở file gốc.
2. Đổi tên và chuyển shortcut sang folder khác; mở lại.
3. Mở một shortcut bằng thao tác mở tab mới thông thường; kiểm tra tab đó mở file đích.
4. Đổi tên một PDF thử nghiệm, rồi đổi tên folder chứa nó khi plugin đang bật; mở shortcut lại.
5. Xóa shortcut thử nghiệm và kiểm tra PDF vẫn còn.
6. Với một file thử nghiệm khác, xóa file đích; mở shortcut và dùng **Choose target file** để sửa liên kết.

License: MIT.
