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
- Daftar akun: email, **API key**, status, balance, limit droplet.
- Daftar droplet: IP, size slug, vcpu / ram / disk, metrik CPU & Memory, **uptime** (dihitung dari `created_at`).
- **Aksi per droplet**: Power On/Off, Upgrade/Resize (pilih size), Delete.
- **Aksi massal** (berdasarkan checkbox): **Turn On**, **Turn Off**, **Restart**, **Delete** + **Select All** per kartu.
- **Create Droplets**: tombol `[bi-repeat] Droplets` di tiap kartu membuat droplet (batch 10) dengan jumlah dari select `1..droplet_limit`; hasilnya langsung di-append ke card.
- **Hunt**: tombol `Hunt` memeriksa IP droplet via **VirusTotal worker** (banned list → verifikasi DNS `dns.google`) dan menulis Match ke **Local Data** secara realtime.
- **Enrichment domain**: tiap domain di kartu menampilkan **DR** (ahrefs), **rank/traffic/links** (seoquake) lewat worker; hasil di-cache di localStorage 4 jam dan dihapus saat droplet terkait dihapus.
- **Search**: input full-width di bawah notifikasi untuk memfilter droplet (id, ip, slug, vcpu, ram, cpu, domain).
- **Floating log**: panel log melayang kanan-bawah (tombol `Clear`), menampilkan hasil create/hunt (Match hijau, Mismatch/skipped warna default).
- Panel tiap API key tetap tampil meski error (401/dsb) lengkap dengan API key-nya.

## Struktur File

| File | Keterangan |
|------|------------|
| `index.html` | UI utama: navbar (jam freeze, tema), modal **Settings**, modal Clear Cache, floating log, input search, logika umum & helper (`getIpDomain`, token Google, `setcache_localstorage`). |
| `google.js` | Logika halaman Google (Search Console). |
| `digitalocean.js` | Logika halaman DigitalOcean: akun, droplet, metrik, create/hunt, enrichment (DR/rank/traffic/links), bulk action, search filter, cache. |
| `workers.js` | Cloudflare Worker (proxy CORS) dengan parameter `type` = `virustotal` / `ahrefs` / `seoquake`; respons sukses menyetel cache browser (`max-age`). |

## Input Data (tombol di navbar → modal Settings)

- **Google**: satu **refresh token** OAuth 2.0 per baris (bukan JSON) — `1//04...`
  (access token di-generate otomatis & di-cache di cookie).
- **Digital Ocean**: satu **API token** per baris (bukan JSON) — `dop_v1_...`
- **Local Data**: satu **`IP|domain`** per baris — untuk mengecek apakah domain benar mengarah ke IP droplet (Linked/Mismatch) dan menampilkan domain terkait di tiap droplet.
- **Hunter**: konfigurasi hunting/enrichment, disimpan ke `localStorage` (`cookie_hunter_data`):
  - **VirusTotal API Key** (1 key per baris; saat hunt hanya dikirim **1 key acak**).
  - **Worker Endpoint** (URL worker, 1 per baris; dipakai untuk virustotal/ahrefs/seoquake).
  - **Ahrefs API Key** (Bearer token untuk DR).
  - **Bannedlist URL** (disimpan sebagai URL, bukan hasil fetch; daftar di-fetch on-demand).

Data disimpan di `localStorage` (TTL sesuai pilihan periode) sehingga tidak perlu diisi ulang setiap buka.

## Hunter & Worker

`workers.js` adalah Cloudflare Worker proxy CORS yang dipakai panel untuk:

- `type=virustotal&api=<key>&ip=<ip>` — daftar domain (resolutions) milik sebuah IP.
- `type=ahrefs&api=<token>&domain=<domain>` — **DR** (Domain Rating).
- `type=seoquake&domain=<domain>` — **rank, traffic, links**.

Cache:
- Worker menyetel `Cache-Control: public, max-age` (default 2 jam, `cache_ttl=0` untuk menonaktifkan) hanya pada respons sukses → **browser** meng-cache, bukan edge/CDN.
- Panel menyimpan hasil enrichment (DR/rank/traffic/links) di `localStorage` (`cookie_enrich_cache`) **4 jam**; entri domain dihapus saat droplet yang memiliki IP tsb dihapus.

## Tema

Tema custom minimal (font **Inter**, warna netral, kartu membulat, responsif mobile).
Tombol mode (ikon bulan/matahari) di navbar men-switch light/dark via atribut `data-bs-theme`.

## Stack

HTML · jQuery 3.7 · Bootstrap 5.3 · Bootstrap Icons · ApexCharts · Express (serve statis) · Cloudflare Workers (opsional untuk hunter).

## Catatan Keamanan

- Token API & refresh token disimpan di **browser** (localStorage/cookie) dan dikirim langsung ke API Google/DigitalOcean dari sisi klien.
- Api key DigitalOcean tampil di kartu; token VirusTotal/Ahrefs tersimpan di `localStorage` — siapa pun yang membuka panel dapat melihatnya.
- Aksi destruktif (delete droplet, resize, create) berjalan dari sisi klien tanpa autentikasi server; gunakan hanya pada infrastruktur yang Anda kuasai.
