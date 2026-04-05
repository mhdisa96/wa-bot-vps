# WA Bot VPS Ready

Bot WhatsApp untuk VPS Ubuntu dengan fitur:
- kontrol hanya dari nomor bot sendiri
- jadwal per jam
- setiap jam punya pesan sendiri
- setiap jam punya foto sendiri
- foto pertama memakai caption
- auto reconnect
- cocok untuk PM2

## Isi repo
- `index.js`
- `package.json`
- `.env.example`
- `install.sh`
- `auth_info/`
- `data/config.json`
- `media/`

## Cara upload ke GitHub
1. Buat repo baru di GitHub, misalnya `wa-bot-vps`
2. Upload semua isi folder ini ke repo
3. Ganti `USERNAME` di README dan `install.sh` dengan username GitHub kamu

## Instal NodeJS
'''bash
apt update
apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
'''

## Install manual di VPS
```bash
git clone https://github.com/mhdisa96/wa-bot-vps.git /root/wa-bot-vps
cd /root/wa-bot-vps
npm install
cp .env.example .env
node index.js
```

## Install singkat
Setelah repo ini ada di GitHub kamu:
```bash
git clone https://github.com/mhdisa96/wa-bot-vps.git /root/wa-bot-vps && cd /root/wa-bot-vps && bash install.sh
```

## Isi `.env`
```env
TIMEZONE=Asia/Jakarta
TZ_LABEL=WIB
AUTH_DIR=./auth_info
DATA_DIR=./data
MEDIA_DIR=./media
COMMAND_PREFIX=.
```

## Jalankan pakai PM2
```bash
cd /root/wa-bot-vps
npm install -g pm2
pm2 start index.js --name wa-bot-vps
pm2 save
pm2 startup
```

## Command bot
```text
.setgrup 120363xxxxxxxxx@g.us
.setjadwal 08:00
.setpesan 08:00 Selamat pagi
```

Lalu kirim foto dengan caption:
```text
.savefoto 08:00
```

Aktifkan scheduler:
```text
.onjadwal
```

Tes manual:
```text
.kirim 08:00
.status
.listjadwal
```

## Penting
Folder ini jangan dihapus:
- `auth_info`
- `data`
- `media`

Kalau `auth_info` hilang, kamu harus scan QR lagi.
