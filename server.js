import express from "express";
import bodyParser from "body-parser";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "fs";

// === Config ===
const RPC_URL = "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Load private key từ file devnet.json
const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync("/home/os01/devnet.json")));
const wallet = Keypair.fromSecretKey(secretKey);

// Raydium Devnet Pool (SOL/USDC test pool)
const POOL_AMM_ID_DEVNET = new PublicKey("H8QKfxAT9rUyGJPD7W82dManEXZDV4SSQSSHqzTeWY3U");

// Token mock để test (thay bằng mint của bạn nếu cần)
const TOKEN_MINT = new PublicKey("7TmZE2ouNdGPoPuUTXBJZQ1NSSuVBnkVZ3xmi27DE2ay");

const app = express();
app.use(bodyParser.json());

// ============= API ============= //

// 1. Check balance
app.get("/balance", async (req, res) => {
  try {
    // SOL balance
    const solBalance = await connection.getBalance(wallet.publicKey);

    // Token balance
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      TOKEN_MINT,
      wallet.publicKey
    );

    const tokenAccInfo = await getAccount(connection, tokenAccount.address);

    res.json({
      wallet: wallet.publicKey.toBase58(),
      sol: solBalance / 1e9, // convert lamports -> SOL
      tokenMint: TOKEN_MINT.toBase58(),
      tokenBalance: Number(tokenAccInfo.amount),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Swap mock (chuyển token cho chính mình)
app.post("/swap", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "amount > 0 required" });
    }

    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      TOKEN_MINT,
      wallet.publicKey
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      TOKEN_MINT,
      wallet.publicKey
    );

    const tx = new Transaction().add(
      createTransferInstruction(
        fromTokenAccount.address,
        toTokenAccount.address,
        wallet.publicKey,
        amount
      )
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);

    res.json({ success: true, tx: sig });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ================================== //

app.listen(3000, () => {
  console.log("🚀 Backend running at http://localhost:3000");
});
