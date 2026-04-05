#!/bin/bash

echo "🚀 INSTALL BOT WA VPS"

apt update -y
apt install -y curl git nodejs npm

echo "📥 CLONE REPO"
git clone https://github.com/mhdisa96/wa-bot-vps.git
cd wa-bot-vps

echo "📦 INSTALL MODULE"
npm install

echo "⚙️ SET ENV"
cp .env.example .env

echo "📡 INSTALL PM2"
npm install -g pm2

echo "▶️ START BOT"
pm2 start index.js --name wa-bot-vps
pm2 save

echo "✅ SELESAI"
