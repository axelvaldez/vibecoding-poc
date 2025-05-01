const bcrypt = require('bcrypt');

if (process.argv.length < 3) {
    console.log('Usage: node generate-password.js <password>');
    process.exit(1);
}

const password = process.argv[2];
bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
        console.error('Error hashing password:', err);
        process.exit(1);
    }
    console.log('Hashed password:', hash);
    console.log('\nAdd this to your .env file:');
    console.log(`ADMIN_PASSWORD=${hash}`);
}); 