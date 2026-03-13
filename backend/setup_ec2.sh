#!/bin/bash

# Update packages and install Docker
sudo dnf update -y
sudo dnf install -y docker

# Start and enable Docker service
sudo systemctl enable --now docker

# Add ec2-user to docker group
sudo usermod -aG docker ec2-user

# Install Docker Compose plugin for the user
mkdir -p ~/.docker/cli-plugins/
curl -SL https://github.com/docker/compose/releases/download/v2.24.6/docker-compose-linux-x86_64 -o ~/.docker/cli-plugins/docker-compose
chmod +x ~/.docker/cli-plugins/docker-compose

# Navigate to backend directory and start the app using the new group permissions
cd ~/backend
sg docker -c "docker compose up -d --build"
