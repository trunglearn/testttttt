const ethers = require('ethers');

class BnbProvider {
  constructor() {
    this.provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/');
    this.wallets = [];
    this.routerAddress = '0x10ED43C718714eb63d5aA57Df2dCfe90d5D4beff'; // PancakeSwap V2
    this.routerAbi = [
      'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
      'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
      'function WETH() external pure returns (address)',
      // Add approve ABI if needed for sells
      'function approve(address spender, uint256 amount) external returns (bool)',
    ];
    this.router = new ethers.Contract(this.routerAddress, this.routerAbi, this.provider);
    this.wbnb = null;
  }

  async loadWallets(privateKeys) {
    this.wbnb = await this.router.WETH(); // Note: For BSC, it's WBNB, but ABI uses WETH; adjust if needed
    this.wallets = privateKeys.map(pk => new ethers.Wallet(pk, this.provider));
  }

  async performAction(action, tokenAddress, maxBaseAmount, mode = 'dex') {
    // Mode: 'dex', 'mm', 'mmv2', 'presale', 'txspam' etc.
    // For 'txspam', could send multiple small txs; for now, handle buy/sell
    for (const wallet of this.wallets) {
      const signer = wallet.connect(this.provider);
      const connectedRouter = this.router.connect(signer);

      const randomAmount = Math.random() * maxBaseAmount;
      const amountIn = ethers.parseEther(randomAmount.toString());
      const path = action === 'buy' ? [this.wbnb, tokenAddress] : [tokenAddress, this.wbnb];
      const to = wallet.address;
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      const amountOutMin = 0; // Adjust with slippage calculation in production

      let tx;
      if (action === 'buy') {
        tx = await connectedRouter.swapExactETHForTokens(amountOutMin, path, to, deadline, { value: amountIn });
      } else if (action === 'sell') {
        // Approve token if needed
        const tokenContract = new ethers.Contract(tokenAddress, ['function approve(address, uint256)'], signer);
        await tokenContract.approve(this.routerAddress, amountIn);
        tx = await connectedRouter.swapExactTokensForETH(amountIn, amountOutMin, path, to, deadline);
      } // Add 'txspam' logic: multiple small swaps or transfers

      await tx.wait();
      console.log(`Action ${action} (${mode}) completed for wallet ${wallet.address}: ${tx.hash}`);
    }
  }
}

module.exports = BnbProvider;