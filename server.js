// server.js
import express from "express";
import multer from "multer";
import {
    Connection,
    Keypair,
    PublicKey,
    VersionedTransaction,
    TransactionMessage,
    SystemProgram,
    LAMPORTS_PER_SOL,
    sendAndConfirmRawTransaction
} from "@solana/web3.js";
import bs58 from "bs58";
import xlsx from "xlsx";
import { createJupiterApiClient } from "@jup-ag/api";
import {
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

const app = express();
const upload = multer();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const RPC_URL =
    process.env.RPC_URL || "https://api.mainnet-beta.solana.com"; // bạn có thể set QuickNode ở ENV
const connection = new Connection(RPC_URL, "confirmed");

// Jupiter API client
const jupiter = createJupiterApiClient({ basePath: "https://quote-api.jup.ag/v6" });

// Mints
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Parse file (CSV/XLSX)
function parseWalletFile(buffer, originalname) {
    if (originalname.endsWith(".csv")) {
        const rows = buffer.toString().trim().split("\n").map(r => r.split(","));

        // Nếu dòng đầu có chữ thì coi là header, nếu không thì coi là data
        const firstRow = rows[0].map(c => c.toLowerCase());
        const hasHeader =
            firstRow.includes("privatekey") || firstRow.includes("private_key");

        const dataRows = hasHeader ? rows.slice(1) : rows;

        return dataRows.map(r => ({
            privateKey: r[0]?.trim(),
            amountSOL: parseFloat(r[1] || "0"),
        }));
    } else if (originalname.endsWith(".xlsx")) {
        const workbook = xlsx.read(buffer, { type: "buffer" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = xlsx.utils.sheet_to_json(sheet, { header: 1 }); // đọc raw rows

        // Bỏ header nếu có
        const firstRow = (json[0] || []).map(c => String(c).toLowerCase());
        const hasHeader =
            firstRow.includes("privatekey") || firstRow.includes("private_key");
        const dataRows = hasHeader ? json.slice(1) : json;

        return dataRows.map(r => ({
            privateKey: String(r[0] || "").trim(),
            amountSOL: parseFloat(r[1] || "0"),
        }));
    }
    throw new Error("Unsupported file format (chỉ hỗ trợ .csv hoặc .xlsx)");
}


// Ensure ATA exists (create if missing) for a given owner+mint
async function ensureAta(ownerKp, mintStr) {
    const mint = new PublicKey(mintStr);
    const owner = ownerKp.publicKey;
    const ata = await getAssociatedTokenAddress(mint, owner);
    const info = await connection.getAccountInfo(ata);
    if (!info) {
        const ix = createAssociatedTokenAccountInstruction(owner, ata, owner, mint);
        const { blockhash } = await connection.getLatestBlockhash();
        const msg = new TransactionMessage({
            payerKey: owner,
            recentBlockhash: blockhash,
            instructions: [ix],
        }).compileToV0Message();
        const tx = new VersionedTransaction(msg);
        tx.sign([ownerKp]);
        const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        });
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight }, "confirmed");
    }
    return ata;
}

// Fetch token balance (raw amount)
async function getRawTokenAmount(owner, mint) {
    const resp = await connection.getTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    if (resp.value.length === 0) return "0";
    const bal = await connection.getTokenAccountBalance(resp.value[0].pubkey);
    return bal.value.amount; // string (raw, already in mint decimals units)
}

