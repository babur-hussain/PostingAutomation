#!/bin/bash

# Configuration
EC2_USER="ec2-user"
EC2_IP="3.108.190.156"
PEM_FILE="PostingAutomation.pem"
REMOTE_DIR="~/backend"

echo "Deploying backend to AWS EC2 instance ($EC2_IP)..."

# 1. Sync files to EC2 (excluding node_modules, dist, etc.)
echo "[1/3] Syncing files to server..."
rsync -avz -e "ssh -o StrictHostKeyChecking=no -i $PEM_FILE" \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  ./ $EC2_USER@$EC2_IP:$REMOTE_DIR/

# 2. Rebuild and restart Docker containers
echo "[2/3] Building and restarting Docker containers..."
ssh -o StrictHostKeyChecking=no -i $PEM_FILE $EC2_USER@$EC2_IP "cd $REMOTE_DIR && sudo ~/.docker/cli-plugins/docker-compose up -d --build"

# 3. Clean up dangling images to save disk space
echo "[3/3] Cleaning up old Docker images..."
ssh -o StrictHostKeyChecking=no -i $PEM_FILE $EC2_USER@$EC2_IP "sudo docker image prune -f"

echo "Deployment complete! ✅"
