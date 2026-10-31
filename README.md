# Zero Trust Security – Sistem Informasi Nilai dan Transkrip

## 1. Deskripsi Proyek

Proyek ini merupakan implementasi konsep **Zero Trust Security** pada sistem informasi akademik untuk pengelolaan nilai dan transkrip mahasiswa.

Sistem menerapkan prinsip *Never Trust, Always Verify*, yaitu setiap permintaan akses harus melalui proses autentikasi, verifikasi perangkat, dan pemeriksaan kebijakan akses sebelum diteruskan ke layanan tujuan.

Sistem terdiri atas API Gateway, Policy Engine, Grade Service, dan Transcript Service yang menggunakan satu database bersama.

## 2. Teknologi yang Digunakan

- Node.js
- Express.js
- SQLite
- Better-SQLite3
- JSON Web Token (JWT)
- bcryptjs
- HTTP Proxy / API Gateway
- REST Client Extension pada Visual Studio Code

## 3. Arsitektur Sistem

### Komponen utama

| Komponen | Port | Fungsi |
|---|---:|---|
| API Gateway | 3000 | Pintu masuk seluruh permintaan API |
| Grade Service | 3001 | Pengelolaan nilai dan finalisasi kelas |
| Transcript Service | 3002 | Pengelolaan dan penyimpanan transkrip |
| Policy Engine | - | Pemeriksaan hak akses berdasarkan kebijakan |
| Shared Database | - | Penyimpanan data seluruh layanan |

### Alur komunikasi

1. Pengguna mengirim permintaan melalui API Gateway.
2. Gateway memverifikasi access token dan device ID.
3. Policy Engine mengevaluasi hak akses pengguna.
4. Gateway meneruskan permintaan ke service tujuan dengan Gateway Secret.
5. Service memverifikasi Gateway Secret dan JWT.
6. Service memproses permintaan sesuai kewenangannya.
7. Gateway mencatat hasil permintaan ke audit log.

Pada proses finalisasi, Grade Service memperoleh Service Token dan meminta sinkronisasi transkrip melalui Gateway.

## 4. Struktur Folder

```text
zero-trust/
├── gateway/
│   ├── server.js
│   ├── auth.js
│   ├── middleware.js
│   └── policy-engine.js
├── services/
│   ├── nilai/
│   │   └── server.js
│   └── transkrip/
│       └── server.js
├── shared/
│   ├── database.js
│   ├── service-auth.js
│   └── zero-trust.db
├── .env
├── .gitignore
├── package.json
└── zero-trust-test.http
```

## 5. Instalasi dan Konfigurasi

### Persyaratan

- Node.js dan npm
- Visual Studio Code
- REST Client Extension

### Instalasi dependensi

Buka terminal pada direktori proyek, kemudian jalankan:

```bash
npm install
```

### Konfigurasi environment

Buat atau sesuaikan file `.env`:

```dotenv
PORT_GATEWAY=3000
PORT_NILAI=3001
PORT_TRANSKRIP=3002

JWT_ACCESS_SECRET=GANTI_DENGAN_SECRET_ACAK
JWT_REFRESH_SECRET=GANTI_DENGAN_SECRET_ACAK
GATEWAY_SECRET=GANTI_DENGAN_SECRET_ACAK

SERVICE_CLIENT_ID=grade-service
SERVICE_CLIENT_SECRET=GANTI_DENGAN_SECRET_ACAK

ACCESS_TOKEN_MINUTES=10
REFRESH_TOKEN_DAYS=1
SERVICE_TOKEN_MINUTES=5

DB_PATH=./shared/zero-trust.db

ACCESS_START_HOUR=7
ACCESS_END_HOUR=21
```

Gunakan secret acak yang kuat dan jangan membagikan file `.env` berisi secret asli.

## 6. Menjalankan Sistem

Jalankan setiap service menggunakan tiga terminal terpisah.

**Terminal 1 – API Gateway**

```bash
npm run gateway
```

**Terminal 2 – Grade Service**

```bash
npm run nilai
```

**Terminal 3 – Transcript Service**

```bash
npm run transkrip
```

Jika berhasil, ketiga service berjalan pada port masing-masing.

### Pemeriksaan Gateway

```http
GET http://localhost:3000/health
```

Respons yang diharapkan:

```json
{
  "status": "ok"
}
```

## 7. Akun Pengujian

Akun berikut merupakan data demo yang digunakan dalam pengujian sistem.

