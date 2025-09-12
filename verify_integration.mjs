import { 
  createEIP1271JWT, 
  createEIP1271AuthData,
  constructEIP1271Message,
  createLegacyEIP1271Auth 
} from './packages/atxp-base/dist/eip1271JwtHelper.js';

const authData = createEIP1271AuthData({
  walletAddress: '0x1234567890123456789012345678901234567890',
  message: constructEIP1271Message({
    walletAddress: '0x1234567890123456789012345678901234567890',
    timestamp: 1640995200,
    nonce: 'abc123def456',
    codeChallenge: 'test_challenge_123',
    paymentRequestId: 'req_789xyz'
  }),
  signature: '0x' + 'a'.repeat(512),
  timestamp: 1640995200,
  nonce: 'abc123def456',
  codeChallenge: 'test_challenge_123',
  paymentRequestId: 'req_789xyz'
});

const jwt = createEIP1271JWT(authData);
const legacy = createLegacyEIP1271Auth(authData);

console.log('✅ JWT Generated Successfully');
console.log('JWT Length:', jwt.length);
console.log('Legacy Length:', legacy.length);
console.log('Size Difference:', jwt.length - legacy.length);
console.log();
console.log('Generated JWT:');
console.log(jwt);
console.log();
console.log('Expected AuthData:');
console.log(JSON.stringify(authData, null, 2));