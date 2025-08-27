// index.js
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const bs58 = require('bs58');
const axios = require('axios');
const { Connection, Keypair, Transaction, VersionedTransaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const raydiumSdk = require('@raydium-io/raydium-sdk-v2'); // to use API_URLS etc
const { API_URLS } = raydiumSdk;

const app = express();
app.use(express.json());

const RPC = process.env.RPC || 'https://api.devnet.solana.com';
const connection = new Connection(RPC, 'confirmed');

function loadKeypair(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}
const payer = loadKeypair(process.env.KEYPAIR_PATH);

app.get('/status', async (req, res) => {
  try {
    const lamports = await connection.getBalance(payer.publicKey);
    res.json({ pubkey: payer.publicKey.toBase58(), lamports });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /swap
 * body: {
 *   inputMint: string (mint address, use NATIVE_MINT for SOL?),
 *   outputMint: string,
 *   amount: string or number (base units, e.g. 1 token with 6 decimals -> 1000000),
 *   slippageBps: number (e.g. 50 for 0.5%),
 *   inputAccount?: string (if inputMint != SOL you MUST pass ATA address for your input token)
 * }
 */
app.post('/swap', async (req, res) => {
  try {
    const { inputMint, outputMint, amount, slippageBps = 50, inputAccount, txVersion = 'V0' } = req.body;

    // validation
    if (!inputMint || !outputMint || !amount) return res.status(400).json({ error: 'inputMint, outputMint, amount required' });
    // if input token is not SOL, inputAccount must be provided (Trade API requirement)
    const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
    if (inputMint !== NATIVE_MINT && !inputAccount) {
      return res.status(400).json({ error: 'inputAccount is required when inputMint is not SOL (ATA address)' });
    }

    // 1) Get priority fee suggested by Raydium (optional but recommended)
    const priorityFeeUrl = `${API_URLS.BASE_HOST}${API_URLS.PRIORITY_FEE}`;
    let computeUnitPriceMicroLamports = '0';
    try {
      const feeResp = await axios.get(priorityFeeUrl);
      computeUnitPriceMicroLamports = String(feeResp.data?.data?.default?.h || feeResp.data?.data?.default?.m || 0);
    } catch (e) {
      // continue with 0 (dev/test)
      computeUnitPriceMicroLamports = '0';
    }

    // 2) Compute route (GET compute/swap-base-in)
    const SWAP_HOST = API_URLS.SWAP_HOST; // usually https://transaction-v1.raydium.io
    const computeUrl = `${SWAP_HOST}${API_URLS.SWAP_COMPUTE}swap-base-in?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&txVersion=${txVersion}`;
    const computeResp = await axios.get(computeUrl);
    if (!computeResp.data) return res.status(500).json({ error: 'no compute response' });
    const swapResponse = computeResp.data;

    // 3) Ask Raydium to build transactions (POST /transaction/swap-base-in)
    const txBuildUrl = `${SWAP_HOST}${API_URLS.SWAP_TX}swap-base-in`;
    const postBody = {
      computeUnitPriceMicroLamports,
      swapResponse,
      txVersion,
      wallet: payer.publicKey.toBase58(),
      wrapSol: inputMint === NATIVE_MINT,
      unwrapSol: outputMint === NATIVE_MINT,
      inputAccount: inputMint === NATIVE_MINT ? undefined : inputAccount,
      // outputAccount optional: SDK will default to ATA if possible
    };
    const txBuildResp = await axios.post(txBuildUrl, postBody);
    if (!txBuildResp.data || !txBuildResp.data.data) return res.status(500).json({ error: 'no tx build response' });

    // 4) Deserialize transactions (base64) -> sign -> send -> confirm
    const txArray = txBuildResp.data.data; // array of { transaction: base64, ... } usually
    const allTxBufs = txArray.map(item => Buffer.from(item.transaction, 'base64'));
    const results = [];

    for (let i = 0; i < allTxBufs.length; i++) {
      const buf = allTxBufs[i];

      if (txVersion === 'V0') {
        // VersionedTransaction
        const tx = VersionedTransaction.deserialize(buf);
        // sign with owner
        tx.sign([payer]);
        // send raw
        const raw = tx.serialize();
        const signature = await connection.sendRawTransaction(raw, { skipPreflight: true });
        // confirm using latest blockhash pattern
        const { lastValidBlockHeight, blockhash } = await connection.getLatestBlockhash('finalized');
        await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature }, 'confirmed');
        results.push({ idx: i, signature });
      } else {
        // legacy Transaction
        const tx = Transaction.from(buf);
        tx.sign(payer);
        const txid = await sendAndConfirmTransaction(connection, tx, [payer], { skipPreflight: true });
        results.push({ idx: i, txid });
      }
    }

    res.json({ success: true, results });
  } catch (e) {
    console.error('swap error', e?.response?.data || e.message);
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Raydium trade backend running on ${PORT}`);
});
