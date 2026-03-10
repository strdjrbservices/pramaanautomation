# Use the official Puppeteer image which includes Chrome and Node.js
FROM ghcr.io/puppeteer/puppeteer:21.5.2

# Switch to root user to install dependencies and create folders
USER root

# Set the working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
# We skip the chromium download here because the base image already has it
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

RUN npm ci

# Copy the rest of your application code
COPY . .

# Create the downloads directory and ensure permissions
RUN mkdir -p downloads && chmod 777 downloads

# Start the server
CMD [ "node", "server.js" ]