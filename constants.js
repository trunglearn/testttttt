// constants.js

// Solana RPC + Jupiter
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUPITER_BASE_URL = process.env.JUPITER_BASE_URL || 'https://quote-api.jup.ag';

// System settings
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 3);
const MAX_HISTORY_RECORDS = 500;

// Tokens
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Defaults
const DEFAULT_SLIPPAGE_BPS = 200;  // 2%
const DEFAULT_INTERVAL_SEC = 60;   // 1 phút

// Actions
const ACTION_BUY = 'buy';
const ACTION_SELL = 'sell';

// Market Making
const MM_DEX = 'Raydium';

module.exports = {
    SOLANA_RPC_URL,
    JUPITER_BASE_URL,
    MAX_CONCURRENCY,
    MAX_HISTORY_RECORDS,
    WSOL_MINT,
    DEFAULT_SLIPPAGE_BPS,
    DEFAULT_INTERVAL_SEC,
    ACTION_BUY,
    ACTION_SELL,
    MM_DEX
};
