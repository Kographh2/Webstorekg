# 🎯 Kograph Store - Payment System Update v3.0

## ✨ Fitur Baru & Peningkatan

### 1. **Real-Time Payment Status Pages**
- ✅ **Success Page** (`/payment-status/success`)
  - Menampilkan detail pesanan lengkap
  - Tombol unduh invoice PDF
  - Link ke halaman status pesanan
  - Notifikasi otomatis invoice + produk digital via email

- ⏳ **Pending Page** (`/payment-status/pending`)
  - Countdown timer pembayaran
  - Auto-refresh status payment
  - Instruksi untuk menyelesaikan pembayaran

- ❌ **Failed Page** (`/payment-status/failed`)
  - Alasan kegagalan pembayaran
  - Langkah-langkah troubleshooting
  - Opsi untuk mencoba pembayaran ulang

### 2. **Sistem Pembayaran Otomatis & Real-Time**
- Integrasi **Gorekk QRIS** dengan real-time status updates
- COD (Cash on Delivery) dengan konfirmasi instant
- Auto-verifikasi status pembayaran setiap 5 detik
- Webhook handler untuk notifikasi pembayaran dari Gorekk
- PDF invoice generation dan pengiriman email otomatis
- Digital product delivery via email dengan attachment asli dari Supabase Storage

### 3. **Database Schema Updates**
Kolom baru ditambahkan untuk tracking:
- `transaction_id` - ID transaksi dari Gorekk/invoice
- `payment_method` - Metode pembayaran (`gorekk` / `cod`)
- `payment_status` - Status pembayaran (`pending` / `paid` / `failed` / `expired`)
- `payment_confirmed_at` - Waktu konfirmasi pembayaran
- `expires_at` - Waktu kadaluarsa pembayaran
- `payment_notifications` table untuk audit trail

### 4. **Payment Utilities & Hooks**
- `usePaymentStatus()` - Hook untuk polling status pembayaran
- `useOrderStatusSubscription()` - Real-time status updates via Supabase
- `payment-utils.ts` - Helper functions untuk payment logic
- Validasi email & nomor telepon Indonesia

## 🚀 Instalasi & Setup

### 1. Update Environment Variables
```env
# Gorekk Payment Gateway
GOREKK_API_KEY=your_gorekk_api_key
GOREKK_STATIC_QR=your_gorekk_static_qr
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app

# SMTP Configuration (untuk invoice & digital product email)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=Kograph Store <noreply@kographstore.com>

# Supabase (sudah ada)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# COD
NEXT_PUBLIC_COD_ENABLED=true
```

### 2. Update Database Schema
Jalankan migration:
```bash
# Pastikan kolom payment_status, payment_method, transaction_id, payment_confirmed_at, expires_at
# sudah ada di tabel orders, dan tabel payment_notifications sudah dibuat.
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Update Gorekk Configuration
- Set webhook/callback URL di Gorekk Dashboard ke: `https://your-domain.vercel.app/api/payments/gorekk-notification`
- Pastikan API key dan Static QR sesuai
- Set `NEXT_PUBLIC_APP_URL` ke domain Vercel kamu

## 📝 API Endpoints

### POST `/api/payments/gorekk`
Membuat transaksi pembayaran Gorekk QRIS atau COD

**Request Body:**
```json
{
  "orderId": "order-123",
  "amount": 150000,
  "email": "customer@example.com",
  "phone": "08123456789",
  "customerName": "John Doe",
  "paymentMethod": "gorekk|cod",
  "itemDetails": [
    {
      "id": "prod-1",
      "price": 100000,
      "quantity": 1,
      "name": "Product Name"
    }
  ],
  "shippingAddress": {
    "full_name": "John Doe",
    "phone": "08123456789",
    "email": "customer@example.com",
    "address": "Jl. Example No. 123",
    "city": "Jakarta",
    "postal_code": "12345"
  }
}
```

