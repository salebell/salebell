# syntax=docker/dockerfile:1
FROM node:22.23.3-alpine3.24 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_DEPLOYMENT_MODE=self_hosted
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_COMPANY_NAME
ARG NEXT_PUBLIC_COMPANY_NUMBER
ARG NEXT_PUBLIC_COMPANY_ADDRESS
ARG NEXT_PUBLIC_IOS_APP_URL
ARG NEXT_PUBLIC_SOURCE_URL
ARG SUPABASE_INTERNAL_URL=http://api-gw:8000
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir -p public && npm run build

FROM node:22.23.3-alpine3.24 AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN addgroup --system --gid 1001 salebell && adduser --system --uid 1001 --ingroup salebell salebell
COPY --from=build --chown=salebell:salebell /app/.next/standalone ./
COPY --from=build --chown=salebell:salebell /app/.next/static ./.next/static
COPY --from=build --chown=salebell:salebell /app/public ./public
USER salebell
EXPOSE 3000
CMD ["node", "server.js"]
