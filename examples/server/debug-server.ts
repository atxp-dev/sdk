// Debug version to test imports
import 'dotenv/config';
import { atxpServer } from '@atxp/server';
import { ConsoleLogger, LogLevel } from '@atxp/common';

console.log('🔍 Debug: Testing imports...');

// Test the imports
try {
  const { sqlite } = await import('@atxp/common');
  console.log('✅ sqlite import successful');
  
  // Test SQLite operations  
  const db = sqlite.openDatabaseSync(':memory:');
  console.log('✅ SQLite database created');
  await db.closeAsync();
  console.log('✅ SQLite database closed');
  
} catch (error) {
  console.log('❌ Import/SQLite error:', error.message);
  console.log('Stack:', error.stack);
}