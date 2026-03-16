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
