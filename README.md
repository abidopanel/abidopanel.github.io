# Admin Panel — Kampion

Panel admin web statis (SPA) untuk memantau **Google Search Console** dan **DigitalOcean** dari satu halaman. Data ditarik langsung dari API pihak ketiga (token disimpan di browser, bukan di server).

## Fitur

### Google (`?page=google`)
- Grafik Clicks & Impression per properti Search Console (ApexCharts).
- Badge CTR, Total Click, Total Impression.
- Urutkan berdasarkan click/impression (terbaru & total, ASC/DESC).
- Tampilan harian atau per jam (`HOUR`).
- Status DNS domain: **Live / Died** (via `dns.google`).

### Digital Ocean (`?page=digitalocean`)
- Daftar akun: email, status, balance, limit droplet.
- Daftar droplet: IP, size slug, vcpu / ram / disk, metrik CPU & Memory, **uptime** (dihitung dari `created_at`).
- Aksi langsung: **Power On/Off**, **Upgrade/Resize** (coba beberapa size berurutan), **Delete**.
- Penanda domain yang mengarah ke IP droplet (pencocokan DNS via `dns.google`).
- Panel tiap API key tetap tampil meski error (401/dsb) lengkap dengan API key-nya.

## Struktur File

| File | Keterangan |
|------|------------|
| `index.html` | UI utama: navbar, modal **Settings** (input data), tema custom, logika umum & helper (`getIpDomain`, token Google, localStorage cache). |
| `google.js` | Logika halaman Google (Search Console). |
| `digitalocean.js` | Logika halaman DigitalOcean (akun, droplet, metrik, uptime, aksi). |

## Input Data (tombol di navbar → modal Settings)

- **Google**: satu **refresh token** OAuth 2.0 per baris (bukan JSON) — `1//04...`
  (access token di-generate otomatis & di-cache di cookie).
- **Digital Ocean**: satu **API token** per baris (bukan JSON) — `dop_v1_...`
- **Local Data**: satu **domain** per baris (bukan JSON) — digunakan untuk mengecek
  apakah domain benar mengarah ke IP droplet (Live/Died) dan menampilkan domain terkait di tiap droplet.

Data disimpan di `localStorage` (TTL sesuai pilihan periode) sehingga tidak perlu diisi ulang setiap buka.

## Tema

Tema custom minimal (font **Inter**, warna netral, kartu membulat, responsif mobile).
Tombol mode (ikon bulan/matahari) di navbar men-switch light/dark via atribut `data-bs-theme`.

## Stack

HTML · jQuery 3.7 · Bootstrap 5.3 · Bootstrap Icons · ApexCharts.

## Catatan Keamanan

- Token API & refresh token disimpan di **browser** (localStorage/cookie) dan dikirim langsung ke API Google/DigitalOcean dari sisi klien.