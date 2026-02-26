#!/bin/bash
# ============================================================
# VoxPro - Script de instalación para VPS Ubuntu 20.04+
#
# Este backend se instala en un VPS separado del servidor
# Aware (Kraken). Se conecta al servidor de grabaciones
# remotamente vía SSH/SFTP.
#
# Ejecutar como root o con sudo.
# ============================================================

set -e

echo "=== VoxPro Backend - Setup en VPS ==="

# 1. Instalar Node.js 20 LTS
if ! command -v node &> /dev/null; then
  echo "[1/5] Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[1/5] Node.js ya instalado: $(node -v)"
fi

# 2. Instalar MySQL 8
if ! command -v mysql &> /dev/null; then
  echo "[2/5] Instalando MySQL 8..."
  apt-get install -y mysql-server
  systemctl enable mysql
  systemctl start mysql
else
  echo "[2/5] MySQL ya instalado"
fi

# 3. Crear base de datos y usuario
echo "[3/5] Configurando base de datos..."
VOXPRO_DB_PASS="${VOXPRO_DB_PASS:-VoxPr0_$(openssl rand -hex 8)}"

mysql -e "CREATE DATABASE IF NOT EXISTS voxpro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -e "CREATE USER IF NOT EXISTS 'voxpro'@'localhost' IDENTIFIED BY '${VOXPRO_DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON voxpro.* TO 'voxpro'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

echo "  DB: voxpro | User: voxpro | Password: ${VOXPRO_DB_PASS}"

# 4. Instalar dependencias npm
echo "[4/5] Instalando dependencias..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"
npm install --production

# 5. Crear .env si no existe
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "[5/5] Creando .env..."
  cat > "$BACKEND_DIR/.env" << EOF
PORT=3000
NODE_ENV=production

DB_HOST=localhost
DB_PORT=3306
DB_USER=voxpro
DB_PASSWORD=${VOXPRO_DB_PASS}
DB_NAME=voxpro

# Conexión SSH al servidor Aware (Kraken)
# Configura IP, usuario y método de autenticación
AWARE_SSH_HOST=10.255.255.95
AWARE_SSH_PORT=22
AWARE_SSH_USER=tecnologia
AWARE_SSH_PASSWORD=
AWARE_SSH_KEY_PATH=
AWARE_RECORDINGS_PATH=/media/tecnologia/STORAGE/GRABACIONES

SCAN_CRON_SCHEDULE=0 2 * * *

LOG_LEVEL=info
LOG_DIR=./logs
EOF
  echo "  .env creado. EDITA las credenciales SSH antes de iniciar."
else
  echo "[5/5] .env ya existe, no se modifica"
fi

# Migraciones y seeds
echo ""
echo "=== Ejecutando migraciones ==="
npx knex migrate:latest --knexfile knexfile.js

echo "=== Ejecutando seeds ==="
npx knex seed:run --knexfile knexfile.js

echo ""
echo "============================================"
echo " VoxPro instalado en VPS"
echo ""
echo " IMPORTANTE: Edita .env con las credenciales"
echo " SSH del servidor Aware antes de iniciar."
echo ""
echo " Iniciar:    cd $BACKEND_DIR && npm start"
echo " Escaneo:    node src/jobs/nightly-scan.js"
echo ""
echo " Cron (crontab -e):"
echo "   0 2 * * * cd $BACKEND_DIR && /usr/bin/node src/jobs/nightly-scan.js >> logs/cron.log 2>&1"
echo "============================================"
