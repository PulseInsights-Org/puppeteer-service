// Test setup file
// Set test environment variables before tests run

process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.PUPPETEER_LOG_LEVEL = 'error'; // Suppress logs during tests

// Mock Supabase credentials for tests that need them
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// Increase timeout for Puppeteer tests
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
  validRfqPayload: {
    rfq_details: {
      quote_submission_url: 'https://example.com/rfq-form'
    },
    quote_details: {
      items: [
        {
          conditionCode: 'NE',
          part_no: 'TEST-001',
          qty_available: '100',
          traceability: 'COFC',
          uom: 'EA',
          price_usd: '25.00',
          price_type: 'OUTRIGHT',
          lead_time: '5 days',
          tag_date: '2024-01-15',
          min_qty: 10,
          comments: 'Test comment'
        }
      ],
      supplier_comments: 'Test supplier comment',
      quote_prepared_by: 'Test User'
    }
  },

  validHeaders: {
    'Content-Type': 'application/json',
    'X-RFQ-ID': 'test-rfq-123',
    'X-Request-ID': 'test-request-456'
  }
};

// Cleanup after all tests
afterAll(async () => {
  // Allow time for any pending operations to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});
