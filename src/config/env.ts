import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: parseInt(process.env.PORT || '4000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dealfinder',
    redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        useMock: process.env.USE_REDIS_MOCK === 'true',
    },
    affiliateBaseUrl: process.env.AFFILIATE_BASE_URL || 'https://shopee.vn/universal-link/',
    cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '600', 10),
    jwtSecret: process.env.JWT_SECRET || 'dealfinder-dev-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    scraper: {
        adminSecret: process.env.SCRAPER_ADMIN_SECRET || '',
        adminPublicMode: process.env.SCRAPER_ADMIN_PUBLIC_MODE === 'true',
        heartbeatIntervalSeconds: parseInt(process.env.SCRAPER_HEARTBEAT_INTERVAL_SECONDS || '15', 10),
        offlineTimeoutSeconds: parseInt(process.env.SCRAPER_OFFLINE_TIMEOUT_SECONDS || '90', 10),
        riskDecayIntervalMinutes: parseInt(process.env.SCRAPER_RISK_DECAY_INTERVAL_MINUTES || '30', 10),
        riskDecayAmount: parseInt(process.env.SCRAPER_RISK_DECAY_AMOUNT || '2', 10),
        warmupSuccessThreshold: parseInt(process.env.SCRAPER_WARMUP_SUCCESS_THRESHOLD || '2', 10),
        ops: {
            vpsBasePath: process.env.SCRAPER_VPS_BASE_PATH || '/var/www/dealfinder/backend',
            archiveBasePath: process.env.SCRAPER_VPS_ARCHIVE_PATH || '/var/www/dealfinder/backend/archive',
            sshUser: process.env.SCRAPER_SSH_USER || 'root',
            sshHost: process.env.SCRAPER_SSH_HOST || 'your-vps-ip',
            sshPort: parseInt(process.env.SCRAPER_SSH_PORT || '22', 10),
            dockerComposeDir: process.env.SCRAPER_DOCKER_COMPOSE_DIR || '/var/www/dealfinder/backend',
        },
    },
    shopee: {
        partnerId: parseInt(process.env.SHOPEE_PARTNER_ID || '0', 10),
        partnerKey: process.env.SHOPEE_PARTNER_KEY || '',
        shopId: parseInt(process.env.SHOPEE_SHOP_ID || '0', 10),
        accessToken: process.env.SHOPEE_ACCESS_TOKEN || '',
        baseUrl: process.env.SHOPEE_API_BASE_URL || 'https://partner.shopeemobile.com',
        affiliateId: process.env.SHOPEE_AFFILIATE_ID || '',
        subIdPrefix: process.env.SHOPEE_SUB_ID_PREFIX || 'listing',
    },
};
