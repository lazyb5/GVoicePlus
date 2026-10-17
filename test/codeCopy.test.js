// Run with: npm test   (uses Node's built-in test runner; no extra dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCode } = require('../src/utils/codeCopy.js');

// Messages that should produce a code: [message, expected digits]
const CODES = [
    ['Your verification code is 483920', '483920'],
    ['123456 is your Google verification code.', '123456'],
    ['G-123456 is your Google verification code', '123456'],
    ['Your Amazon OTP is 4821. Do not share it.', '4821'],
    ['Use 123 456 to log in to your account', '123456'],
    ['Your code: 12345678', '12345678'],
    ['<#> Your Uber code is 4829 xyz', '4829'],
    ['Enter 884213 to sign in to your account', '884213'],
    ['Your Apple ID Code is: 123456. Do not share it with anyone.', '123456'],
    ['Your one-time passcode is 123456. It expires in 10 minutes.', '123456'],
    ['Your security code is 123-456', '123456'],
    ['WhatsApp code 123-456. You can also tap this link to verify', '123456'],
    ['Chase: Use code 5521 to verify your identity. Never share it.', '5521'],
    ['Your Microsoft account security code is 8821990', '8821990'],
    ['Verify your phone: 2024 is your code', '2024'],
    ['Your login code is 0042', '0042'],
    ['Use 482913 as your DoorDash verification code. Do not share.', '482913'],
    ['Your verification code is\n654321', '654321'],
    ['Two-factor authentication code: 774411', '774411'],
    ['Code: 999111', '999111'],
    ['Verification code for your account: 123456', '123456'],
    ['Lunch tomorrow? my pin is 1234 lol', '1234']   // a pin is a code as far as the text can tell
];

// Messages that must NOT produce a code.
const NOT_CODES = [
    'Your order #123456 has shipped',
    'Your appointment is on 10/17 at 2:30. Reply C to confirm.',
    'Call me back at 555 123 4567 about the code',
    'Your balance is $1234.56. Security alert: new login',
    'Pin the location: 1234 Main Street, see you there',
    'Verify your address: 12345 Oak Ave',
    'Your Amazon package 123456789012 was delivered',
    'Happy 2026! Our code of conduct has not changed',
    'Hey are you free at 8? sign in sheet at 5',
    'Security: your account ending 4821 was charged $25.00',
    'Your tracking number is 1234567890',
    'Reminder: verification of your ID is due 10/20/2026',
    'Login attempt from 192.168.1.20 was blocked',
    'Your code was sent at 12:34, check your email',
    'Meeting ID 123 456 789 passcode info in the invite',
    'Your payment of 2500 USD was received. Verify at the portal',
    'Order 123456 confirmation: verify your delivery window',
    'hello, how are you?',
    '',
    null,
    'verification code ' + 'x'.repeat(400) + ' 123456'   // too long to be a code message
];

// Known gaps, pinned so a change in behaviour is deliberate.
const NOT_SUPPORTED = [
    'Your code is A1B2C3',      // letters
    'Your code is 12 34 56'     // pairs
];

for (const [message, expected] of CODES) {
    test(`copies ${expected} from ${JSON.stringify(message).slice(0, 50)}`, () => {
        assert.equal(extractCode(message), expected);
    });
}
for (const message of NOT_CODES) {
    test(`ignores ${JSON.stringify(message).slice(0, 50)}`, () => {
        assert.equal(extractCode(message), null);
    });
}
for (const message of NOT_SUPPORTED) {
    test(`does not support ${JSON.stringify(message)}`, () => {
        assert.equal(extractCode(message), null);
    });
}
