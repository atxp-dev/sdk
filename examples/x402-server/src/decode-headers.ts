// Decode and compare the X-Payment headers from both implementations

const x402FetchHeader = 'eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiYmFzZSIsInBheWxvYWQiOnsic2lnbmF0dXJlIjoiMHgyNzU5MWY4OTAzODcyY2QyZjEwNzEwN2I0NzM1MDVhYzhjMGQ1ZDI1NmYxY2MxN2I5MWQ3MWQ4NDU1MWEzMTVmNjVjZDZjNGY3YWJhOTJkM2NjYmQ0MDU4N2FiYzQ3OGM5OGIyYzI5MWQ1NTllNzBhOTFkYTEyMGE4OWNhNDhkMjFjIiwiYXV0aG9yaXphdGlvbiI6eyJmcm9tIjoiMHg3RjlEMWE4Nzk3NTAxNjhiOGY0QTU5NzM0QjEyNjJEMTc3OGZEQjVBIiwidG8iOiIweDMyMTQyMThDZEI2QTBFNTk3MDY3N0NkQ2E5ZUI2NTM2NWVmNTg3RkQiLCJ2YWx1ZSI6IjEwMDAwIiwidmFsaWRBZnRlciI6IjE3NTgyMjcxODciLCJ2YWxpZEJlZm9yZSI6IjE3NTgyMjc4NDciLCJub25jZSI6IjB4ZWIzOTgzYTQ3MWEwNGU0Njg2MGIyNzMxNzkzYjNkZThhMDRiN2I2ODQ3NjJkZGRiYjkwMzQ1M2U4MzVjNDAyOCJ9fX0=';

const customWrapperHeader = 'eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiYmFzZSIsInBheWxvYWQiOnsic2lnbmF0dXJlIjoiMHhlZWY1MWQ2YmJhZjJmMjU2MjBlNWJhZDgyOWZiMTBkMmM4ODFlNjdkNzg5NGQ2MmVkNWIyNDFlMjcxM2ZjZTNjNTJmMTM0Zjg5YWIwNzExNDNkN2JjMzliMmUxM2E1ZjgzN2U0NGEwZjI4YWQ1ZjMwNjkzNDcxNWExMzExNmI5YzFjIiwiYXV0aG9yaXphdGlvbiI6eyJmcm9tIjoiMHg3RjlEMWE4Nzk3NTAxNjhiOGY0QTU5NzM0QjEyNjJEMTc3OGZEQjVBIiwidG8iOiIweDMyMTQyMThDZEI2QTBFNTk3MDY3N0NkQ2E5ZUI2NTM2NWVmNTg3RkQiLCJ2YWx1ZSI6IjEwMDAwIiwidmFsaWRBZnRlciI6IjE3NTgyMjc3OTciLCJ2YWxpZEJlZm9yZSI6IjE3NTgyMzEzOTciLCJub25jZSI6IjB4YTk2YzRjNTcxMWYyNTMyOWE2MjY2Y2RmZjFlZTUyNTZiNzBlZTBmNDNkNWFlZDM5MTI0ZTM1NmQxMTVlNzE4MyJ9fX0=';

console.log('=== X402-FETCH HEADER ===');
const x402FetchDecoded = Buffer.from(x402FetchHeader, 'base64').toString('utf-8');
const x402FetchJson = JSON.parse(x402FetchDecoded);
console.log(JSON.stringify(x402FetchJson, null, 2));

console.log('\n=== CUSTOM WRAPPER HEADER ===');
const customWrapperDecoded = Buffer.from(customWrapperHeader, 'base64').toString('utf-8');
const customWrapperJson = JSON.parse(customWrapperDecoded);
console.log(JSON.stringify(customWrapperJson, null, 2));

console.log('\n=== DIFFERENCES ===');

// Compare top-level fields
for (const key in x402FetchJson) {
  if (key !== 'payload' && x402FetchJson[key] !== customWrapperJson[key]) {
    console.log(`${key}: x402-fetch="${x402FetchJson[key]}" vs custom="${customWrapperJson[key]}"`);
  }
}

// Compare payload.authorization fields (excluding dynamic fields like nonce, validAfter, validBefore, signature)
const x402Auth = x402FetchJson.payload.authorization;
const customAuth = customWrapperJson.payload.authorization;

console.log('\nStatic fields comparison:');
console.log(`from: ${x402Auth.from === customAuth.from ? '✅ SAME' : '❌ DIFFERENT'} (${x402Auth.from})`);
console.log(`to: ${x402Auth.to === customAuth.to ? '✅ SAME' : '❌ DIFFERENT'} (${x402Auth.to})`);
console.log(`value: ${x402Auth.value === customAuth.value ? '✅ SAME' : '❌ DIFFERENT'} (${x402Auth.value})`);

console.log('\nDynamic fields (expected to be different):');
console.log(`signature: ${x402FetchJson.payload.signature.substring(0, 20)}... vs ${customWrapperJson.payload.signature.substring(0, 20)}...`);
console.log(`nonce: ${x402Auth.nonce.substring(0, 20)}... vs ${customAuth.nonce.substring(0, 20)}...`);
console.log(`validAfter: ${x402Auth.validAfter} vs ${customAuth.validAfter}`);
console.log(`validBefore: ${x402Auth.validBefore} vs ${customAuth.validBefore}`);

// Check for any extra fields
console.log('\nField presence check:');
const x402FetchFields = Object.keys(x402FetchJson.payload.authorization).sort();
const customWrapperFields = Object.keys(customWrapperJson.payload.authorization).sort();
console.log('x402-fetch fields:', x402FetchFields.join(', '));
console.log('custom wrapper fields:', customWrapperFields.join(', '));
console.log('Fields match:', JSON.stringify(x402FetchFields) === JSON.stringify(customWrapperFields) ? '✅ YES' : '❌ NO');