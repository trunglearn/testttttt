const { Connection, Keypair, VersionedTransaction, TransactionMessage, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Liquidity, Token, TokenAmount, Percent } = require('@raydium-io/raydium-sdk');
const bs58 = require('bs58');
const BN = require('bn.js');

class SolanaProvider {
  constructor() {
    this.connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    this.wallets = [];
    this.baseToken = new Token(new PublicKey('So11111111111111111111111111111111111111112'), 9, 'SOL', 'SOL');
  }

  async loadWallets(privateKeys) {
    this.wallets = privateKeys.map(pk => Keypair.fromSecretKey(bs58.decode(pk)));
  }

  async getPoolKeys(tokenAddress) {
    const liquidityData = await (await fetch('https://api.raydium.io/v2/sdk/liquidity/mainnet.json')).json();
    const pools = liquidityData.official.concat(liquidityData.unOfficial);
    const targetPool = pools.find(pool => 
      (pool.baseMint === this.baseToken.mint.toString() && pool.quoteMint === tokenAddress) ||
      (pool.baseMint === tokenAddress && pool.quoteMint === this.baseToken.mint.toString())
    );
    if (!targetPool) throw new Error('Pool not found');
    return Liquidity.getAssociatedPoolKeys({
      version: 4,
      marketId: new PublicKey(targetPool.marketId),
      baseMint: new PublicKey(targetPool.baseMint),
      quoteMint: new PublicKey(targetPool.quoteMint),
      baseDecimals: targetPool.baseDecimals,
      quoteDecimals: targetPool.quoteDecimals,
      programId: new PublicKey('675kPX9MHTjS2zt1qfr1NYhuZEUGzGRknTHhyfR2g6FG'),
      marketProgramId: new PublicKey(targetPool.marketProgramId),
    });
  }

  async performAction(action, tokenAddress, maxBaseAmount, mode = 'mm') {
    // Mode: 'mm' for market making buy/sell, 'presale' or others can be handled differently if needed
    const tokenMint = new PublicKey(tokenAddress);
    const tokenDecimals = 9; // Fetch dynamically in production
    const token = new Token(tokenMint, tokenDecimals, 'TOKEN', 'TOKEN');

    const poolKeys = await this.getPoolKeys(tokenAddress);

    for (const wallet of this.wallets) {
      const randomAmount = Math.random() * maxBaseAmount;
      const inputAmount = new TokenAmount(this.baseToken, new BN(randomAmount * LAMPORTS_PER_SOL));

      const swapConfig = {
        connection: this.connection,
        poolKeys,
        userKeys: { owner: wallet.publicKey },
        amountIn: inputAmount,
        fixedSide: 'in',
        config: { bypassAssociatedCheck: false },
      };

      const { innerTransaction } = await Liquidity.makeSwapInstructionSimple(swapConfig);

      const recentBlockhash = await this.connection.getLatestBlockhash();
      const message = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: recentBlockhash.blockhash,
        instructions: innerTransaction.instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);
      tx.sign([wallet, ...innerTransaction.signers]);

      const signature = await this.connection.sendTransaction(tx);
      await this.connection.confirmTransaction(signature);
      console.log(`Action ${action} (${mode}) completed for wallet ${wallet.publicKey.toString()}: ${signature}`);
    }
  }
}

module.exports = SolanaProvider;