| Username | Password | Role | Device ID |
|---|---|---|---|
| admin | Admin123! | admin | device-admin-001 |
| dosen1 | Dosen123! | dosen | device-dosen1-001 |
| dosen2 | Dosen123! | dosen | device-dosen2-001 |
| mhs1 | Mhs12345! | mahasiswa | device-mhs1-001 |
| mhs2 | Mhs12345! | mahasiswa | device-mhs2-001 |
| mhs3 | Mhs12345! | mahasiswa | device-mhs3-001 |

**Data kelas demo:**

| ID | Nama Kelas | Dosen Pengampu |
|---:|---|---|
| 1 | Keamanan Informasi A | dosen1 |
| 2 | Keamanan Informasi B | dosen2 |

Password di atas hanya untuk lingkungan demonstrasi lokal.

## 8. Daftar Endpoint API

Seluruh endpoint layanan akademik diakses melalui API Gateway pada port 3000.

### Authentication

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/auth/login` | Login pengguna |
| POST | `/auth/refresh` | Memperbarui access token |
| POST | `/auth/logout` | Mencabut refresh token |
| POST | `/auth/service` | Memperoleh service token untuk Grade Service |

### Grade Service

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/nilai` | Melihat nilai sesuai role |
| PUT | `/nilai/:id` | Mengubah nilai |
| POST | `/kelas/:id/finalisasi` | Memfinalisasi nilai kelas |

### Transcript Service

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/transkrip/:nim` | Melihat transkrip mahasiswa |
| POST | `/transkrip/sinkron` | Sinkronisasi transkrip oleh Grade Service |

## 9. Kebijakan Akses

| Role | Hak Akses |
|---|---|
| Mahasiswa | Melihat nilai dan transkrip milik sendiri |
| Dosen | Melihat, mengubah, dan memfinalisasi nilai pada kelas yang diajar |
| Admin | Melihat transkrip seluruh mahasiswa |
| Service | Melakukan sinkronisasi transkrip sesuai identitas dan kebijakan service |

Kebijakan tambahan:

- Semua endpoint akademik wajib melewati API Gateway.
- Setiap permintaan pengguna wajib menggunakan access token dan device ID terdaftar.
- Access token berlaku selama 10 menit.
- Refresh token berlaku selama 1 hari dan dapat dicabut.
- Service Token berlaku selama 5 menit.
- Perubahan dan finalisasi nilai hanya diizinkan pukul 07.00–21.00.
- Setiap permintaan dicatat dalam audit log.

## 10. Pengujian Sistem

Pengujian dilakukan menggunakan REST Client Extension pada Visual Studio Code.

File pengujian:

```text
zero-trust-test.http
```

Skenario pengujian meliputi:

1. Login pengguna.
2. Permintaan tanpa access token.
3. Permintaan tanpa device ID.
4. Permintaan dengan device tidak terdaftar.
5. Mahasiswa melihat nilai sendiri.
6. Mahasiswa mencoba mengubah nilai.
7. Dosen melihat nilai kelas yang diajar.
8. Dosen mencoba mengubah nilai kelas dosen lain.
9. Finalisasi kelas oleh dosen pengampu.
10. Admin melihat transkrip mahasiswa.
11. Mahasiswa mencoba mengakses sinkronisasi transkrip.
12. Pemeriksaan audit log.
13. Refresh token.
14. Logout dan pengujian pencabutan refresh token.

Hasil pengujian menunjukkan bahwa sistem dapat memberikan izin atau penolakan berdasarkan identitas, role, perangkat, kepemilikan data, dan kebijakan akses.

## 11. Database

Database menggunakan SQLite dengan tabel:

- `users`
- `devices`
- `classes`
- `grades`
- `refresh_tokens`
- `audit_logs`
- `transcripts`

Database dibuat dan dikelola melalui `shared/database.js`.

## 12. Audit Log

Setiap aktivitas akses dicatat dengan informasi:

- Timestamp
- Subject
- Endpoint
- Device ID
- Result (`allow` atau `deny`)
- Reason

Audit log digunakan untuk membantu pemantauan dan penelusuran aktivitas akses sistem.

## 13. Penutup

Implementasi ini menunjukkan penerapan prinsip Zero Trust pada sistem informasi akademik melalui verifikasi identitas, perangkat, hak akses, dan komunikasi antarlayanan. Seluruh layanan akademik ditempatkan di belakang API Gateway sebagai titik pemeriksaan akses terpusat.