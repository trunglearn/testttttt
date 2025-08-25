const {
    SOLANA_RPC_URL,
    JUPITER_BASE_URL,
    WSOL_MINT
} = require('../constants');

const axios = require('axios').default;
const bs58 = require('bs58');
const { Connection, PublicKey, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } = require('@solana/spl-token');

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

function short(s) {
    return s ? `${s.slice(0, 5)}…${s.slice(-4)}` : s;
}

async function fetchQuote({ inputMint, outputMint, amount, slippageBps = 200 }) {
    const url = `${JUPITER_BASE_URL}/v6/quote`;
    const params = { inputMint, outputMint, amount: String(amount), slippageBps };
    const { data } = await axios.get(url, { params, timeout: 15000 });
    if (!data) throw new Error('No quote found');
    return data;
}

async function buildSwapTx({ quoteResponse, userPublicKey }) {
    const url = `${JUPITER_BASE_URL}/v6/swap`;
    const { data } = await axios.post(url, {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        asLegacyTransaction: false,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
    }, { timeout: 20000 });
    if (!data?.swapTransaction) throw new Error('Swap build failed');
    return Buffer.from(data.swapTransaction, 'base64');
}

async function sendSwapTx({ serializedTx, keypair }) {
    const tx = VersionedTransaction.deserialize(serializedTx);
    tx.sign([keypair]);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    await connection.confirmTransaction(sig, 'confirmed');
    return sig;
}

async function getTokenBalance(ownerPk, mint) {
    const ata = await getAssociatedTokenAddress(new PublicKey(mint), ownerPk, false, TOKEN_PROGRAM_ID);
    try {
        const acc = await getAccount(connection, ata);
        return { amount: Number(acc.amount), ata };
    } catch {
        return { amount: 0, ata };
    }
}

module.exports = {
    connection,
    short,
    fetchQuote,
    buildSwapTx,
    sendSwapTx,
    getTokenBalance,
    LAMPORTS_PER_SOL,
    WSOL_MINT
};
