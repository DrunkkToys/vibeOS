#!/bin/bash
set -e

echo "[vibeOS-api] Deploying API server to VPS..."

VPS_HOST="${VPS_HOST:-45.132.242.217}"
VPS_USER="${VPS_USER:-root}"
DEPLOY_DIR="/var/www/vibeos-api"

echo "[1/7] Checking SSH connection to $VPS_HOST..."
ssh -o ConnectTimeout=10 "$VPS_USER@$VPS_HOST" "echo 'SSH OK'" || {
  echo "ERROR: Cannot connect to VPS at $VPS_HOST"
  exit 1
}

echo "[2/7] Installing Node.js on VPS..."
ssh "$VPS_USER@$VPS_HOST" bash << 'EOF'
  if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  echo "Node.js $(node --version) installed"
EOF

echo "[3/7] Creating deploy directory..."
ssh "$VPS_USER@$VPS_HOST" "mkdir -p $DEPLOY_DIR/data"

echo "[4/7] Uploading API server files..."
scp -r "$(dirname "$0")/server.js" \
      "$(dirname "$0")/lib/" \
      "$(dirname "$0")/routes/" \
      "$(dirname "$0")/middleware/" \
      "$(dirname "$0")/package.json" \
      "$VPS_USER@$VPS_HOST:$DEPLOY_DIR/"

echo "[5/7] Installing dependencies..."
ssh "$VPS_USER@$VPS_HOST" "cd $DEPLOY_DIR && npm install --production"

echo "[6/7] Setting up systemd service..."
scp "$(dirname "$0")/vibeos-api.service" "$VPS_USER@$VPS_HOST:/tmp/vibeos-api.service"
ssh "$VPS_USER@$VPS_HOST" bash << EOF
  cp /tmp/vibeos-api.service /etc/systemd/system/vibeos-api.service
  systemctl daemon-reload
  systemctl enable vibeos-api
  systemctl restart vibeos-api
  rm /tmp/vibeos-api.service
EOF

echo "[7/7] Setting up Nginx reverse proxy..."
scp "$(dirname "$0")/nginx-vibetheog-api.conf" "$VPS_USER@$VPS_HOST:/tmp/vibeos-api-nginx.conf"
ssh "$VPS_USER@$VPS_HOST" bash << 'EOF'
  cp /tmp/vibeos-api-nginx.conf /etc/nginx/sites-available/vibeos-api.conf
  ln -sf /etc/nginx/sites-available/vibeos-api.conf /etc/nginx/sites-enabled/
  nginx -t && systemctl reload nginx
  rm /tmp/vibeos-api-nginx.conf
EOF

echo ""
echo "[vibeOS-api] Deployment complete!"
echo "  API URL: https://api.vibetheog.com"
echo "  Health:  https://api.vibetheog.com/health"
echo ""
echo "Next steps:"
echo "  1. SSH into VPS and create .env file: cp $DEPLOY_DIR/.env.example $DEPLOY_DIR/.env"
echo "  2. Set VIBEOS_API_MASTER_KEY in .env"
echo "  3. Run: cd $DEPLOY_DIR && npm run seed"
echo "  4. Add DNS record: api.vibetheog.com -> $VPS_HOST"
echo "  5. Run: certbot --nginx -d api.vibetheog.com"
