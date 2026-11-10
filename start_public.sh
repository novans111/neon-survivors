#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"

echo "=========================================================="
echo " 🚀 Запуск сервера NEON SURVIVORS (SQLite + HTTP) на порту $PORT"
echo "=========================================================="

python3 "$DIR/server.py" &
SERVER_PID=$!

cleanup() {
  echo ""
  echo "Остановка игрового сервера (PID $SERVER_PID)..."
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1

echo ""
echo "=========================================================="
echo " 🌐 Создание публичной HTTPS-ссылки для преподавателя и группы..."
echo " Скопируйте ссылку вида https://xxxx.lhr.life из вывода ниже!"
echo " (Не закрывайте это окно, пока препод и однокурсники тестируют)"
echo "=========================================================="
echo ""

ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -R 80:localhost:"$PORT" nokey@localhost.run