**Response:**
```json
{
  "success": true,
  "status": "pending|confirmed",
  "invoiceId": "gorekk-invoice-id",
  "qrImageUrl": "https://...",
  "orderId": "order-123",
  "transactionId": "transaction-123"
}
```

### GET `/api/payments/gorekk?invoiceId=...`
Mengecek status pembayaran dari Gorekk

### POST `/api/payments/gorekk-notification`
Webhook dari Gorekk untuk notifikasi pembayaran otomatis

### POST `/api/invoices`
Mengirim invoice PDF ke email customer

### POST `/api/products/send-digital`
Mengirim produk digital (file asli dari Supabase Storage) ke email customer

### GET `/api/invoices?order_id=...`
Download invoice PDF untuk order tertentu

## 🔄 Payment Flow

### Gorekk QRIS Payment Flow
```
1. Customer di Checkout Page
   ↓
2. Select "Pembayaran Online (QRIS)" → Click "Pesanan Sekarang"
   ↓
3. API `/api/payments/gorekk` create transaction
   ↓
4. Tampilkan QR Gorekk + timer countdown
   ↓
5. Customer scan QR & bayar via aplikasi bank/e-wallet
   ↓
6. Auto-check status every 5 seconds + Supabase Realtime subscription
   ↓
7. Webhook notification dari Gorekk → Update status orders
   ↓
8. Auto-send invoice PDF + digital products via email
   ↓
9. Redirect ke /payment-status/success
```

### COD Payment Flow
```
1. Customer di Checkout Page
   ↓
2. Select "Bayar di Tempat (COD)" → Click "Pesanan Sekarang"
   ↓
3. API `/api/payments/gorekk` set status to confirmed
   ↓
4. Order status updated immediately
   ↓
5. Redirect ke /payment-status/success
```

## 🐛 Bug Fixes

1. **Payment Status Stuck on Menunggu**
   - Fixed: Webhook handler sekarang memetakan status Gorekk (`paid`/`pending`/`expired`/`failed`) ke `payment_status` orders secara langsung.

2. **Digital Product Link Terbuka ke Public**
   - Fixed: File digital sekarang di-download dari Supabase Storage di server, lalu di-attach ke email customer. Tidak ada link publik di UI.

3. **Invoice PDF 500 Error**
   - Fixed: Menambahkan fallback nilai untuk field opsional (`subtotal`, `total_amount`) saat generate PDF.

4. **SMTP Not Configured Crash**
   - Fixed: API `/api/products/send-digital` dan `/api/invoices` sekarang aman jika `SMTP_*` belum diisi, tidak lagi 500.

5. **Missing Dependencies**
   - Fixed: Menambahkan `iconv-lite` untuk mendukung PDFKit.
   - Fixed: Menghapus `@next/swc-win32-x64-msvc` yang menyebabkan kegagalan build di Windows.

## 📱 Frontend Components

### Payment Status Pages
- `src/app/payment-status/success/page.tsx`
- `src/app/payment-status/pending/page.tsx`
- `src/app/payment-status/failed/page.tsx`

### Updated Components
- `src/components/checkout-page.tsx` - Gorekk QRIS + COD flow
- `src/app/api/payments/gorekk/route.ts` - Payment API
- `src/app/api/payments/gorekk-notification/route.ts` - Webhook handler
- `src/app/api/invoices/route.ts` - PDF invoice generation + email
- `src/app/api/products/send-digital/route.ts` - Digital product email delivery

## 🛠️ Utilities & Hooks

### Payment Utils (`src/lib/payment-utils.ts`)
- `calculateShipping()` - Calculate shipping cost
- `calculateTaxAmount()` - Calculate tax
- `isValidEmail()` - Email validation
- `isValidPhoneNumber()` - Phone number validation
- `formatPhoneNumber()` - Format phone to standard
- `generateOrderId()` - Generate unique order ID
- `validatePaymentData()` - Comprehensive payment validation

