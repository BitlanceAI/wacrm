# ─── Build Stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Only NEXT_PUBLIC_* variables are needed at build time (they're inlined into the JS bundle).
# Server-side secrets must NOT be baked into the image — pass them at runtime instead.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_GOOGLE_AI_API_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_GOOGLE_AI_API_KEY=$NEXT_PUBLIC_GOOGLE_AI_API_KEY

RUN npm run build

# Write the build args into .env.production so the runtime server can load them
RUN echo "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" > .env.production && \
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" >> .env.production && \
    echo "NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL" >> .env.production && \
    echo "NEXT_PUBLIC_GOOGLE_AI_API_KEY=$NEXT_PUBLIC_GOOGLE_AI_API_KEY" >> .env.production

# ─── Production Stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy only the artifacts needed to run
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.env.production ./.env.production

EXPOSE 3000

# SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY, META_APP_SECRET (and any other
# server-only secrets) are injected at container runtime via:
#   docker run -e SUPABASE_SERVICE_ROLE_KEY=<secret> ...
# or via a secrets manager / orchestrator (Azure Key Vault, Kubernetes Secret, etc.)
# They are NEVER embedded in the image.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
