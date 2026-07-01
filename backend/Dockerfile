FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript code
RUN npm run build

EXPOSE 5001

# Command to run migrations and start the server
CMD ["sh", "-c", "npx prisma db push && npm start"]
