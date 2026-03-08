FROM node:18-alpine

WORKDIR /app

# Copiar package files
COPY package.json ./

# Instalar dependencias
RUN npm install --legacy-peer-deps

# Copiar código fuente
COPY . .

# Exponer puertos
EXPOSE 8080 3000

# Iniciar servidor
CMD ["node", "server.js"]
