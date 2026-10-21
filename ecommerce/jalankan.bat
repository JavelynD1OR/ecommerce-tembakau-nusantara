@echo off
title Toko Nusantara Tobacco - Server Berjalan
color 02
echo ========================================================
echo  MENJALANKAN APLIKASI E-COMMERCE NUSANTARA TOBACCO
echo ========================================================
if not exist node_modules (
  echo Menginstal dependensi pertama kali, mohon tunggu...
  call npm install
)
if not exist .env (
  copy .env.example .env >nul
  echo File .env dibuat dari .env.example. Isi kunci Midtrans di file .env bila sudah punya.
)
echo.
echo Toko : http://localhost:3000
echo Admin: http://localhost:3000/admin
echo Jangan tutup jendela ini selama aplikasi digunakan!
echo.
call npm start
pause
