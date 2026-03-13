# --------- Base Builder ---------
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the NestJS application
RUN npm run build

# --------- Production Build ---------
FROM node:20-alpine AS production

# Set node environment
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist
COPY public ./public

# Copy Firebase Admin SDK credentials
COPY firebase-adminsdk.json ./

# Expose the application port (defaults to 3000)
EXPOSE 3000

# Start the application
CMD ["node", "dist/main"]
