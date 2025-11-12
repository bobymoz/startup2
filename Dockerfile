# Use uma imagem oficial do Node.js 18
FROM node:18-slim

# Instale as dependências necessárias para o Puppeteer (Chrome)
RUN apt-get update \
    && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    # Dependências do Chrome
    libgconf-service-3 \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    # Dependências adicionais
    lsb-release \
    libnss3 \
    libnss3-dev \
    libxss1 \
    libappindicator1 \
    libindicator7 \
    fonts-liberation \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Defina o diretório de trabalho
WORKDIR /usr/src/app

# Copie o package.json e package-lock.json
COPY package*.json ./

# Instale as dependências do projeto
RUN npm install --omit=dev --no-cache

# Copie o resto do código do aplicativo
COPY . .

# Exponha a porta que o Express usará
EXPOSE 3000

# Comando para iniciar o aplicativo
CMD ["npm", "start"]