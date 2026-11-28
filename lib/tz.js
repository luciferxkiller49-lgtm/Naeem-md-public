// Number ke country code se timezone (bot owner ke number ke hisaab se .date / .time)
const MAP = {
  '92': 'Asia/Karachi', '91': 'Asia/Kolkata', '880': 'Asia/Dhaka', '94': 'Asia/Colombo', '977': 'Asia/Kathmandu',
  '93': 'Asia/Kabul', '98': 'Asia/Tehran', '964': 'Asia/Baghdad', '971': 'Asia/Dubai', '966': 'Asia/Riyadh',
  '974': 'Asia/Qatar', '965': 'Asia/Kuwait', '973': 'Asia/Bahrain', '968': 'Asia/Muscat', '967': 'Asia/Aden',
  '962': 'Asia/Amman', '961': 'Asia/Beirut', '963': 'Asia/Damascus', '972': 'Asia/Jerusalem', '90': 'Europe/Istanbul',
  '20': 'Africa/Cairo', '212': 'Africa/Casablanca', '213': 'Africa/Algiers', '216': 'Africa/Tunis', '218': 'Africa/Tripoli',
  '234': 'Africa/Lagos', '233': 'Africa/Accra', '254': 'Africa/Nairobi', '255': 'Africa/Dar_es_Salaam', '256': 'Africa/Kampala',
  '251': 'Africa/Addis_Ababa', '27': 'Africa/Johannesburg', '60': 'Asia/Kuala_Lumpur', '62': 'Asia/Jakarta', '63': 'Asia/Manila',
  '65': 'Asia/Singapore', '66': 'Asia/Bangkok', '84': 'Asia/Ho_Chi_Minh', '86': 'Asia/Shanghai', '81': 'Asia/Tokyo',
  '82': 'Asia/Seoul', '852': 'Asia/Hong_Kong', '886': 'Asia/Taipei', '61': 'Australia/Sydney', '64': 'Pacific/Auckland',
  '44': 'Europe/London', '353': 'Europe/Dublin', '33': 'Europe/Paris', '49': 'Europe/Berlin', '39': 'Europe/Rome',
  '34': 'Europe/Madrid', '351': 'Europe/Lisbon', '31': 'Europe/Amsterdam', '32': 'Europe/Brussels', '41': 'Europe/Zurich',
  '43': 'Europe/Vienna', '46': 'Europe/Stockholm', '47': 'Europe/Oslo', '45': 'Europe/Copenhagen', '358': 'Europe/Helsinki',
  '48': 'Europe/Warsaw', '30': 'Europe/Athens', '380': 'Europe/Kyiv', '7': 'Europe/Moscow', '1': 'America/New_York',
  '52': 'America/Mexico_City', '55': 'America/Sao_Paulo', '54': 'America/Argentina/Buenos_Aires', '57': 'America/Bogota',
  '56': 'America/Santiago', '51': 'America/Lima',
};

const DEFAULT_TZ = process.env.TIMEZONE || 'Asia/Karachi';

function valid(tz) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (e) { return false; }
}

function tzForNumber(number) {
  const d = String(number || '').replace(/[^0-9]/g, '');
  for (let n = 3; n >= 1; n--) {
    const tz = MAP[d.slice(0, n)];
    if (tz) return tz;
  }
  return valid(DEFAULT_TZ) ? DEFAULT_TZ : 'UTC';
}

module.exports = { tzForNumber, valid, MAP };
