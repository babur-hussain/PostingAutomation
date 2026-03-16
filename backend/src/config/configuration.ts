export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    uri:
      process.env.MONGODB_URI || 'mongodb://localhost:27017/posting-automation',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3BucketName: process.env.S3_BUCKET_NAME,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  meta: {
    appId: process.env.META_APP_ID,
    appSecret: process.env.META_APP_SECRET,
    redirectUri: process.env.META_REDIRECT_URI,
    instagramAppId: process.env.INSTAGRAM_APP_ID,
    instagramAppSecret: process.env.INSTAGRAM_APP_SECRET,
  },

  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    appSecret: process.env.FACEBOOK_APP_SECRET,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI,
  },

  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI,
  },

  x: {
    consumerKey: process.env.X_CONSUMER_KEY,
    consumerSecret: process.env.X_CONSUMER_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    bearerToken: process.env.X_BEARER_TOKEN,
  },

  frontendUrl: process.env.FRONTEND_URL || 'exp://postingautomation.lfvs.in',
});
