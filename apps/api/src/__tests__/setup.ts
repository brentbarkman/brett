// Test setup — set env vars before anything imports
process.env.DATABASE_URL = "postgresql://brett:brett_dev@localhost:5432/brett_test";
process.env.BETTER_AUTH_SECRET = "test-secret-at-least-32-characters-long";
process.env.BETTER_AUTH_URL = "http://localhost:3001";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
