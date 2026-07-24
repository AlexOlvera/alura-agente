#!/usr/bin/env bash
# Provisiona la app en una VM limpia de OCI (Ubuntu 22.04 / 24.04, x86 o ARM).
#
# Uso, ya dentro de la VM:
#     git clone <tu-repo> ~/alura-agente
#     cd ~/alura-agente
#     cp .env.example .env && nano .env      # pon tu GEMINI_API_KEY
#     sudo bash deploy/setup.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
APP_DIR="/opt/alura-agente"
APP_USER="${SUDO_USER:-ubuntu}"

if [ ! -f "${REPO_DIR}/.env" ]; then
  echo "ERROR: falta ${REPO_DIR}/.env  (copia .env.example y pon tu API key)" >&2
  exit 1
fi

echo "==> Paquetes base"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip git curl rsync \
  debian-keyring debian-archive-keyring apt-transport-https

echo "==> Copiando codigo a ${APP_DIR}"
mkdir -p "${APP_DIR}"
rsync -a --exclude '.git' --exclude '.venv' --exclude 'index' "${REPO_DIR}/" "${APP_DIR}/"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "==> Entorno virtual e instalacion"
sudo -u "${APP_USER}" python3 -m venv "${APP_DIR}/.venv"
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install -q --upgrade pip
sudo -u "${APP_USER}" "${APP_DIR}/.venv/bin/pip" install -q -r "${APP_DIR}/requirements.txt"

echo "==> Ingesta de documentos"
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && set -a && . ./.env && set +a && .venv/bin/python -m app.ingest"

echo "==> Servicio systemd"
sed "s|__APP_USER__|${APP_USER}|g" "${APP_DIR}/deploy/alura-agente.service" \
  > /etc/systemd/system/alura-agente.service
systemctl daemon-reload
systemctl enable --now alura-agente

echo "==> Caddy (HTTPS automatico)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
if [ -n "${IP}" ]; then
  sed "s|__HOST__|${IP}.sslip.io|g" "${APP_DIR}/deploy/Caddyfile" > /etc/caddy/Caddyfile
  systemctl restart caddy
  URL="https://${IP}.sslip.io"
else
  URL="(no se detecto la IP publica; edita /etc/caddy/Caddyfile a mano)"
fi

echo "==> Firewall local"
# OCI entrega Ubuntu con iptables cerrado, ademas de la Security List del VCN.
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
netfilter-persistent save >/dev/null 2>&1 || true

cat <<FIN

------------------------------------------------------------------
  URL:  ${URL}

  Falta UNA cosa, y solo se hace desde la consola web de OCI:

    Networking > Virtual Cloud Networks > (tu VCN) > Security Lists
    > Default Security List > Add Ingress Rules

      Source 0.0.0.0/0  ·  IP Protocol TCP  ·  Destination Port 80
      Source 0.0.0.0/0  ·  IP Protocol TCP  ·  Destination Port 443

  Sin esa regla el servidor responde en localhost pero no desde
  internet, y Let's Encrypt no puede emitir el certificado.

    Estado:  systemctl status alura-agente
    Logs:    journalctl -u alura-agente -f
------------------------------------------------------------------
FIN