### Gorekk Client (`src/lib/gorekk.ts`)
- `createGorekkQris()` - Buat QRIS invoice di Gorekk
- `getGorekkInvoiceStatus()` - Cek status pembayaran dari Gorekk

### Hooks (`src/hooks/usePaymentStatus.ts`)
- `usePaymentStatus()` - Poll payment status
- `useOrderStatusSubscription()` - Real-time Supabase updates

## 📊 Database Schema

### Orders Table (Updated)
```sql
ALTER TABLE orders ADD COLUMN:
- transaction_id TEXT
- payment_method TEXT CHECK (payment_method IN ('gorekk', 'cod'))
- payment_status TEXT CHECK (payment_status IN ('pending', 'paid', 'failed', 'expired'))
- payment_confirmed_at TIMESTAMP
- expires_at TIMESTAMP
```

### Payment Notifications Table (New)
```sql
CREATE TABLE payment_notifications (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders,
  transaction_id TEXT,
  status TEXT,
  response_data JSONB,
  created_at TIMESTAMP
)
```

## 🔒 Security Measures

1. **Webhook Validation** - Handle notification dari Gorekk dengan aman
2. **Server-Side Validation** - Verify semua payment data di backend
3. **Rate Limiting** - Prevent brute force attempts
4. **HTTPS Only** - Ensure all payment requests encrypted
5. **Secure Keys** - Store sensitive keys di environment variables
6. **Digital Product Protection** - File digital tidak di-expose via link publik, hanya dikirim via email

## 🧪 Testing

### Manual Testing Gorekk
1. Use Gorekk sandbox/production credentials
2. Test QRIS payment flow:
   - Scan QR dan bayar
   - Cek status update otomatis ke `paid`
   - Cek email invoice dan produk digital terkirim

### Testing COD
1. Select COD payment method
2. Order status should immediately be "confirmed"
3. Check `/payment-status/success`

## 📚 Additional Resources

- [Gorekk Documentation](https://www.gorekk.web.id)
- [QRIS Integration Guide](https://www.gorekk.web.id/docs)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [Supabase Storage](https://supabase.com/docs/guides/storage)
- [PDFKit Documentation](https://pdfkit.org/)

## ⚡ Performance Optimization

- Payment status polling berjalan setiap 5 detik (configurable)
- Status cache 10 detik untuk avoid rate limit Gorekk
- Database indexes untuk faster queries
- Efficient Supabase subscription untuk real-time updates
- Optimized image & asset loading

## 🚀 Deployment Checklist

- [ ] Update environment variables di Vercel (`GOREKK_*`, `SMTP_*`, `NEXT_PUBLIC_APP_URL`)
- [ ] Set callback URL di Gorekk Dashboard ke `https://your-domain.vercel.app/api/payments/gorekk-notification`
- [ ] Pastikan `SMTP_*` terkonfigurasi untuk invoice & digital product email
- [ ] Test payment flow end-to-end dengan Gorekk QRIS
- [ ] Monitor webhook notifications di Vercel logs
- [ ] Setup email notifications untuk customers
- [ ] Backup database sebelum deployment

## 📞 Support & Troubleshooting

### Payment not confirming
- Check Gorekk API key & Static QR
- Verify callback URL di Gorekk dashboard
- Check logs di `/api/payments/gorekk-notification`
- Cek apakah `payment_status` updated ke `paid` setelah bayar

### Digital product email not sent
- Pastikan `SMTP_*` terkonfigurasi di Vercel
- Check file digital ada di Supabase Storage bucket `digital-products`
- Cek logs di `/api/products/send-digital`

### Invoice PDF 500 error
- Pastikan `SMTP_*` terkonfigurasi
- Check order data lengkap di database (`subtotal`, `total_amount`, `shipping_address`)
- Cek logs di `/api/invoices`

### Timeout issues
- Check network connectivity
- Verify Gorekk API status
- Check polling interval settings

---

**Version:** 3.0  
**Last Updated:** August 27, 2026  
**Author:** Kograph Store Development Team
