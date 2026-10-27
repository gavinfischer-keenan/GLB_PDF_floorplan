# Multi-stage production build for GLB_PDF_floorplan
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY index.html index.css ./
COPY src ./src
COPY public ./public
RUN npm run build

# Stage 2: Serve with ultra-lightweight Nginx
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
