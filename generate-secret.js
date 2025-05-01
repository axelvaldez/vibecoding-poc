const crypto = require('crypto');

const secret = crypto.randomBytes(64).toString('hex');
console.log('Generated session secret:');
console.log(secret);
console.log('\nAdd this to your .env file:');
console.log(`SESSION_SECRET=${secret}`); 