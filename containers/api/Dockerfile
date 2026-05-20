FROM node:20-alpine

# Install Docker CLI to execute docker commands from within this container (DooD)
RUN apk add --no-cache docker-cli

# Set working directory
WORKDIR /usr/src/app

# Copy package configuration
COPY package*.json tsconfig.json ./

# Install packages
RUN npm install

# Copy source code and UI files
COPY src/ ./src/
COPY public/ ./public/

# Compile TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Start API Server
CMD ["node", "dist/index.js"]
