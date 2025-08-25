import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import bs58 from "bs58";
import {
    Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage
} from "@solana/web3.js";

const app = express();
const upload = multer();
app.use(express.json());

const PORT = 3001;
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

// 🚀 Hàm parse file CSV/XLSX
function parseWalletFile(buffer, originalname) {
    console.log("📂 Parsing file:", originalname);
    if (originalname.endsWith(".csv")) {
        const rows = buffer.toString().trim().split("\n").map(r => r.split(","));
        console.log("CSV rows:", rows.length);
        return rows.slice(1).map(r => ({
            privateKey: r[0].trim(),
            amountSOL: parseFloat(r[1] || "0")
        }));
    } else if (originalname.endsWith(".xlsx")) {
        const workbook = xlsx.read(buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = xlsx.utils.sheet_to_json(sheet);
        console.log("XLSX rows:", json.length);
        return json.map(r => ({
            privateKey: r.private_key,
            amountSOL: r.amount_sol
        }));
    }
    throw new Error("Unsupported file format (chỉ hỗ trợ .csv hoặc .xlsx)");
}

//
// 1️⃣ Heaven: request-tx
//
app.post("/api/heaven/request-tx", upload.single("wallets"), async (req, res) => {
    console.log("➡️  [request-tx] hit, body:", req.body);
    try {
        const { items } = req.body;
        if (!req.file) throw new Error("Thiếu file ví (wallet file required)");
        const wallets = parseWalletFile(req.file.buffer, req.file.originalname);
        console.log("✅ Parsed wallets:", wallets.length);

        const results = [];

        for (let i = 0; i < wallets.length; i++) {
            const w = wallets[i];
            console.log(`🔑 Wallet ${i}:`, w);

            const kp = Keypair.fromSecretKey(bs58.decode(w.privateKey));
            const payer = kp.publicKey.toBase58();

            const { blockhash } = await connection.getLatestBlockhash();
            console.log("🧱 Latest blockhash:", blockhash);

            const message = new TransactionMessage({
                payerKey: kp.publicKey,
                recentBlockhash: blockhash,
                instructions: []
            }).compileToV0Message();

            const tx = new VersionedTransaction(message);

            results.push({
                payer,
                mint: items?.[0]?.mint || "unknown",
                amount: items?.[0]?.amount || 0,
                isBuy: items?.[0]?.isBuy || false,
                success: true,
                data: { tx: Buffer.from(tx.serialize()).toString("base64") }
            });
        }

        console.log("✅ [request-tx] done, results:", results.length);
        res.json(results);
    } catch (err) {
        console.error("❌ [request-tx] error:", err.message);
        res.status(400).json({ error: String(err.message) });
    }
});

//
// 2️⃣ Heaven: getLatestBlockhash
//
app.get("/api/heaven/getLatestBlockhash", async (req, res) => {
    console.log("➡️  [getLatestBlockhash] hit");
    try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        console.log("✅ Got blockhash:", blockhash);
        res.json({ blockhash, lastValidBlockHeight });
    } catch (e) {
        console.error("❌ [getLatestBlockhash] error:", e.message);
        res.status(400).json({ error: String(e.message) });
    }
});

//
// 3️⃣ Heaven: sendTransaction
//
app.post("/api/heaven/sendTransaction", async (req, res) => {
    console.log("➡️  [sendTransaction] hit, body:", req.body);
    try {
        const { tx } = req.body;
        if (!tx) throw new Error("Missing tx field");

        const transaction = VersionedTransaction.deserialize(Buffer.from(tx, "base64"));
        const sig = await connection.sendTransaction(transaction, { skipPreflight: true });
        console.log("✅ Sent tx, sig:", sig);

        res.json({ signature: sig });
    } catch (e) {
        console.error("❌ [sendTransaction] error:", e.message);
        res.status(400).json({ error: String(e.message) });
    }
});

app.listen(PORT, () => console.log(`🚀 Heaven API running at http://localhost:${PORT}`));