// Core swap per wallet
async function processWallet({
    action,
    tokenAddress,
    maxBaseAmount, // SOL for buys
    sendMode,      // "send" | "build_only"
    walletRow,
}) {
    const out = {
        wallet: null,
        action,
        tokenAddress,
        requestedAmount: walletRow.amountSOL || null,
        ok: false,
    };

    try {
        if (!walletRow.privateKey) throw new Error("Missing privateKey");
        const kp = Keypair.fromSecretKey(bs58.decode(String(walletRow.privateKey).trim()));
        const owner = kp.publicKey.toBase58();
        out.wallet = owner;

        // Determine input/output and amount
        let inputMint, outputMint, amount;
        if (action === "buy") {
            inputMint = WSOL_MINT;
            outputMint = tokenAddress;
            const solAmount = (walletRow.amountSOL || maxBaseAmount || 0);
            if (!solAmount || solAmount <= 0) throw new Error("Invalid amountSOL");
            amount = Math.floor(solAmount * LAMPORTS_PER_SOL); // in lamports
        } else if (action === "sell") {
            inputMint = tokenAddress;
            outputMint = WSOL_MINT;
            const raw = await getRawTokenAmount(kp.publicKey, tokenAddress);
            amount = Number(raw);
            if (!amount || amount <= 0) throw new Error("No token balance");
        } else {
            throw new Error("Invalid action (buy/sell)");
        }

        // Pre-create destination ATA to avoid AccountNotFound:
        // - if buying: ensure ATA for output token
        // - if selling: ensure ATA for input token (debit source), & WSOL out ATA will be auto-handled by wrap/unwrap
        if (action === "buy") {
            await ensureAta(kp, outputMint);
        } else {
            await ensureAta(kp, inputMint);
        }

        // Get quote
        const quote = await jupiter.quoteGet({
            inputMint,
            outputMint,
            amount,
            slippageBps: 50, // 0.5%
            onlyDirectRoutes: false,
            asLegacyTransaction: false,
        });

        if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
            throw new Error("No route from Jupiter");
        }

        // Build swap tx
        const swapTxResp = await jupiter.swapPost({
            swapRequest: {
                quoteResponse: quote,
                userPublicKey: owner,
                wrapAndUnwrapSol: true,
                // prioritizationFeeLamports: "auto", // có thể bật khi cần
            },
        });

        if (!swapTxResp?.swapTransaction) {
            throw new Error("Jupiter failed to build transaction");
        }

        const swapTxBuf = Buffer.from(swapTxResp.swapTransaction, "base64");
        const vtx = VersionedTransaction.deserialize(swapTxBuf);

        // Sign with wallet
        vtx.sign([kp]);

        // Option 1: build_only -> return base64 (giống nippybots)
        if (sendMode === "build_only") {
            out.ok = true;
            out.mode = "build_only";
            out.data = {
                tx: Buffer.from(vtx.serialize()).toString("base64"),
            };
            return out;
        }

        // Option 2: send -> simulate (preflight) & confirm
        // NOTE: sendRawTransaction already runs preflight unless skipPreflight=true
        const signature = await connection.sendRawTransaction(vtx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3,
        });

        // Confirm
        const latest = await connection.getLatestBlockhash();
        const conf = await connection.confirmTransaction(
            { signature, ...latest },
            "confirmed"
        );

        if (conf.value.err) {
            out.ok = false;
            out.tx = signature;
            out.error = `Confirm error: ${JSON.stringify(conf.value.err)}`;
            return out;
        }

        out.ok = true;
        out.tx = signature;
        return out;
    } catch (e) {
        out.ok = false;
        out.error = String(e?.message || e);
        return out;
    }
}

// API Heaven Buy/Sell
app.post("/api/solana/heaven/submit", upload.single("wallets"), async (req, res) => {
    try {
        const { action, tokenAddress, maxBaseAmount, sendMode } = req.body;
        if (!["buy", "sell"].includes(action)) {
            return res.status(400).json({ error: "Invalid action (buy/sell)" });
        }
        if (!tokenAddress) {
            return res.status(400).json({ error: "Missing tokenAddress" });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Wallet file required (thiếu file ví)" });
        }

        const wallets = parseWalletFile(req.file.buffer, req.file.originalname);
        if (!wallets.length) {
            return res.status(400).json({ error: "Wallet list empty" });
        }

        const tasks = [];
        for (const w of wallets) {
            tasks.push(
                processWallet({
                    action,
                    tokenAddress,
                    maxBaseAmount: maxBaseAmount ? Number(maxBaseAmount) : undefined,
                    sendMode: sendMode === "build_only" ? "build_only" : "send",
                    walletRow: w,
                })
            );
        }

        const results = await Promise.all(tasks);
        const successCount = results.filter(r => r.ok).length;

        let httpStatus = 200;
        if (successCount === 0) httpStatus = 502; // all failed
        else if (successCount < results.length) httpStatus = 207; // partial success

        return res.status(httpStatus).json({
            action,
            tokenAddress,
            sendMode: sendMode === "build_only" ? "build_only" : "send",
            rpc: RPC_URL,
            summary: {
                total: results.length,
                success: successCount,
                failed: results.length - successCount,
            },
            results,
        });
    } catch (err) {
        return res.status(500).json({ error: String(err?.message || err) });
    }
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Start server
app.listen(PORT, () => {
    console.log(`🚀 API running on http://localhost:${PORT}`);
    console.log(`RPC: ${RPC_URL}`);
});
