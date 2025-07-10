// Test phone numbers for development/testing purposes
// All these numbers use "1234" as the auth code
const TEST_PHONES = [
  "0528602121",
  "0586000060", 
  "0532206314",
  "0544280085",
  "1234567891",
  "1234567892",
  "1234567893",
  "1234567894",
  "1234567895",
  "1234567899",
  "1234567800",
  "1234567801",
  "1234567802",
  "1234567803",
  "1234567804",
  "1234567805",
  "1234567806",
  "1234567807",
  "1234567808",
  "1234567809",
  "1234567810",
  "1234567811",
  "1234567812",
  "1234567813",
  "1234567814",
  "1234567815",
  "1234567816",
  "1234567817",
  "1234567818",
  "1234567819"
];

// Helper function to check if a phone number is a test phone
const isTestPhone = (phone) => {
  return TEST_PHONES.includes(phone);
};

// Helper function to check if phone and auth code match test credentials
const isTestAuth = (phone, authCode) => {
  return isTestPhone(phone) && authCode === "1234";
};

module.exports = {
  TEST_PHONES,
  isTestPhone,
  isTestAuth
}; 