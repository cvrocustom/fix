FROM node:18-alpine

WORKDIR /app

# Copiar package files desde teltonika-server
COPY teltonika-server/package.json ./

# Instalar dependencias
RUN npm install --legacy-peer-deps

# Copiar código fuente desde teltonika-server
COPY teltonika-server/ .

# Exponer puertos
EXPOSE 8080 3000

# Iniciar servidor
CMD ["node", "server.js"]
