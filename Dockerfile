# Use official Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY src ./src
COPY config ./config

# Exclude test, docs, and local env files
# (Handled by .dockerignore)

# Expose port
EXPOSE 3001

# Start the app
CMD ["node", "src/index.js"]
